import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import {
  getCalibrationSummary,
  resolveForecastOutcomes,
  saveEventForecasts,
  saveMarketForecasts,
  saveSymbolTheses,
} from '../server/autonomy.js';
import { buildCommitteeDecisions } from '../server/portfolioManager.js';
import { syncFromBroker } from '../server/portfolio.js';
import { getSignalCandidates } from '../server/research.js';
import { buildDailyReport } from '../server/reports.js';

function cleanup(symbol: string): void {
  db.prepare(`DELETE FROM signal_candidates WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM portfolio_intents WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM trades WHERE symbol = ?`).run(symbol);

  const batchIds = (db.prepare(`SELECT id FROM decision_batches WHERE symbol = ?`).all(symbol) as Array<{ id: string }>)
    .map(row => row.id);
  for (const id of batchIds) {
    db.prepare(`DELETE FROM trades WHERE decision_batch_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM decision_batches WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM symbol_theses WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM agent_observations WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM event_forecasts WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM realized_outcomes WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM price_history WHERE symbol = ?`).run(symbol);
}

test('committee forces HOLD when critical coverage is missing', () => {
  const symbol = 'PMMISS';
  cleanup(symbol);

  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, decision_action, updated_at)
    VALUES
      ('hold-regression', ?, 'BUY', 42, 78, 'blocked', 'Old actionable candidate', '[]', '{}', 'BUY', unixepoch())
  `).run(symbol);

  saveSymbolTheses([
    {
      agentName: 'research_ingestion',
      sourceKey: 'research_ingestion',
      symbol,
      stance: 'BUY',
      confidence: 0.85,
      horizon: '1w',
      thesis: 'Research is strongly positive.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'hedge_fund',
      sourceKey: 'hedge_fund_13f',
      symbol,
      stance: 'BUY',
      confidence: 0.8,
      horizon: '1q',
      thesis: 'Smart money is accumulating.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const decisions = buildCommitteeDecisions({ macroRegime: 'neutral' });
  const decision = decisions.find(entry => entry.symbol === symbol);
  assert.ok(decision);
  assert.equal(decision?.action, 'HOLD');
  assert.equal(decision?.requiredCoverageMet, false);
  assert.match(decision?.heldOutReason ?? '', /Coverage gap/i);
  const candidateRow = db.prepare(`
    SELECT status, decision_action
    FROM signal_candidates
    WHERE symbol = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(symbol) as { status: string; decision_action: string | null } | undefined;
  assert.equal(candidateRow?.status, 'stale');
  assert.equal(candidateRow?.decision_action, 'HOLD');
  assert.equal(getSignalCandidates(25).some(candidate => candidate.symbol === symbol), false);

  cleanup(symbol);
});

test('committee penalizes disagreement across agents', () => {
  const symbol = 'PMDISC';
  cleanup(symbol);

  saveSymbolTheses([
    {
      agentName: 'research_ingestion',
      sourceKey: 'research_ingestion',
      symbol,
      stance: 'BUY',
      confidence: 0.9,
      horizon: '1w',
      thesis: 'Research is bullish.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol,
      stance: 'SELL',
      confidence: 0.95,
      horizon: '1w',
      thesis: 'Macro backdrop is hostile.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'sentiment',
      sourceKey: 'sentiment_options',
      symbol,
      stance: 'BUY',
      confidence: 0.95,
      horizon: '3d',
      thesis: 'Flow is strongly constructive.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'hedge_fund',
      sourceKey: 'hedge_fund_13f',
      symbol,
      stance: 'BUY',
      confidence: 0.9,
      horizon: '1q',
      thesis: 'Funds are accumulating.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'knowledge',
      sourceKey: 'knowledge_consolidation',
      symbol,
      stance: 'SELL',
      confidence: 0.9,
      horizon: '1m',
      thesis: 'Compound memory flags structural risk.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const decisions = buildCommitteeDecisions({ macroRegime: 'neutral' });
  const decision = decisions.find(entry => entry.symbol === symbol);
  assert.ok(decision);
  assert.equal(decision?.action, 'HOLD');
  assert.ok((decision?.disagreementPenalty ?? 0) >= 0.5);
  assert.match(decision?.heldOutReason ?? '', /disagreement/i);

  cleanup(symbol);
});

test('committee accepts neutral macro and sentiment coverage when research and knowledge align', () => {
  const symbol = 'PMCOVR';
  cleanup(symbol);

  saveSymbolTheses([
    {
      agentName: 'research_ingestion',
      sourceKey: 'research_ingestion',
      symbol,
      stance: 'BUY',
      confidence: 0.9,
      horizon: '1w',
      thesis: 'Research is bullish.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'knowledge',
      sourceKey: 'knowledge_consolidation',
      symbol,
      stance: 'BUY',
      confidence: 0.78,
      horizon: '1m',
      thesis: 'Compound knowledge confirms the setup.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol,
      stance: 'HOLD',
      confidence: 0.5,
      horizon: '1w',
      thesis: 'Macro regime is neutral.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'sentiment',
      sourceKey: 'sentiment_options',
      symbol,
      stance: 'HOLD',
      confidence: 0.5,
      horizon: '3d',
      thesis: 'No strong flow signal is present.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const decisions = buildCommitteeDecisions({ macroRegime: 'neutral' });
  const decision = decisions.find(entry => entry.symbol === symbol);
  assert.ok(decision);
  assert.equal(decision?.requiredCoverageMet, true);
  assert.equal(decision?.action, 'BUY');
  assert.equal(getSignalCandidates(25).some(candidate => candidate.symbol === symbol), true);

  cleanup(symbol);
});

test('committee emits ADD for an existing long when aligned agents stay bullish', () => {
  const symbol = 'PMADD';
  cleanup(symbol);
  syncFromBroker({ cash: 80_000, positions: [{ symbol, shares: 10, avgPrice: 100 }] });

  saveSymbolTheses([
    {
      agentName: 'research_ingestion',
      sourceKey: 'research_ingestion',
      symbol,
      stance: 'BUY',
      confidence: 0.88,
      horizon: '1w',
      thesis: 'Fresh research supports adding.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol,
      stance: 'BUY',
      confidence: 0.75,
      horizon: '1w',
      thesis: 'Macro regime is supportive.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    {
      agentName: 'sentiment',
      sourceKey: 'sentiment_options',
      symbol,
      stance: 'BUY',
      confidence: 0.76,
      horizon: '3d',
      thesis: 'Flow remains constructive.',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  ]);

  const decisions = buildCommitteeDecisions({ macroRegime: 'bull' });
  const decision = decisions.find(entry => entry.symbol === symbol);
  assert.ok(decision);
  assert.equal(decision?.action, 'ADD');
  assert.equal(decision?.stance, 'BUY');
  const candidate = getSignalCandidates(25).find(entry => entry.symbol === symbol);
  assert.ok(candidate);
  assert.equal(candidate?.action, 'BUY');
  assert.equal(candidate?.decisionAction, 'ADD');
  assert.equal(candidate?.actionable, true);

  cleanup(symbol);
  syncFromBroker({ cash: 100_000, positions: [] });
});

test('daily report blocked decisions exclude hold-only committee outcomes', async () => {
  const symbol = 'PMRPT';
  cleanup(symbol);

  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, decision_action, updated_at)
    VALUES
      ('report-hold', ?, 'BUY', -1, 49, 'blocked', 'Stale hold regression', '[]', '{}', 'HOLD', unixepoch())
  `).run(symbol);

  const report = await buildDailyReport();
  assert.equal(report.candidates.some(candidate => candidate.symbol === symbol), false);
  assert.equal(report.blockedDecisions.some(row => row.symbol === symbol), false);

  cleanup(symbol);
});

test('daily report decision trail reports realized sell P&L as percent', async () => {
  const symbol = 'PMPNL';
  cleanup(symbol);

  const nowSeconds = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, updated_at)
    VALUES
      ('report-pnl', ?, 'SELL', -22, 82, 'executed', 'Take profit on completed upside move.', '[]', '{}', unixepoch())
  `).run(symbol);

  db.prepare(`
    INSERT INTO trades
      (id, symbol, action, shares, price, total_value, candidate_id, status, created_at)
    VALUES
      ('buy-pnl', ?, 'BUY', 5, 100, 500, NULL, 'executed', ?),
      ('sell-pnl', ?, 'SELL', 5, 120, 600, 'report-pnl', 'executed', ?)
  `).run(symbol, nowSeconds - 300, symbol, nowSeconds - 60);

  const report = await buildDailyReport();
  const row = report.decisionTrail.find(entry => entry.candidateId === 'report-pnl');
  assert.ok(row);
  assert.equal(row?.pnl, 20);

  cleanup(symbol);
});

test('forecast resolution records realized outcomes and calibration metrics', () => {
  const symbol = 'PMFCST';
  cleanup(symbol);

  db.prepare(`
    INSERT OR REPLACE INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (?, '2026-01-02', 100, 101, 99, 100, 1000)
  `).run(symbol);
  db.prepare(`
    INSERT OR REPLACE INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (?, '2026-01-05', 106, 108, 105, 107, 1200)
  `).run(symbol);

  saveEventForecasts([{
    agentName: 'sentiment',
    sourceKey: 'sentiment_options',
    symbol,
    targetVariable: 'price_direction_3d',
    eventType: 'flow_follow_through',
    direction: 'up',
    probability: 0.8,
    confidence: 0.8,
    reasoning: 'Bullish flow should lift price.',
    windowStartAt: Date.parse('2026-01-02T00:00:00Z'),
    windowEndAt: Date.parse('2026-01-05T00:00:00Z'),
  }]);

  const result = resolveForecastOutcomes(Date.parse('2026-01-06T00:00:00Z'));
  const calibration = getCalibrationSummary();

  assert.equal(result.resolved, 1);
  assert.equal(result.expired, 0);
  assert.equal(calibration.overall.totalResolved >= 1, true);
  assert.equal(calibration.bySource.some(entry => entry.sourceKey === 'sentiment_options' && entry.hitRate === 1), true);

  cleanup(symbol);
});

test('market forecasts resolve against their explicit outcome symbol', () => {
  const sourceKey = 'forecast_target_test';
  db.prepare(`DELETE FROM market_forecasts WHERE source_key = ?`).run(sourceKey);
  db.prepare(`DELETE FROM realized_outcomes WHERE source_key = ?`).run(sourceKey);
  for (const [symbol, start, end] of [['SPY', 100, 90], ['AAPL', 100, 110]] as const) {
    db.prepare(`DELETE FROM price_history WHERE symbol = ? AND date IN ('2026-02-02', '2026-02-06')`).run(symbol);
    db.prepare(`INSERT INTO price_history (symbol, date, open, high, low, close, volume) VALUES (?, '2026-02-02', ?, ?, ?, ?, 1000)`).run(symbol, start, start, start, start);
    db.prepare(`INSERT INTO price_history (symbol, date, open, high, low, close, volume) VALUES (?, '2026-02-06', ?, ?, ?, ?, 1000)`).run(symbol, end, end, end, end);
  }

  saveMarketForecasts([{
    agentName: 'macro', sourceKey, scope: 'market', targetVariable: 'market_direction_5d',
    outcomeSymbol: 'SPY', direction: 'down', probability: 0.8, confidence: 0.8,
    reasoning: 'SPY should fall.', windowStartAt: Date.parse('2026-02-02T00:00:00Z'),
    windowEndAt: Date.parse('2026-02-06T00:00:00Z'),
  }]);

  const result = resolveForecastOutcomes(Date.parse('2026-02-07T00:00:00Z'));
  const outcome = db.prepare(`SELECT actual_direction, resolved_correct FROM realized_outcomes WHERE source_key = ?`).get(sourceKey) as any;
  assert.equal(result.resolved >= 1, true);
  assert.equal(outcome.actual_direction, 'down');
  assert.equal(outcome.resolved_correct, 1);

  db.prepare(`DELETE FROM market_forecasts WHERE source_key = ?`).run(sourceKey);
  db.prepare(`DELETE FROM realized_outcomes WHERE source_key = ?`).run(sourceKey);
});

test('legacy market forecasts without an outcome symbol expire without calibration', () => {
  const sourceKey = 'forecast_legacy_test';
  db.prepare(`DELETE FROM market_forecasts WHERE source_key = ?`).run(sourceKey);
  db.prepare(`DELETE FROM realized_outcomes WHERE source_key = ?`).run(sourceKey);

  saveMarketForecasts([{
    agentName: 'legacy', sourceKey, scope: 'market', targetVariable: 'market_direction',
    direction: 'up', probability: 0.7, confidence: 0.7, reasoning: 'Legacy row.',
    windowStartAt: Date.parse('2026-02-02T00:00:00Z'), windowEndAt: Date.parse('2026-02-06T00:00:00Z'),
  } as any]);

  resolveForecastOutcomes(Date.parse('2026-02-07T00:00:00Z'));
  const forecast = db.prepare(`SELECT status FROM market_forecasts WHERE source_key = ?`).get(sourceKey) as any;
  const outcomeCount = (db.prepare(`SELECT COUNT(*) AS count FROM realized_outcomes WHERE source_key = ?`).get(sourceKey) as any).count;
  assert.equal(forecast.status, 'expired');
  assert.equal(outcomeCount, 0);

  db.prepare(`DELETE FROM market_forecasts WHERE source_key = ?`).run(sourceKey);
});
