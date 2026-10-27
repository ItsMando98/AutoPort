import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { assertSafeApiExposure, requireMutationAuth, resolveApiHost } from './apiSecurity.js';
import {
  getAgentFreshnessStatus,
  getCalibrationSummary,
  getDecisionLineage,
  getLatestDecisionBatches,
  getLatestSymbolTheses,
  getPortfolioIntents,
} from './autonomy.js';
import { db } from './db.js';
import {
  refreshAllPriceHistory,
  computeTechnicalSnapshot,
  getAllTechnicalSnapshots,
  formatSnapshotsForPrompt,
  fetchAndStoreOHLCV,
  WATCHLIST,
} from './technicals.js';
import {
  fetchFundamentals,
  getFundamentals,
  getAllFundamentals,
  refreshAllFundamentals,
  getUpcomingEarnings,
  formatFundamentalsRow,
  needsRefresh,
} from './fundamentals.js';
import { checkTradeAllowed, getStopLossAlerts } from './risk.js';
import { getStatus as getAgentStatus } from './agent.js';
import { getAllProfiles, shouldConsolidate } from './knowledge.js';
import { runScreener, getLastScreenerResults } from './screener.js';
import { runFilingsCheck, getRecentFilings } from './filings.js';
import { runInsidersCheck, getRecentInsiderTrades } from './insiders.js';
import {
  getAllManagers,
  getHoldingsForSymbol,
  getOverlapSymbols,
  getSignificantChanges,
  getSmartMoneySummary,
} from './hedgeFund.js';
import { calculatePerformanceMetrics, getDailyReturnHistory } from './performance.js';
import { runBacktest, DEFAULT_CONFIG } from './backtest.js';
import { computeWeeklySnapshot, getAllWeeklySnapshots } from './multitimeframe.js';
import { calculateSectorPerformance, getRotationSummary } from './sectorrotation.js';
import { getLatestMacroRegime, getMacroIndicators, getMacroPromptContext } from './macro.js';
import {
  getBrokerMode, isBrokerConnected, testConnection,
  getAccount, getPositions, getOrders,
  placeMarketOrder, cancelAllOrders, closeAllPositions,
  syncToLocalPortfolio, getBrokerConfig, updateBrokerConfig,
} from './broker.js';
import { loadFromDB, getState as getPortfolioState, getTotalValue, executeTrade as portfolioExecuteTrade } from './portfolio.js';
import { getCachedPrices, getMarketDataStatus } from './marketdata.js';
import { getExecutionAttempts, createExecutionAttempt, updateExecutionAttempt } from './execution.js';
import { getRecentResearchEvents, getSignalCandidates, updateSignalCandidateStatus } from './research.js';
import { getFreshnessSummary, getDataSourceStatuses } from './ops.js';
import { getMarketSessionStatus } from './marketclock.js';
import { getTradingMode } from './runtime.js';
import { refreshDegradationState } from './degradation.js';
import { getStoredNews, refreshYahooFinanceNews } from './news.js';
import { buildDailyReport } from './reports.js';
import { getReadinessStatus } from './readiness.js';
import { getResearchFeed } from './researchFeed.js';
import { registry } from './agents/registry.js';
import { getSystemControls, setKillSwitchEngaged, setLiveTradingEnabled } from './controls.js';
import { getRolloutPolicy, setLiveRolloutProfile } from './rollout.js';
import { getReconciliationStatus, reconcileBrokerOrders } from './reconciliation.js';
import { getRecoveryStatus, recoverExecutionAttempts } from './recovery.js';
import { getExecutionHistory, getExecutionQualitySummary } from './executionHistory.js';
import { getOptionsFlow, getShortInterest, getSqueezeCandidates } from './sentiment.js';
import { getMarketBreadthHistory } from './agents/marketBreadth.js';
import {
  getThemeAttribution,
  getThemeDetail,
  getThemeDiscoveries,
  getThemeHistory,
  getThemes,
  rebuildTheme,
  refreshThemeLab,
} from './themes.js';
import {
  getAiConfig,
  updateAiConfig,
  resetAiSpend,
  fetchModelsForProvider,
  testAiConnection,
  getAiUsageHistory,
  type AiProvider,
} from './aiService.js';

const app = express();
const PORT = 3001;
const API_HOST = resolveApiHost();

assertSafeApiExposure(API_HOST, process.env.API_AUTH_TOKEN);

app.use(express.json({ limit: '10mb' }));
app.use('/api', requireMutationAuth());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  const agent = getAgentStatus();
  const market = getMarketSessionStatus();
  const prices = getMarketDataStatus();
  const degradation = refreshDegradationState();
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    db: 'connected',
    mode: getTradingMode(),
    degraded: agent.degraded,
    marketSession: market,
    livePrices: prices,
    degradation,
  });
});

app.get('/api/system/health', (_req, res) => {
  const agent = getAgentStatus();
  const market = getMarketSessionStatus();
  const readiness = getReadinessStatus();
  const degradation = refreshDegradationState();
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    mode: getTradingMode(),
    degraded: agent.degraded,
    controls: readiness.controls,
    liveExecutionAllowed: readiness.liveExecutionAllowed,
    readinessEligible: readiness.eligibleForLive,
    scheduler: {
      coordinator: agent,
      agents: registry.getAllStatuses(),
    },
    marketSession: market,
    dataSources: getDataSourceStatuses(),
    brokerReconciliation: getReconciliationStatus(),
    executionRecovery: getRecoveryStatus(),
    degradation,
  });
});

app.get('/api/data/freshness', (_req, res) => {
  res.json(getFreshnessSummary());
});

app.get('/api/system/readiness', (_req, res) => {
  res.json(getReadinessStatus());
});

app.get('/api/system/degradation', (_req, res) => {
  res.json(refreshDegradationState());
});

app.get('/api/system/controls', (_req, res) => {
  res.json(getSystemControls());
});

app.post('/api/system/controls/kill-switch', async (req, res) => {
  const engaged = Boolean(req.body?.engaged);
  setKillSwitchEngaged(engaged);

  if (engaged) {
    registry.stopAll();
    if (isBrokerConnected()) {
      try {
        await cancelAllOrders();
        await closeAllPositions();
      } catch (err: any) {
        return res.status(500).json({ error: err?.message ?? 'Failed to engage kill switch' });
      }
    }
  }

  res.json({
    ok: true,
    controls: getSystemControls(),
    readiness: getReadinessStatus(),
  });
});

app.post('/api/system/controls/live-enable', (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const readiness = getReadinessStatus();
  if (enabled && !readiness.eligibleForLive) {
    return res.status(400).json({ error: 'Paper gates are not yet satisfied for live execution.' });
  }

  setLiveTradingEnabled(enabled);
  res.json({
    ok: true,
    controls: getSystemControls(),
    readiness: getReadinessStatus(),
  });
});

app.post('/api/system/controls/live-rollout-profile', (req, res) => {
  const profile = req.body?.profile;
  if (!['paper', 'limited_live', 'full_live'].includes(profile)) {
    return res.status(400).json({ error: 'Invalid rollout profile.' });
  }

  setLiveRolloutProfile(profile);
  res.json({
    ok: true,
    controls: getSystemControls(),
    readiness: getReadinessStatus(),
    rolloutPolicy: getRolloutPolicy(),
  });
});

// ─── Companies ────────────────────────────────────────────────────────────────

app.get('/api/companies', (_req, res) => {
  const rows = db.prepare('SELECT * FROM companies ORDER BY symbol').all();
  res.json(rows);
});

app.post('/api/companies', (req, res) => {
  const { symbol, name, sector, market_cap_category, description } = req.body;
  db.prepare(`
    INSERT INTO companies (symbol, name, sector, market_cap_category, description, updated_at)
    VALUES (@symbol, @name, @sector, @market_cap_category, @description, unixepoch())
    ON CONFLICT(symbol) DO UPDATE SET
      name = excluded.name,
      sector = excluded.sector,
      market_cap_category = excluded.market_cap_category,
      description = excluded.description,
      updated_at = unixepoch()
  `).run({ symbol, name, sector: sector || null, market_cap_category: market_cap_category || 'large', description: description || null });
  res.json({ ok: true });
});

// ─── News Articles ────────────────────────────────────────────────────────────

// Get unprocessed articles (so the AI knows what still needs analysis)
app.get('/api/news/unprocessed', (_req, res) => {
  const rows = db.prepare(
    'SELECT * FROM news_articles WHERE processed = 0 ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json(rows);
});

app.get('/api/news', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(getStoredNews(limit));
});

app.post('/api/news/refresh', async (_req, res) => {
  try {
    const result = await refreshYahooFinanceNews(30);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'News refresh failed' });
  }
});

// Save one or many articles (INSERT OR IGNORE — idempotent)
app.post('/api/news', (req, res) => {
  const articles = Array.isArray(req.body) ? req.body : [req.body];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO news_articles (id, title, url, source, published_at, relevant_symbols)
    VALUES (@id, @title, @url, @source, @published_at, @relevant_symbols)
  `);

  const saveMany = db.transaction((items: any[]) => {
    let saved = 0;
    for (const a of items) {
      const result = insert.run({
        id: a.id || randomUUID(),
        title: a.title,
        url: a.url,
        source: a.source || null,
        published_at: a.published_at || null,
        relevant_symbols: a.relevant_symbols ? JSON.stringify(a.relevant_symbols) : null,
      });
      if (result.changes > 0) saved++;
    }
    return saved;
  });

  const saved = saveMany(articles);
  res.json({ saved });
});

// Mark article as processed, store AI summary + sentiment
app.put('/api/news/:id/processed', (req, res) => {
  const { summary, sentiment } = req.body;
  db.prepare(`
    UPDATE news_articles
    SET processed = 1, summary = @summary, sentiment = @sentiment
    WHERE id = @id
  `).run({ id: req.params.id, summary: summary || null, sentiment: sentiment || null });
  res.json({ ok: true });
});

// ─── Analyses ─────────────────────────────────────────────────────────────────

// Get all analyses for a symbol — used to build company context for future prompts
app.get('/api/analyses/:symbol', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.prepare(`
    SELECT a.*, n.title AS article_title, n.url AS article_url
    FROM analyses a
    LEFT JOIN news_articles n ON a.article_id = n.id
    WHERE a.symbol = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(req.params.symbol, limit);
  res.json(rows);
});

app.post('/api/analyses', (req, res) => {
  const { symbol, article_id, action, confidence, reasoning, price_at_analysis, technical_context } = req.body;
  const result = db.prepare(`
    INSERT INTO analyses (symbol, article_id, action, confidence, reasoning, price_at_analysis, technical_context)
    VALUES (@symbol, @article_id, @action, @confidence, @reasoning, @price_at_analysis, @technical_context)
  `).run({
    symbol,
    article_id: article_id || null,
    action,
    confidence,
    reasoning,
    price_at_analysis: price_at_analysis || null,
    technical_context: technical_context ? JSON.stringify(technical_context) : null,
  });
  res.json({ id: result.lastInsertRowid });
});

// ─── Signals ──────────────────────────────────────────────────────────────────

app.get('/api/signals', (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = status
    ? db.prepare('SELECT * FROM signals WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/signals', (req, res) => {
  const { symbol, signal_type, score, confidence, sources, reasoning, expires_at } = req.body;
  const result = db.prepare(`
    INSERT INTO signals (symbol, signal_type, score, confidence, sources, reasoning, expires_at)
    VALUES (@symbol, @signal_type, @score, @confidence, @sources, @reasoning, @expires_at)
  `).run({
    symbol,
    signal_type,
    score,
    confidence,
    sources: JSON.stringify(sources || []),
    reasoning,
    expires_at: expires_at || null,
  });
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/signals/:id/status', (req, res) => {
  const { status, rejection_reason } = req.body;
  db.prepare(`
    UPDATE signals SET status = @status, rejection_reason = @rejection_reason WHERE id = @id
  `).run({ id: req.params.id, status, rejection_reason: rejection_reason || null });
  res.json({ ok: true });
});

app.get('/api/signals/candidates', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(getSignalCandidates(limit));
});

app.get('/api/research/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
  res.json(getRecentResearchEvents(limit, symbol));
});

app.get('/api/research/feed', (req, res) => {
  res.json(getResearchFeed({
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    entity: typeof req.query.entity === 'string' ? req.query.entity : undefined,
    hoursBack: Number(req.query.hoursBack),
    limit: Number(req.query.limit),
    sentiment: typeof req.query.sentiment === 'string' ? req.query.sentiment : undefined,
    sourceType: typeof req.query.sourceType === 'string' ? req.query.sourceType : undefined,
    actionableOnly: req.query.actionableOnly === 'true',
    portfolioOnly: req.query.portfolioOnly === 'true',
    freshOnly: req.query.freshOnly === 'true',
  }));
});

app.get('/api/themes', (_req, res) => {
  res.json(getThemes());
});

app.get('/api/themes/discoveries', (req, res) => {
  const themeId = typeof req.query.themeId === 'string' ? req.query.themeId : undefined;
  res.json(getThemeDiscoveries(themeId));
});

app.post('/api/themes/refresh', async (_req, res) => {
  try {
    const result = await refreshThemeLab({ useLivePrices: true });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Theme refresh failed' });
  }
});

app.post('/api/themes/:id/rebuild', async (req, res) => {
  try {
    const result = await rebuildTheme(req.params.id, { useLivePrices: true });
    if (!result.theme) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Theme rebuild failed' });
  }
});

app.get('/api/themes/:id/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(getThemeHistory(req.params.id, limit));
});

app.get('/api/themes/:id/attribution', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(getThemeAttribution(req.params.id, limit));
});

app.get('/api/themes/:id', (req, res) => {
  const detail = getThemeDetail(req.params.id);
  if (!detail.theme) {
    return res.status(404).json({ error: 'Theme not found' });
  }
  res.json(detail);
});

// ─── Trades ───────────────────────────────────────────────────────────────────

app.get('/api/trades', (req, res) => {
  const symbol = req.query.symbol as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = symbol
    ? db.prepare('SELECT * FROM trades WHERE symbol = ? ORDER BY created_at DESC LIMIT ?').all(symbol, limit)
    : db.prepare('SELECT * FROM trades ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.get('/api/execution/orders', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(getExecutionAttempts(limit));
});

app.get('/api/execution/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(getExecutionHistory({
    symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    terminalPath: typeof req.query.terminalPath === 'string' ? req.query.terminalPath : undefined,
    retryBand: typeof req.query.retryBand === 'string' ? req.query.retryBand : undefined,
    degraded: typeof req.query.degraded === 'string' ? req.query.degraded === 'true' : undefined,
    from: typeof req.query.from === 'string' ? Number(req.query.from) : undefined,
    to: typeof req.query.to === 'string' ? Number(req.query.to) : undefined,
    limit,
    offset,
  }));
});

app.get('/api/execution/quality-summary', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(getExecutionQualitySummary(limit));
});

app.get('/api/execution/approvals', (_req, res) => {
  res.json([]);
});

app.post('/api/execution/approvals/:id/approve', (_req, res) => {
  res.status(410).json({ error: 'Manual approvals are disabled. Execution is fully autonomous under backend rollout controls.' });
});

app.post('/api/execution/approvals/:id/reject', (_req, res) => {
  res.status(410).json({ error: 'Manual approvals are disabled. Use the kill switch or rollout controls to govern autonomous execution.' });
});

app.post('/api/trades', (req, res) => {
  const {
    id, symbol, action, shares, price, total_value, signal_id, candidate_id, execution_attempt_id, cycle_id, source_event_ids,
    entry_thesis, exit_reason, risk_check_passed, risk_check_details,
    portfolio_value_before, status,
  } = req.body;

  db.prepare(`
    INSERT OR IGNORE INTO trades
      (id, symbol, action, shares, price, total_value, signal_id, candidate_id, execution_attempt_id, cycle_id, source_event_ids, entry_thesis, exit_reason,
       risk_check_passed, risk_check_details, portfolio_value_before, status)
    VALUES
      (@id, @symbol, @action, @shares, @price, @total_value, @signal_id, @candidate_id, @execution_attempt_id, @cycle_id, @source_event_ids, @entry_thesis, @exit_reason,
       @risk_check_passed, @risk_check_details, @portfolio_value_before, @status)
  `).run({
    id: id || randomUUID(),
    symbol,
    action,
    shares,
    price,
    total_value,
    signal_id: signal_id || null,
    candidate_id: candidate_id || null,
    execution_attempt_id: execution_attempt_id || null,
    cycle_id: cycle_id || null,
    source_event_ids: Array.isArray(source_event_ids) ? JSON.stringify(source_event_ids) : source_event_ids || null,
    entry_thesis: entry_thesis || null,
    exit_reason: exit_reason || null,
    risk_check_passed: risk_check_passed ? 1 : 0,
    risk_check_details: risk_check_details ? JSON.stringify(risk_check_details) : null,
    portfolio_value_before: portfolio_value_before || null,
    status: status || 'executed',
  });
  res.json({ ok: true });
});

// ─── Company Knowledge ────────────────────────────────────────────────────────
// Specific named routes MUST come before /:symbol

// All consolidated AI knowledge profiles (consolidated from past analyses)
app.get('/api/knowledge/profiles', (_req, res) => {
  res.json(getAllProfiles());
});

// Trigger consolidation for one symbol or all
app.post('/api/knowledge/consolidate', async (req, res) => {
  const { symbol } = req.body ?? {};
  res.json({ ok: true, message: 'Consolidation started in background' });
  registry.runKnowledge(symbol).catch(console.error);
});

// Analysis count + profile status per symbol
app.get('/api/knowledge/status', (_req, res) => {
  // Use same approach as analytics/overview (known to work)
  const allSymbols = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META', 'AMD', 'INTC', 'CRWD', 'PLTR'];
  const profiles = getAllProfiles();
  const status = allSymbols
    .map(sym => {
      const row = db.prepare(
        "SELECT COUNT(*) as n FROM analyses WHERE symbol = ?"
      ).get(sym) as any;
      const count = row?.n ?? 0;
      return {
        symbol:             sym,
        analyses:           count,
        hasProfile:         profiles[sym] !== undefined,
        lastConsolidated:   profiles[sym]?.analysis_count ?? 0,
        needsConsolidation: shouldConsolidate(sym),
      };
    })
    .filter(s => s.analyses > 0)
    .sort((a, b) => b.analyses - a.analyses);
  res.json(status);
});

// Raw knowledge entries for a symbol (legacy endpoint)
app.get('/api/knowledge/:symbol', (req, res) => {
  // Guard against accidentally matching special routes
  const RESERVED = ['profiles', 'consolidate', 'status'];
  if (RESERVED.includes(req.params.symbol)) {
    return res.status(400).json({ error: `"${req.params.symbol}" is a reserved endpoint` });
  }
  const rows = db.prepare(
    'SELECT * FROM company_knowledge WHERE symbol = ? ORDER BY updated_at DESC'
  ).all(req.params.symbol.toUpperCase());
  res.json(rows);
});

// Upsert: update existing knowledge type, or insert new one
app.post('/api/knowledge/:symbol', (req, res) => {
  const { knowledge_type, content, confidence } = req.body;
  const { symbol } = req.params;

  const existing = db.prepare(
    'SELECT id FROM company_knowledge WHERE symbol = ? AND knowledge_type = ?'
  ).get(symbol, knowledge_type) as any;

  if (existing) {
    db.prepare(`
      UPDATE company_knowledge
      SET content = @content, confidence = @confidence,
          sources_count = sources_count + 1, updated_at = unixepoch()
      WHERE id = @id
    `).run({ id: existing.id, content, confidence: confidence ?? 0.5 });
  } else {
    db.prepare(`
      INSERT INTO company_knowledge (symbol, knowledge_type, content, confidence)
      VALUES (@symbol, @knowledge_type, @content, @confidence)
    `).run({ symbol, knowledge_type, content, confidence: confidence ?? 0.5 });
  }
  res.json({ ok: true });
});

// ─── Price History ────────────────────────────────────────────────────────────

app.get('/api/price-history/:symbol', (req, res) => {
  const days = Math.min(Number(req.query.days) || 90, 365);
  const rows = db.prepare(`
    SELECT * FROM price_history
    WHERE symbol = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(req.params.symbol, days);
  res.json(rows.reverse()); // chronological
});

app.post('/api/price-history', (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  const insert = db.prepare(`
    INSERT OR REPLACE INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (@symbol, @date, @open, @high, @low, @close, @volume)
  `);
  const saveMany = db.transaction((items: any[]) => {
    for (const e of items) insert.run(e);
  });
  saveMany(entries);
  res.json({ saved: entries.length });
});

// ─── Engine Logs ──────────────────────────────────────────────────────────────

app.get('/api/engine-logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const rows = db.prepare(
    'SELECT * FROM engine_logs ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
  res.json(rows.reverse()); // chronological order for UI
});

app.post('/api/engine-logs', (req, res) => {
  const logs = Array.isArray(req.body) ? req.body : [req.body];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO engine_logs (id, timestamp, log_type, asset, content, action, status)
    VALUES (@id, @timestamp, @log_type, @asset, @content, @action, @status)
  `);
  const saveMany = db.transaction((items: any[]) => {
    for (const l of items) {
      insert.run({
        id: l.id || randomUUID(),
        timestamp: l.timestamp,
        log_type: l.type || l.log_type,
        asset: l.asset || null,
        content: l.content,
        action: l.action || null,
        status: l.status || null,
      });
    }
  });
  saveMany(logs);
  res.json({ ok: true });
});

// ─── Portfolio State ──────────────────────────────────────────────────────────

// Latest snapshot (for recovery after browser/server restart)
app.get('/api/portfolio/state', (_req, res) => {
  const row = db.prepare(
    'SELECT * FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1'
  ).get() as any;
  if (!row) return res.json(null);
  res.json({
    cash: row.cash,
    positions: JSON.parse(row.positions),
    transactions: JSON.parse(row.transactions),
    total_value: row.total_value,
    saved_at: row.created_at,
  });
});

app.post('/api/portfolio/state', (req, res) => {
  const { cash, positions, transactions, total_value } = req.body;
  db.prepare(`
    INSERT INTO portfolio_snapshots (cash, positions, transactions, total_value)
    VALUES (@cash, @positions, @transactions, @total_value)
  `).run({
    cash,
    positions: JSON.stringify(positions),
    transactions: JSON.stringify(transactions),
    total_value: total_value || null,
  });

  // Keep only last 50 snapshots to avoid unlimited growth
  db.prepare(`
    DELETE FROM portfolio_snapshots WHERE id NOT IN (
      SELECT id FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 50
    )
  `).run();

  res.json({ ok: true });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// Signal accuracy over time — how often did BUY signals lead to executed trades
app.get('/api/analytics/overview', (_req, res) => {
  const totalTrades = (db.prepare('SELECT COUNT(*) as count FROM trades').get() as any).count;
  const buys = (db.prepare("SELECT COUNT(*) as count FROM trades WHERE action = 'BUY'").get() as any).count;
  const sells = (db.prepare("SELECT COUNT(*) as count FROM trades WHERE action = 'SELL'").get() as any).count;
  const totalAnalyses = (db.prepare('SELECT COUNT(*) as count FROM analyses').get() as any).count;
  const totalArticles = (db.prepare('SELECT COUNT(*) as count FROM news_articles').get() as any).count;
  const processedArticles = (db.prepare('SELECT COUNT(*) as count FROM news_articles WHERE processed = 1').get() as any).count;

  const bySymbol = db.prepare(`
    SELECT symbol, COUNT(*) as trade_count, action
    FROM trades
    GROUP BY symbol, action
    ORDER BY trade_count DESC
  `).all();

  res.json({
    totalTrades,
    buys,
    sells,
    totalAnalyses,
    totalArticles,
    processedArticles,
    bySymbol,
  });
});

// ─── Fundamentals ─────────────────────────────────────────────────────────────

app.get('/api/fundamentals/all', (_req, res) => {
  res.json(getAllFundamentals());
});

// Must be before /api/fundamentals/:symbol to avoid route conflict
app.post('/api/fundamentals/refresh', async (req, res) => {
  const { symbol } = req.body ?? {};
  res.json({ ok: true, message: 'Refresh started in background' });
  if (symbol) {
    fetchFundamentals(symbol.toUpperCase()).catch(console.error);
  } else {
    refreshAllFundamentals(WATCHLIST).catch(console.error);
  }
});

// Compact table for Gemini prompt — BEFORE /:symbol to avoid route conflict
app.get('/api/fundamentals/prompt-context', (_req, res) => {
  const lines = WATCHLIST.map(s => formatFundamentalsRow(s));
  res.type('text').send(lines.join('\n'));
});

app.get('/api/fundamentals/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const data = getFundamentals(symbol);
  if (!data) return res.status(404).json({ error: `No fundamental data for ${symbol}` });
  res.json(data);
});

// ─── Earnings Calendar ────────────────────────────────────────────────────────

app.get('/api/earnings/upcoming', (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 60);
  res.json(getUpcomingEarnings(days));
});

// ─── Risk Engine ──────────────────────────────────────────────────────────────

app.post('/api/risk/check', (req, res) => {
  const { symbol, action, shares, price, portfolio } = req.body;
  if (!symbol || !action || !shares || !price || !portfolio) {
    return res.status(400).json({ error: 'Missing required fields: symbol, action, shares, price, portfolio' });
  }
  const result = checkTradeAllowed(
    symbol.toUpperCase(),
    action.toUpperCase() as 'BUY' | 'SELL',
    Number(shares),
    Number(price),
    portfolio
  );
  res.json(result);
});

// Stop-loss scanner — returns positions that need immediate selling
app.post('/api/risk/stop-loss-scan', (req, res) => {
  const { positions, currentPrices } = req.body;
  if (!positions || !currentPrices) {
    return res.status(400).json({ error: 'Missing positions or currentPrices' });
  }
  const alerts = getStopLossAlerts(positions, currentPrices);
  res.json(alerts);
});

// Recent risk events log
app.get('/api/risk/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(
    'SELECT * FROM risk_events ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  res.json(rows);
});

// ─── Technical Analysis ───────────────────────────────────────────────────────

// Returns snapshots for all watchlist symbols — called by frontend before each Gemini cycle
app.get('/api/technical/all', (_req, res) => {
  const snapshots = getAllTechnicalSnapshots();
  res.json(snapshots);
});

// Returns the formatted prompt-ready string (for debugging / testing prompts)
// Must be defined BEFORE /api/technical/:symbol to avoid route conflict
app.get('/api/technical/prompt-context', (_req, res) => {
  const snapshots = getAllTechnicalSnapshots();
  res.type('text').send(formatSnapshotsForPrompt(snapshots));
});

// Returns full snapshot for one symbol
app.get('/api/technical/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!WATCHLIST.includes(symbol)) {
    return res.status(400).json({ error: `${symbol} not in watchlist` });
  }
  const snapshot = computeTechnicalSnapshot(symbol);
  if (!snapshot) {
    return res.status(404).json({ error: 'Insufficient price data. Run /api/technical/refresh first.' });
  }
  res.json(snapshot);
});

// Trigger a fresh fetch for one symbol or all
app.post('/api/technical/refresh', async (req, res) => {
  const { symbol } = req.body;
  res.json({ ok: true, message: 'Refresh started in background' });

  if (symbol) {
    fetchAndStoreOHLCV(symbol.toUpperCase(), 6).catch(console.error);
  } else {
    refreshAllPriceHistory().catch(console.error);
  }
});

// ─── Broker (Alpaca) ──────────────────────────────────────────────────────────

app.get('/api/broker/config', (_req, res) => {
  const cfg = getBrokerConfig();
  res.json({
    mode: cfg.mode,
    hasKey: cfg.hasKey,
    hasSecret: cfg.hasSecret,
    maskedKey: cfg.maskedKey,
    maskedSecret: cfg.maskedSecret,
    connected: cfg.connected,
    updatedAt: cfg.updatedAt,
  });
});

app.post('/api/broker/config', (req, res) => {
  try {
    const updated = updateBrokerConfig({
      mode: req.body?.mode,
      apiKey: req.body?.apiKey,
      apiSecret: req.body?.apiSecret,
    });
    // Trigger sync if newly connected
    if (updated.connected) {
      syncToLocalPortfolio().catch(() => {});
    }
    res.json({ ok: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update broker config' });
  }
});

app.get('/api/broker/status', (_req, res) => {
  const readiness = getReadinessStatus();
  const config = getBrokerConfig();
  res.json({
    mode:      config.mode,
    connected: config.connected,
    hasKey:    config.hasKey,
    hasSecret: config.hasSecret,
    maskedKey: config.maskedKey,
    maskedSecret: config.maskedSecret,
    executionAllowed: readiness.liveExecutionAllowed || config.mode !== 'live',
    killSwitchEngaged: readiness.controls.killSwitchEngaged,
    eligibleForLive: readiness.eligibleForLive,
  });
});

app.all(['/api/broker/test'], async (req, res) => {
  const params = req.method === 'POST' ? req.body : undefined;
  const result = await testConnection(params);
  res.json(result);
});

app.get('/api/broker/account', async (_req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured' });
  try { res.json(await getAccount()); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.get('/api/broker/positions', async (_req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured' });
  try { res.json(await getPositions()); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.get('/api/broker/orders', async (req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured' });
  const status = (req.query.status as any) ?? 'closed';
  try { res.json(await getOrders(status, 50)); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.get('/api/broker/reconciliation-status', (_req, res) => {
  res.json(getReconciliationStatus());
});

app.post('/api/broker/reconcile', async (_req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured' });

  try {
    const result = await reconcileBrokerOrders();
    res.json({
      ok: true,
      result,
      status: getReconciliationStatus(),
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message ?? 'Broker reconciliation failed',
      status: getReconciliationStatus(),
    });
  }
});

app.get('/api/execution/recovery-status', (_req, res) => {
  res.json(getRecoveryStatus());
});

app.post('/api/execution/recover', async (_req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured' });

  try {
    const result = await recoverExecutionAttempts();
    res.json({
      ok: true,
      result,
      status: getRecoveryStatus(),
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message ?? 'Execution recovery failed',
      status: getRecoveryStatus(),
    });
  }
});

// Emergency kill switch — cancels all orders + closes all positions via Alpaca
app.post('/api/broker/kill-switch', async (_req, res) => {
  setKillSwitchEngaged(true);
  registry.stopAll();
  if (isBrokerConnected()) {
    try {
      await cancelAllOrders();
      await closeAllPositions();
      res.json({ ok: true, message: 'Agent stopped + all Alpaca positions closed', controls: getSystemControls() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  } else {
    res.json({ ok: true, message: 'Agent stopped (simulation mode — no broker positions)', controls: getSystemControls() });
  }
});

// Manual trade via broker
app.post('/api/broker/order', async (req, res) => {
  if (!isBrokerConnected()) return res.status(400).json({ error: 'Broker not configured — configure in .env' });
  const readiness = getReadinessStatus();
  if (getBrokerMode() === 'live' && !readiness.liveExecutionAllowed) {
    return res.status(403).json({ error: 'Live broker execution is locked until readiness gates pass and live execution is enabled.' });
  }
  const { symbol, side, qty } = req.body;
  if (!symbol || !side || !qty) return res.status(400).json({ error: 'Missing symbol, side, qty' });
  try {
    const order = await placeMarketOrder(symbol.toUpperCase(), side, Number(qty), `manual-${randomUUID()}`);
    syncToLocalPortfolio().catch(() => {});
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ─── Multi-Timeframe + Sector Rotation ───────────────────────────────────────

// Weekly snapshots for all watchlist symbols
app.get('/api/multitimeframe/all', (_req, res) => {
  const snapshots = getAllWeeklySnapshots(WATCHLIST);
  res.json(snapshots);
});

app.get('/api/multitimeframe/:symbol', (req, res) => {
  const sym  = req.params.symbol.toUpperCase();
  const snap = computeWeeklySnapshot(sym);
  if (!snap) return res.status(404).json({ error: `Insufficient weekly data for ${sym}` });
  res.json(snap);
});

// Sector rotation — returns all sectors sorted by 1W return
app.get('/api/sectors/performance', (_req, res) => {
  const sectors = calculateSectorPerformance();
  res.json(sectors);
});

app.get('/api/sectors/rotation-summary', (_req, res) => {
  const sectors = calculateSectorPerformance();
  res.json({ summary: getRotationSummary(sectors), sectors });
});

// ─── Backtesting ──────────────────────────────────────────────────────────────

app.get('/api/backtest/default-config', (_req, res) => {
  res.json(DEFAULT_CONFIG);
});

app.get('/api/replay/default-config', (_req, res) => {
  res.json(DEFAULT_CONFIG);
});

app.post('/api/backtest/run', (req, res) => {
  try {
    const config = { ...DEFAULT_CONFIG, ...req.body };
    const result = runBacktest(config);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Backtest failed' });
  }
});

app.post('/api/replay/run', (req, res) => {
  try {
    const config = { ...DEFAULT_CONFIG, ...req.body };
    const result = runBacktest(config);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Replay failed' });
  }
});

// ─── Performance Analytics ────────────────────────────────────────────────────

// Full performance metrics — trades P&L, Sharpe, Alpha, strategy feedback
app.get('/api/performance/metrics', async (_req, res) => {
  try {
    const metrics = await calculatePerformanceMetrics();
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Performance calculation failed' });
  }
});

// Lightweight: just portfolio value history for chart
app.get('/api/performance/history', (_req, res) => {
  res.json(getDailyReturnHistory());
});

app.get('/api/reports/daily', async (_req, res) => {
  try {
    res.json(await buildDailyReport());
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Daily report failed' });
  }
});

// ─── Screener ─────────────────────────────────────────────────────────────────

app.get('/api/screener/results', (_req, res) => {
  res.json(getLastScreenerResults());
});

app.post('/api/screener/run', async (req, res) => {
  res.json({ ok: true, message: 'Screen started in background' });
  runScreener().catch(console.error);
});

// ─── Filings (8-K) ────────────────────────────────────────────────────────────

app.get('/api/filings/recent', (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  res.json(getRecentFilings(days));
});

app.post('/api/filings/check', async (req, res) => {
  res.json({ ok: true, message: 'Filing check started in background' });
  const screenerSymbols = getLastScreenerResults().slice(0, 15).map(c => c.symbol);
  runFilingsCheck(screenerSymbols).catch(console.error);
});

// ─── Insider Trades (Form 4) ─────────────────────────────────────────────────

app.get('/api/insiders/recent', (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 60);
  const symbols = typeof req.query.symbol === 'string'
    ? req.query.symbol.split(',').map(symbol => symbol.trim().toUpperCase()).filter(Boolean)
    : undefined;
  res.json(getRecentInsiderTrades(symbols, days));
});

app.post('/api/insiders/check', (_req, res) => {
  res.json({ ok: true, message: 'Insider check started in background' });
  const symbols = [...new Set([...WATCHLIST, ...getLastScreenerResults().slice(0, 10).map(c => c.symbol)])];
  runInsidersCheck(symbols).catch(console.error);
});

// ─── Hedge Funds ──────────────────────────────────────────────────────────────

app.get('/api/hedge-funds/managers', (_req, res) => {
  res.json(getAllManagers());
});

app.get('/api/hedge-funds/changes', (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(getSignificantChanges(symbol, limit));
});

app.get('/api/hedge-funds/symbol/:symbol', (req, res) => {
  res.json(getHoldingsForSymbol(req.params.symbol.toUpperCase()));
});

app.get('/api/hedge-funds/overlap', (req, res) => {
  const minFunds = Math.max(2, Math.min(Number(req.query.minFunds) || 3, 10));
  res.json(getOverlapSymbols(minFunds));
});

app.get('/api/hedge-funds/smart-money', (_req, res) => {
  res.json(getSmartMoneySummary());
});

app.post('/api/hedge-funds/refresh', (_req, res) => {
  res.json({ ok: true, message: 'Hedge fund refresh started in background' });
  registry.trigger('hedge_fund').catch(console.error);
});

// ─── Macro ───────────────────────────────────────────────────────────────────

app.get('/api/macro/regime', (_req, res) => {
  res.json(getLatestMacroRegime());
});

app.get('/api/macro/indicators', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 60);
  res.json(getMacroIndicators(limit));
});

app.get('/api/macro/prompt-context', (_req, res) => {
  res.json({ context: getMacroPromptContext() });
});

// ─── Sentiment ───────────────────────────────────────────────────────────────

app.get('/api/sentiment/options', (_req, res) => {
  res.json(getOptionsFlow());
});

app.get('/api/sentiment/options/:symbol', (req, res) => {
  res.json(getOptionsFlow(req.params.symbol.toUpperCase()));
});

app.get('/api/sentiment/short-interest', (_req, res) => {
  res.json(getShortInterest());
});

app.get('/api/sentiment/squeeze-candidates', (_req, res) => {
  res.json(getSqueezeCandidates());
});

app.get('/api/market-breadth', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 90);
  res.json(getMarketBreadthHistory(limit));
});

// ─── Autonomy / PM ───────────────────────────────────────────────────────────

app.get('/api/autonomy/theses', (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(getLatestSymbolTheses({ symbol, limit, onlyFresh: req.query.fresh !== 'false' }));
});

app.get('/api/autonomy/decisions', (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.toUpperCase() : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({
    decisions: getLatestDecisionBatches(limit, symbol),
    intents: getPortfolioIntents(limit),
  });
});

app.get('/api/autonomy/forecasts', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const eventForecasts = db.prepare(`
    SELECT *
    FROM event_forecasts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];
  const marketForecasts = db.prepare(`
    SELECT *
    FROM market_forecasts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];
  res.json({ eventForecasts, marketForecasts });
});

app.get('/api/autonomy/lineage/:id', (req, res) => {
  res.json(getDecisionLineage(req.params.id));
});

app.get('/api/autonomy/calibration', (_req, res) => {
  res.json({
    calibration: getCalibrationSummary(),
    freshness: getAgentFreshnessStatus(),
  });
});

// ─── Agent Control ────────────────────────────────────────────────────────────

app.get(['/api/agents/status', '/api/agent/status'], (_req, res) => {
  res.json(registry.getAllStatuses());
});

app.post(['/api/agents/start-all', '/api/agent/start'], (_req, res) => {
  registry.startAll();
  res.json({ ok: true, statuses: registry.getAllStatuses() });
});

app.post(['/api/agents/stop-all', '/api/agent/stop'], (_req, res) => {
  registry.stopAll();
  res.json({ ok: true, statuses: registry.getAllStatuses() });
});

app.post('/api/agents/:name/start', (req, res) => {
  try {
    registry.start(req.params.name);
    res.json({ ok: true, status: registry.getAgent(req.params.name).getStatus() });
  } catch (err: any) {
    res.status(404).json({ error: err?.message ?? 'Unknown agent' });
  }
});

app.post('/api/agents/:name/stop', (req, res) => {
  try {
    registry.stop(req.params.name);
    res.json({ ok: true, status: registry.getAgent(req.params.name).getStatus() });
  } catch (err: any) {
    res.status(404).json({ error: err?.message ?? 'Unknown agent' });
  }
});

app.get('/api/agents/:name/logs', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(registry.getLogs(req.params.name, limit));
  } catch (err: any) {
    res.status(404).json({ error: err?.message ?? 'Unknown agent' });
  }
});

// ─── AI Provider & Budget Management ──────────────────────────────────────────

app.get('/api/ai/config', (_req, res) => {
  res.json(getAiConfig());
});

app.post('/api/ai/config', (req, res) => {
  try {
    const updated = updateAiConfig({
      provider: req.body?.provider,
      model: req.body?.model,
      apiKey: req.body?.apiKey,
      budgetLimitUsd: req.body?.budgetLimitUsd,
    });
    res.json({ ok: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update AI config' });
  }
});

app.post('/api/ai/reset-spend', (_req, res) => {
  res.json({ ok: true, config: resetAiSpend() });
});

app.get('/api/ai/models', async (req, res) => {
  try {
    const provider = (req.query.provider as AiProvider) || 'gemini';
    const apiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey : undefined;
    const models = await fetchModelsForProvider(provider, apiKey);
    res.json({ ok: true, models });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch models' });
  }
});

app.post('/api/ai/test', async (req, res) => {
  try {
    const result = await testAiConnection(
      req.body?.provider,
      req.body?.model,
      req.body?.apiKey
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Test failed' });
  }
});

app.get('/api/ai/usage', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ ok: true, history: getAiUsageHistory(limit), config: getAiConfig() });
});

// ─── Live Portfolio (server-side state) ──────────────────────────────────────

app.get('/api/portfolio/live', (_req, res) => {
  const state  = getPortfolioState();
  const prices = getCachedPrices();
  res.json({
    cash:       state.cash,
    positions:  state.positions,
    totalValue: getTotalValue(prices),
    prices,
    mode: getTradingMode(),
    degraded: getAgentStatus().degraded,
  });
});

app.get('/api/portfolio/exposures', (_req, res) => {
  res.json(calculatePortfolioExposures());
});

// Manual trade from UI — goes through the server portfolio so the agent sees it
app.post('/api/portfolio/trade', (req, res) => {
  const { action, symbol, shares, price } = req.body;
  if (!action || !symbol || !shares || !price) {
    return res.status(400).json({ error: 'Missing action, symbol, shares, price' });
  }
  const marketSession = getMarketSessionStatus();
  if (!marketSession.isOpen) {
    return res.status(400).json({ error: `Manual trades are blocked outside regular market hours. ${marketSession.note}` });
  }
  const degradation = refreshDegradationState();
  if (getTradingMode() === 'live' && !degradation.executionAllowedLive) {
    return res.status(400).json({ error: degradation.liveAutoLockReason ?? 'Live execution is auto-locked by degradation controls.' });
  }
  if (getTradingMode() === 'paper' && !degradation.executionAllowedPaper) {
    return res.status(400).json({ error: 'Paper execution is blocked because no valid execution price path is currently available.' });
  }

  const portfolioBefore = getTotalValue(getCachedPrices());
  const attemptId = createExecutionAttempt({
    symbol: symbol.toUpperCase(),
    action: action.toUpperCase() as 'BUY' | 'SELL',
    mode: getTradingMode(),
    status: 'planned',
    plannedShares: Number(shares),
    plannedPrice: Number(price),
    initialTargetShares: Number(shares),
    initialTargetValue: Number((Number(shares) * Number(price)).toFixed(2)),
    finalTargetShares: Number(shares),
    finalTargetValue: Number((Number(shares) * Number(price)).toFixed(2)),
    baseTargetWeight: 0,
    adjustedTargetWeight: 0,
    constructionBand: 'clean',
    constructionReason: 'Manual trades bypass autonomous pre-trade portfolio construction.',
    sizingMultiplier: 1,
    sizingBand: 'manual',
    sizingReason: 'Manual operator trade.',
    degradedExecution: degradation.severity !== 'none',
    degradationReasons: degradation.signals.filter(signal => signal.severity !== 'none').map(signal => signal.id),
    retryReason: 'manual_trade',
  });
  const ok = portfolioExecuteTrade(
    action.toUpperCase() as 'BUY' | 'SELL',
    symbol.toUpperCase(),
    Number(shares),
    Number(price)
  );

  if (ok) {
    // Save to trades audit trail
    db.prepare(`
      INSERT OR IGNORE INTO trades
        (id, symbol, action, shares, price, total_value, execution_attempt_id, entry_thesis, risk_check_passed,
         portfolio_value_before, status)
      VALUES
        (@id, @symbol, @action, @shares, @price, @total_value, @execution_attempt_id, @entry_thesis, 1,
         @portfolio_value_before, 'executed')
    `).run({
      id: Date.now().toString(),
      symbol:               symbol.toUpperCase(),
      action:               action.toUpperCase(),
      shares:               Number(shares),
      price:                Number(price),
      total_value:          Number(shares) * Number(price),
      execution_attempt_id: attemptId,
      entry_thesis:         'Manual trade via UI',
      portfolio_value_before: portfolioBefore,
    });
    updateExecutionAttempt(attemptId, {
      status: 'filled',
      filledShares: Number(shares),
      fillPrice: Number(price),
      slippageBps: 0,
    });
  } else {
    updateExecutionAttempt(attemptId, {
      status: 'rejected',
      error: 'Manual trade rejected by server portfolio',
    });
  }

  res.json({ ok });
});

// ─── Start + Background Scheduler ────────────────────────────────────────────

app.listen(PORT, API_HOST, () => {
  // Load portfolio state from DB before anything else
  loadFromDB();

  console.log(`\n[Backend] Running on http://${API_HOST}:${PORT}`);
  console.log('[Backend] Endpoints:');
  console.log('  GET  /api/health');
  console.log('  GET  /api/technical/all         — snapshots for Gemini prompt');
  console.log('  GET  /api/technical/:symbol     — single symbol snapshot');
  console.log('  POST /api/technical/refresh     — re-fetch OHLCV from Yahoo');
  console.log('  POST /api/news                  — save articles');
  console.log('  POST /api/analyses              — save AI analysis');
  console.log('  POST /api/trades                — save trade');
  console.log('  GET  /api/engine-logs           — fetch all logs');
  console.log('  GET  /api/knowledge/:symbol     — company knowledge');
  console.log('  GET  /api/portfolio/state       — latest snapshot\n');

  // 1. Initial OHLCV fetch (2s delay, non-blocking)
  console.log('[Backend] Scheduling initial OHLCV fetch...');
  setTimeout(() => {
    refreshAllPriceHistory().catch(err =>
      console.error('[Backend] Initial OHLCV fetch failed:', err)
    );
  }, 2000);

  // 2. Fundamental data fetch — only if stale or missing (runs after OHLCV)
  console.log('[Backend] Scheduling fundamentals refresh check...');
  setTimeout(async () => {
    const staleSymbols = WATCHLIST.filter(s => needsRefresh(s));
    if (staleSymbols.length > 0) {
      console.log(`[Backend] Refreshing fundamentals for ${staleSymbols.length} stale symbols...`);
      await refreshAllFundamentals(staleSymbols).catch(err =>
        console.error('[Backend] Fundamentals refresh failed:', err)
      );
    } else {
      console.log('[Backend] All fundamentals are up-to-date');
    }
  }, 6000); // after OHLCV starts

  // 3. Broker sync — if Alpaca is configured, sync portfolio state every 60s
  if (isBrokerConnected()) {
    console.log(`[Backend] Broker mode: ${getBrokerMode().toUpperCase()} — syncing from Alpaca...`);
    refreshDegradationState();
    syncToLocalPortfolio().catch(err => console.error('[Backend] Initial broker sync failed:', err?.message));
    reconcileBrokerOrders().catch(err => console.error('[Backend] Initial broker reconciliation failed:', err?.message));
    recoverExecutionAttempts().catch(err => console.error('[Backend] Initial execution recovery failed:', err?.message));
    setInterval(() => {
      refreshDegradationState();
      syncToLocalPortfolio().catch(() => {});
      reconcileBrokerOrders().catch(err => console.error('[Backend] Broker reconciliation failed:', err?.message));
      recoverExecutionAttempts().catch(err => console.error('[Backend] Execution recovery failed:', err?.message));
    }, 60_000);
  } else {
    console.log('[Backend] Broker mode: SIMULATION (no Alpaca keys configured)');
  }

  setInterval(() => {
    refreshDegradationState();
  }, 60_000);

  console.log('[Backend] Starting multi-agent registry...');
  registry.startAll();

  // Daily refresh at 1:00 AM local time
  scheduleDailyRefresh();
});

function scheduleDailyRefresh() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(1, 0, 0, 0);
  const msUntil = next.getTime() - now.getTime();

  setTimeout(() => {
    console.log('[Backend] Running scheduled daily OHLCV refresh...');
    refreshAllPriceHistory()
      .catch(err => console.error('[Backend] Daily refresh failed:', err))
      .finally(() => scheduleDailyRefresh()); // schedule next day
  }, msUntil);

  console.log(`[Backend] Next OHLCV refresh scheduled for ${next.toLocaleString()}`);
}

function calculatePortfolioExposures() {
  const state = getPortfolioState();
  const prices = getCachedPrices();
  const totalValue = getTotalValue(prices);
  const investedValue = state.positions.reduce((sum, position) => {
    return sum + Math.abs(position.shares) * (prices[position.symbol] ?? position.avgPrice);
  }, 0);

  const bySector = state.positions.reduce((acc, position) => {
    const row = db.prepare('SELECT sector FROM companies WHERE symbol = ?').get(position.symbol) as any;
    const sector = row?.sector ?? 'Unknown';
    const value = Math.abs(position.shares) * (prices[position.symbol] ?? position.avgPrice);
    acc[sector] = (acc[sector] ?? 0) + value;
    return acc;
  }, {} as Record<string, number>);

  return {
    cash: state.cash,
    totalValue,
    investedPct: totalValue > 0 ? investedValue / totalValue : 0,
    cashPct: totalValue > 0 ? state.cash / totalValue : 1,
    positions: state.positions.map(position => ({
      ...position,
      currentPrice: prices[position.symbol] ?? position.avgPrice,
      marketValue: position.shares * (prices[position.symbol] ?? position.avgPrice),
      grossMarketValue: Math.abs(position.shares) * (prices[position.symbol] ?? position.avgPrice),
      side: position.shares < 0 ? 'short' : 'long',
    })),
    sectors: Object.entries(bySector).map(([sector, value]) => ({
      sector,
      value,
      pct: totalValue > 0 ? value / totalValue : 0,
    })).sort((a, b) => b.value - a.value),
  };
}
