/**
 * Performance Analytics Module
 *
 * Calculates all investment metrics from stored trade and portfolio data.
 * Also generates "strategy feedback" text — injected into Gemini prompts
 * so the AI learns from its own track record over time.
 *
 * Metrics: P&L, Win Rate, Profit Factor, Sharpe, Sortino, Max Drawdown, Alpha vs SPY
 */

import db from './db.js';
import { getExecutionAttempts, type ExecutionAttemptRecord } from './execution.js';
import { getAutoResubmitCount } from './executionMeta.js';
import { refreshExecutionQualityProfiles } from './executionQualityProfiles.js';
import { fetchAndStoreOHLCV } from './technicals.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClosedTrade {
  symbol:      string;
  shares:      number;
  entryPrice:  number;
  exitPrice:   number;
  entryDate:   number;    // JS timestamp
  exitDate:    number;
  holdDays:    number;
  pnl:         number;    // dollar P&L
  returnPct:   number;    // % return
  entryCandidateId: string | null;
  exitCandidateId: string | null;
  entrySourceEventIds: string[];
  entryThesis: string | null;
  exitReason:  string | null;
}

export interface OpenPosition {
  symbol:       string;
  shares:       number;
  avgPrice:     number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPct: number;
}

export interface ConfidenceBucket {
  range:      string;     // e.g. "75-100"
  signals:    number;
  executed:   number;
  winRate:    number | null;
  avgReturn:  number | null;
}

export interface AttributionRow {
  key: string;
  trades: number;
  winRate: number | null;
  realizedPnl: number;
  avgReturn: number | null;
}

export interface PerformanceAttribution {
  bySource: AttributionRow[];
  byAction: AttributionRow[];
  bySector: AttributionRow[];
  byHoldBucket: AttributionRow[];
}

export interface ExecutionQualityCase {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  status: string;
  retryCount: number;
  latencySeconds: number;
  slippageBps: number | null;
  absSlippageBps: number | null;
  filledShares: number | null;
  plannedShares: number | null;
}

export interface ExecutionQualityMetrics {
  totalFillOutcomes: number;
  fullFills: number;
  partialOutcomes: number;
  resubmittedOutcomes: number;
  avgLatencySeconds: number | null;
  avgSignedSlippageBps: number | null;
  avgAbsSlippageBps: number | null;
  firstPassAvgLatencySeconds: number | null;
  resubmitAvgLatencySeconds: number | null;
  firstPassAvgAbsSlippageBps: number | null;
  resubmitAvgAbsSlippageBps: number | null;
  worstCases: ExecutionQualityCase[];
}

export interface PerformanceMetrics {
  // Returns
  totalReturnPct:   number;
  currentValue:     number;
  startingCapital:  number;
  // Closed trades
  closedTrades:     ClosedTrade[];
  openPositions:    OpenPosition[];
  totalTrades:      number;
  winningTrades:    number;
  losingTrades:     number;
  winRate:          number | null;
  profitFactor:     number | null;
  avgWinPct:        number | null;
  avgLossPct:       number | null;
  avgHoldDays:      number | null;
  totalRealizedPnl: number;
  // Risk
  maxDrawdownPct:   number;
  sharpeRatio:      number | null;
  sortinoRatio:     number | null;
  // Benchmark
  spyReturnPct:     number | null;
  alphaPct:         number | null;
  // Confidence calibration
  confidenceBuckets: ConfidenceBucket[];
  attribution: PerformanceAttribution;
  executionQuality: ExecutionQualityMetrics;
  // Summary for AI
  strategyFeedback: string;
}

// ─── Trade P&L Calculation (FIFO) ────────────────────────────────────────────

function calculateTradePnL(): { closed: ClosedTrade[]; openQueue: Record<string, any[]> } {
  const allTrades = db.prepare(`
    SELECT id, symbol, action, shares, price, candidate_id, source_event_ids, entry_thesis, exit_reason, created_at
    FROM trades
    ORDER BY created_at ASC
  `).all() as any[];

  const openQueue: Record<string, any[]> = {};
  const closed: ClosedTrade[] = [];

  for (const trade of allTrades) {
    const sym    = trade.symbol;
    const action = trade.action as 'BUY' | 'SELL';

    if (action === 'BUY') {
      if (!openQueue[sym]) openQueue[sym] = [];
      let remaining = trade.shares;

      while (remaining > 0 && openQueue[sym]?.length > 0 && openQueue[sym][0].shares < 0) {
        const open = openQueue[sym][0];
        const matched = Math.min(remaining, Math.abs(open.shares));
        const pnl = (open.price - trade.price) * matched;
        const returnPct = ((open.price - trade.price) / open.price) * 100;
        const holdDays = (trade.created_at - open.entryDate) / 86400;

        closed.push({
          symbol: sym,
          shares: matched,
          entryPrice: open.price,
          exitPrice: trade.price,
          entryDate: open.entryDate * 1000,
          exitDate: trade.created_at * 1000,
          holdDays: parseFloat(holdDays.toFixed(1)),
          pnl: parseFloat(pnl.toFixed(2)),
          returnPct: parseFloat(returnPct.toFixed(2)),
          entryCandidateId: open.candidateId ?? null,
          exitCandidateId: trade.candidate_id ?? null,
          entrySourceEventIds: open.sourceEventIds ?? [],
          entryThesis: open.entryThesis,
          exitReason: trade.exit_reason,
        });

        open.shares += matched;
        remaining -= matched;
        if (open.shares === 0) openQueue[sym].shift();
      }

      if (remaining > 0) {
        openQueue[sym].push({
          shares: remaining,
          price: trade.price,
          entryDate: trade.created_at,
          candidateId: trade.candidate_id ?? null,
          sourceEventIds: safeJson<string[]>(trade.source_event_ids, []),
          entryThesis: trade.entry_thesis,
        });
      }
    } else {
      if (!openQueue[sym]) openQueue[sym] = [];
      let remaining = trade.shares;

      while (remaining > 0 && openQueue[sym]?.length > 0 && openQueue[sym][0].shares > 0) {
        const open = openQueue[sym][0];
        const matched = Math.min(open.shares, remaining);

        const pnl       = (trade.price - open.price) * matched;
        const returnPct = ((trade.price - open.price) / open.price) * 100;
        const holdDays  = (trade.created_at - open.entryDate) / 86400;

        closed.push({
          symbol:      sym,
          shares:      matched,
          entryPrice:  open.price,
          exitPrice:   trade.price,
          entryDate:   open.entryDate * 1000,
          exitDate:    trade.created_at * 1000,
          holdDays:    parseFloat(holdDays.toFixed(1)),
          pnl:         parseFloat(pnl.toFixed(2)),
          returnPct:   parseFloat(returnPct.toFixed(2)),
          entryCandidateId: open.candidateId ?? null,
          exitCandidateId: trade.candidate_id ?? null,
          entrySourceEventIds: open.sourceEventIds ?? [],
          entryThesis: open.entryThesis,
          exitReason:  trade.exit_reason,
        });

        open.shares -= matched;
        remaining   -= matched;
        if (open.shares <= 0) openQueue[sym].shift();
      }

      if (remaining > 0) {
        openQueue[sym].push({
          shares: -remaining,
          price: trade.price,
          entryDate: trade.created_at,
          candidateId: trade.candidate_id ?? null,
          sourceEventIds: safeJson<string[]>(trade.source_event_ids, []),
          entryThesis: trade.entry_thesis,
        });
      }
    }
  }

  return { closed, openQueue };
}

// ─── Portfolio Value History ──────────────────────────────────────────────────

/**
 * Reconstructs portfolio value at each snapshot using stored price_history.
 * Falls back to avgPrice when historical price data is unavailable.
 */
function getPortfolioValueHistory(): { date: string; value: number }[] {
  const snapshots = db.prepare(`
    SELECT cash, positions, created_at
    FROM portfolio_snapshots
    ORDER BY created_at ASC
  `).all() as any[];

  const history: { date: string; value: number }[] = [];

  for (const snap of snapshots) {
    const date = new Date(snap.created_at * 1000).toISOString().split('T')[0];
    let value = snap.cash;

    try {
      const positions = JSON.parse(snap.positions ?? '[]');
      for (const pos of positions) {
        const priceRow = db.prepare(`
          SELECT close FROM price_history
          WHERE symbol = ? AND date <= ?
          ORDER BY date DESC LIMIT 1
        `).get(pos.symbol, date) as any;
        value += pos.shares * (priceRow?.close ?? pos.avgPrice);
      }
    } catch { /* use cash-only value */ }

    history.push({ date, value: parseFloat(value.toFixed(2)) });
  }

  // Deduplicate by date (keep latest per day)
  const byDate: Record<string, number> = {};
  for (const h of history) byDate[h.date] = h.value;
  return Object.entries(byDate)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Risk Metrics ─────────────────────────────────────────────────────────────

function calculateMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0;
  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return parseFloat((maxDD * 100).toFixed(2));
}

function calculateSharpe(dailyReturns: number[], riskFreeAnnual = 0.05): number | null {
  if (dailyReturns.length < 10) return null;
  const rf = riskFreeAnnual / 252;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return parseFloat(((mean - rf) / std * Math.sqrt(252)).toFixed(2));
}

function calculateSortino(dailyReturns: number[], riskFreeAnnual = 0.05): number | null {
  if (dailyReturns.length < 10) return null;
  const rf = riskFreeAnnual / 252;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const downsideReturns = dailyReturns.filter(r => r < rf);
  if (downsideReturns.length < 3) return null;
  const downVariance = downsideReturns.reduce((s, r) => s + (r - rf) ** 2, 0) / downsideReturns.length;
  const downStd = Math.sqrt(downVariance);
  if (downStd === 0) return null;
  return parseFloat(((mean - rf) / downStd * Math.sqrt(252)).toFixed(2));
}

// ─── SPY Benchmark ────────────────────────────────────────────────────────────

async function ensureSPYData(): Promise<void> {
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM price_history WHERE symbol = 'SPY'"
  ).get() as any;
  if ((row?.n ?? 0) < 20) {
    console.log('[Performance] Fetching SPY benchmark data...');
    await fetchAndStoreOHLCV('SPY', 6);
  }
}

function getSPYReturn(sinceDate: string): number | null {
  // Use 30-day comparison minimum for meaningful benchmark
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const compareSince = sinceDate < thirtyDaysAgo.toISOString().split('T')[0]
    ? sinceDate
    : thirtyDaysAgo.toISOString().split('T')[0];

  const rows = db.prepare(`
    SELECT close, date FROM price_history
    WHERE symbol = 'SPY' AND date >= ?
    ORDER BY date ASC
  `).all(compareSince) as any[];

  if (rows.length < 2) {
    // Fall back to all available SPY data
    const allRows = db.prepare(
      "SELECT close, date FROM price_history WHERE symbol = 'SPY' ORDER BY date ASC"
    ).all() as any[];
    if (allRows.length < 2) return null;
    const start = (allRows[0] as any).close;
    const end   = (allRows[allRows.length - 1] as any).close;
    return parseFloat(((end - start) / start * 100).toFixed(2));
  }

  const start = rows[0].close;
  const end   = rows[rows.length - 1].close;
  return parseFloat(((end - start) / start * 100).toFixed(2));
}

// ─── Confidence Calibration ───────────────────────────────────────────────────

function getConfidenceBuckets(): ConfidenceBucket[] {
  // Join analyses with subsequent price changes to see if signal was correct
  const buckets = [
    { range: '60-70', min: 60, max: 70 },
    { range: '70-80', min: 70, max: 80 },
    { range: '80-100', min: 80, max: 100 },
  ];

  return buckets.map(b => {
    const analyses = db.prepare(`
      SELECT a.symbol, a.action, a.confidence, a.price_at_analysis, a.created_at
      FROM analyses a
      WHERE a.confidence >= @min AND a.confidence < @max
        AND a.action IN ('BUY', 'SELL')
        AND a.price_at_analysis IS NOT NULL
        AND a.symbol != 'MARKET'
    `).all({ min: b.min, max: b.max }) as any[];

    // For each analysis, check if the price moved in the predicted direction
    let wins = 0;
    const returns: number[] = [];

    for (const a of analyses) {
      const checkDate = new Date(a.created_at * 1000);
      checkDate.setDate(checkDate.getDate() + 5); // 5-day forward return
      const futureDate = checkDate.toISOString().split('T')[0];

      const futureRow = db.prepare(`
        SELECT close FROM price_history
        WHERE symbol = ? AND date >= ?
        ORDER BY date ASC LIMIT 1
      `).get(a.symbol, futureDate) as any;

      if (!futureRow || !a.price_at_analysis) continue;

      const ret = (futureRow.close - a.price_at_analysis) / a.price_at_analysis * 100;
      const correct = (a.action === 'BUY' && ret > 0) || (a.action === 'SELL' && ret < 0);
      if (correct) wins++;
      returns.push(a.action === 'BUY' ? ret : -ret);
    }

    const evaluated = returns.length;
    return {
      range:     b.range,
      signals:   analyses.length,
      executed:  evaluated,
      winRate:   evaluated >= 3 ? parseFloat((wins / evaluated * 100).toFixed(1)) : null,
      avgReturn: evaluated >= 3 ? parseFloat((returns.reduce((a, b) => a + b, 0) / evaluated).toFixed(2)) : null,
    };
  });
}

// ─── Current Portfolio Value ──────────────────────────────────────────────────

function getCurrentPortfolioValue(): number {
  // Use the most recent snapshot
  const row = db.prepare(`
    SELECT cash, positions FROM portfolio_snapshots
    ORDER BY created_at DESC LIMIT 1
  `).get() as any;

  if (!row) return 100_000;

  let value = row.cash;
  try {
    const positions = JSON.parse(row.positions ?? '[]');
    for (const pos of positions) {
      const priceRow = db.prepare(`
        SELECT close FROM price_history WHERE symbol = ?
        ORDER BY date DESC LIMIT 1
      `).get(pos.symbol) as any;
      value += pos.shares * (priceRow?.close ?? pos.avgPrice);
    }
  } catch { /* use cash */ }
  return value;
}

function getCurrentOpenPositions(): OpenPosition[] {
  const row = db.prepare(`
    SELECT positions FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 1
  `).get() as any;
  if (!row) return [];

  try {
    const positions = JSON.parse(row.positions ?? '[]');
    return positions.map((pos: any) => {
      const priceRow = db.prepare(
        'SELECT close FROM price_history WHERE symbol = ? ORDER BY date DESC LIMIT 1'
      ).get(pos.symbol) as any;
      const currentPrice = priceRow?.close ?? pos.avgPrice;
      const unrealizedPnl = (currentPrice - pos.avgPrice) * pos.shares;
      const unrealizedPct = pos.shares >= 0
        ? ((currentPrice - pos.avgPrice) / pos.avgPrice) * 100
        : ((pos.avgPrice - currentPrice) / pos.avgPrice) * 100;
      return {
        symbol:         pos.symbol,
        shares:         pos.shares,
        avgPrice:       pos.avgPrice,
        currentPrice,
        unrealizedPnl:  parseFloat(unrealizedPnl.toFixed(2)),
        unrealizedPct:  parseFloat(unrealizedPct.toFixed(2)),
      };
    });
  } catch {
    return [];
  }
}

function buildAttribution(closed: ClosedTrade[]): PerformanceAttribution {
  const sourceByCandidateId = getPrimarySourceByCandidateId();
  return {
    bySource: aggregateAttribution(closed, trade => {
      const directSource = getPrimarySourceFromEventIds(trade.entrySourceEventIds);
      if (directSource) return directSource;
      if (trade.entryCandidateId && sourceByCandidateId[trade.entryCandidateId]) {
        return sourceByCandidateId[trade.entryCandidateId];
      }
      if (trade.exitCandidateId && sourceByCandidateId[trade.exitCandidateId]) {
        return sourceByCandidateId[trade.exitCandidateId];
      }
      return 'unknown';
    }),
    byAction: aggregateAttribution(closed, trade => trade.returnPct >= 0 ? 'winning_exit' : 'losing_exit'),
    bySector: aggregateAttribution(closed, trade => {
      const row = db.prepare('SELECT sector FROM companies WHERE symbol = ?').get(trade.symbol) as any;
      return row?.sector ?? 'Unknown';
    }),
    byHoldBucket: aggregateAttribution(closed, trade => {
      if (trade.holdDays <= 3) return '0-3d';
      if (trade.holdDays <= 10) return '4-10d';
      if (trade.holdDays <= 20) return '11-20d';
      return '21d+';
    }),
  };
}

function getPrimarySourceByCandidateId(): Record<string, string> {
  const rows = db.prepare(`
    SELECT sc.id, sc.source_event_ids
    FROM signal_candidates sc
    ORDER BY sc.updated_at DESC
  `).all() as any[];

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (result[row.id]) continue;
    const ids = safeJson<string[]>(row.source_event_ids, []);
    result[row.id] = getPrimarySourceFromEventIds(ids) ?? 'unknown';
  }
  return result;
}

function getPrimarySourceFromEventIds(ids: string[]): string | null {
  if (ids.length === 0) return null;

  const sourceRows = db.prepare(`
    SELECT source_type FROM research_events
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as Array<{ source_type: string }>;
  const counts = sourceRows.reduce((acc, sourceRow) => {
    acc[sourceRow.source_type] = (acc[sourceRow.source_type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function aggregateAttribution(closed: ClosedTrade[], keyFn: (trade: ClosedTrade) => string): AttributionRow[] {
  const grouped = closed.reduce((acc, trade) => {
    const key = keyFn(trade);
    if (!acc[key]) acc[key] = [];
    acc[key].push(trade);
    return acc;
  }, {} as Record<string, ClosedTrade[]>);

  return Object.entries(grouped)
    .map(([key, trades]) => {
      const winners = trades.filter(trade => trade.pnl > 0);
      return {
        key,
        trades: trades.length,
        winRate: trades.length > 0 ? parseFloat(((winners.length / trades.length) * 100).toFixed(1)) : null,
        realizedPnl: parseFloat(trades.reduce((sum, trade) => sum + trade.pnl, 0).toFixed(2)),
        avgReturn: trades.length > 0 ? parseFloat((trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length).toFixed(2)) : null,
      };
    })
    .sort((a, b) => b.realizedPnl - a.realizedPnl);
}

// ─── Strategy Feedback Text ───────────────────────────────────────────────────

function generateStrategyFeedback(
  closed: ClosedTrade[],
  winRate: number | null,
  profitFactor: number | null,
  sharpe: number | null,
  maxDD: number,
  alphaPct: number | null,
  buckets: ConfidenceBucket[]
): string {
  if (closed.length === 0 && buckets.every(b => b.executed < 3)) {
    return 'Insufficient trade history for feedback. Keep analyzing — patterns emerge after 20+ completed trades.';
  }

  const lines: string[] = [];

  // Overall stats
  if (winRate !== null) {
    const wr = winRate.toFixed(1);
    const pf = profitFactor?.toFixed(2) ?? 'N/A';
    lines.push(`Win Rate: ${wr}% | Profit Factor: ${pf} | Max Drawdown: ${maxDD.toFixed(1)}%`);
    if (sharpe !== null) lines.push(`Sharpe Ratio: ${sharpe} (annualized)`);
    if (alphaPct !== null) {
      lines.push(`Alpha vs SPY: ${alphaPct >= 0 ? '+' : ''}${alphaPct.toFixed(1)}%`);
    }
  }

  // Recent best/worst
  if (closed.length > 0) {
    const sorted  = [...closed].sort((a, b) => b.returnPct - a.returnPct);
    const bestStr = sorted.slice(0, 2).map(t => `${t.symbol} +${t.returnPct.toFixed(1)}%`).join(', ');
    const worstStr = sorted.slice(-2).reverse().map(t => `${t.symbol} ${t.returnPct.toFixed(1)}%`).join(', ');
    if (bestStr)  lines.push(`Best trades: ${bestStr}`);
    if (worstStr) lines.push(`Worst trades: ${worstStr}`);
  }

  // Confidence calibration
  const calibLines: string[] = [];
  for (const b of buckets) {
    if (b.executed < 3) continue;
    const wr = b.winRate?.toFixed(0) ?? 'N/A';
    const ar = b.avgReturn !== null ? (b.avgReturn >= 0 ? '+' : '') + b.avgReturn.toFixed(1) + '%' : '';
    calibLines.push(`  Confidence ${b.range}%: ${wr}% win rate, avg 5d return ${ar}`);
  }
  if (calibLines.length > 0) {
    lines.push('Confidence calibration (5-day forward returns):');
    lines.push(...calibLines);
  }

  // Automated advice based on patterns
  const advice: string[] = [];

  if (winRate !== null && winRate < 45) {
    advice.push('Win rate below 50% — raise your entry standards, wait for stronger confluence');
  }
  if (buckets[2]?.winRate !== null && (buckets[2].winRate ?? 100) < 50) {
    advice.push('High-confidence signals (80%+) underperforming — you are overconfident; reduce position sizes');
  }
  if (maxDD > 10) {
    advice.push(`Max drawdown ${maxDD.toFixed(1)}% — consider tighter stop-losses or smaller positions`);
  }
  if (alphaPct !== null && alphaPct < -5) {
    advice.push('Underperforming SPY — consider if active trading adds value vs. benchmark');
  }
  if (buckets[0]?.winRate !== null && (buckets[0].winRate ?? 0) > 65) {
    advice.push('Lower-confidence signals (60-70%) have good accuracy — trust more moderate signals');
  }

  if (advice.length > 0) {
    lines.push('Actionable insights:');
    advice.forEach(a => lines.push(`→ ${a}`));
  }

  return lines.length > 0
    ? lines.join('\n')
    : 'Track record building... continue analyzing for meaningful patterns.';
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function calculatePerformanceMetrics(): Promise<PerformanceMetrics> {
  // Ensure SPY data exists for benchmark
  await ensureSPYData().catch(() => { /* non-fatal */ });

  const STARTING_CAPITAL = 100_000;
  const currentValue     = getCurrentPortfolioValue();
  const totalReturnPct   = ((currentValue - STARTING_CAPITAL) / STARTING_CAPITAL) * 100;

  // Trade P&L
  const { closed, openQueue } = calculateTradePnL();
  const open = getCurrentOpenPositions();

  const totalTrades    = closed.length;
  const winners        = closed.filter(t => t.pnl > 0);
  const losers         = closed.filter(t => t.pnl <= 0);
  const winRate        = totalTrades >= 3 ? parseFloat((winners.length / totalTrades * 100).toFixed(1)) : null;
  const grossGains     = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLosses    = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor   = totalTrades >= 3 && grossLosses > 0 ? parseFloat((grossGains / grossLosses).toFixed(2)) : null;
  const avgWinPct      = winners.length > 0 ? parseFloat((winners.reduce((s, t) => s + t.returnPct, 0) / winners.length).toFixed(2)) : null;
  const avgLossPct     = losers.length > 0  ? parseFloat((losers.reduce((s, t) => s + t.returnPct, 0) / losers.length).toFixed(2)) : null;
  const avgHoldDays    = totalTrades > 0 ? parseFloat((closed.reduce((s, t) => s + t.holdDays, 0) / totalTrades).toFixed(1)) : null;
  const totalRealPnl   = parseFloat(closed.reduce((s, t) => s + t.pnl, 0).toFixed(2));

  // Portfolio value history → daily returns
  const history       = getPortfolioValueHistory();
  const values        = history.map(h => h.value);
  const maxDrawdown   = calculateMaxDrawdown([STARTING_CAPITAL, ...values]);

  const dailyReturns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    dailyReturns.push((values[i] - values[i - 1]) / values[i - 1]);
  }
  const sharpeRatio  = calculateSharpe(dailyReturns);
  const sortinoRatio = calculateSortino(dailyReturns);

  // SPY benchmark from portfolio start
  const portfolioStartDate = history.length > 0
    ? history[0].date
    : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const spyReturnPct = getSPYReturn(portfolioStartDate);
  const alphaPct     = spyReturnPct !== null
    ? parseFloat((totalReturnPct - spyReturnPct).toFixed(2))
    : null;

  // Confidence calibration
  const confidenceBuckets = getConfidenceBuckets();
  const attribution = buildAttribution(closed);
  refreshExecutionQualityProfiles();
  const executionQuality = summarizeExecutionQuality(getExecutionAttempts(250));

  // Strategy feedback
  const strategyFeedback = generateStrategyFeedback(
    closed, winRate, profitFactor, sharpeRatio, maxDrawdown, alphaPct, confidenceBuckets
  );

  return {
    totalReturnPct:   parseFloat(totalReturnPct.toFixed(2)),
    currentValue:     parseFloat(currentValue.toFixed(2)),
    startingCapital:  STARTING_CAPITAL,
    closedTrades:     closed,
    openPositions:    open,
    totalTrades,
    winningTrades:    winners.length,
    losingTrades:     losers.length,
    winRate,
    profitFactor,
    avgWinPct,
    avgLossPct,
    avgHoldDays,
    totalRealizedPnl: totalRealPnl,
    maxDrawdownPct:   maxDrawdown,
    sharpeRatio,
    sortinoRatio,
    spyReturnPct,
    alphaPct,
    confidenceBuckets,
    attribution,
    executionQuality,
    strategyFeedback,
  };
}

export function summarizeExecutionQuality(attempts: ExecutionAttemptRecord[]): ExecutionQualityMetrics {
  const fillOutcomes = attempts.filter(attempt => (attempt.filledShares ?? 0) > 0 && attempt.fillPrice !== null);
  const firstPass = fillOutcomes.filter(attempt => getAutoResubmitCount(attempt.retryReason) === 0);
  const resubmitted = fillOutcomes.filter(attempt => getAutoResubmitCount(attempt.retryReason) > 0);

  const toAvg = (values: number[]): number | null =>
    values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

  const latencyOf = (attempt: ExecutionAttemptRecord) =>
    Math.max(0, Math.round((attempt.updatedAt - attempt.createdAt) / 1000));

  const absSlipOf = (attempt: ExecutionAttemptRecord) =>
    attempt.slippageBps === null ? null : Number(Math.abs(attempt.slippageBps).toFixed(2));

  const worstCases = fillOutcomes
    .map<ExecutionQualityCase>(attempt => ({
      id: attempt.id,
      symbol: attempt.symbol,
      action: attempt.action,
      status: attempt.status,
      retryCount: getAutoResubmitCount(attempt.retryReason),
      latencySeconds: latencyOf(attempt),
      slippageBps: attempt.slippageBps,
      absSlippageBps: absSlipOf(attempt),
      filledShares: attempt.filledShares,
      plannedShares: attempt.plannedShares,
    }))
    .sort((a, b) => (b.absSlippageBps ?? -1) - (a.absSlippageBps ?? -1) || b.latencySeconds - a.latencySeconds)
    .slice(0, 5);

  return {
    totalFillOutcomes: fillOutcomes.length,
    fullFills: fillOutcomes.filter(attempt => attempt.status === 'filled').length,
    partialOutcomes: fillOutcomes.filter(attempt => attempt.status !== 'filled').length,
    resubmittedOutcomes: resubmitted.length,
    avgLatencySeconds: toAvg(fillOutcomes.map(latencyOf)),
    avgSignedSlippageBps: toAvg(fillOutcomes.flatMap(attempt => attempt.slippageBps === null ? [] : [attempt.slippageBps])),
    avgAbsSlippageBps: toAvg(fillOutcomes.flatMap(attempt => absSlipOf(attempt) === null ? [] : [absSlipOf(attempt)!])),
    firstPassAvgLatencySeconds: toAvg(firstPass.map(latencyOf)),
    resubmitAvgLatencySeconds: toAvg(resubmitted.map(latencyOf)),
    firstPassAvgAbsSlippageBps: toAvg(firstPass.flatMap(attempt => absSlipOf(attempt) === null ? [] : [absSlipOf(attempt)!])),
    resubmitAvgAbsSlippageBps: toAvg(resubmitted.flatMap(attempt => absSlipOf(attempt) === null ? [] : [absSlipOf(attempt)!])),
    worstCases,
  };
}

/** Returns just the feedback text — cached version for Gemini prompt injection. */
let feedbackCache: { text: string; at: number } = { text: '', at: 0 };

export async function getStrategyFeedbackForPrompt(): Promise<string> {
  // Refresh cache every 10 minutes
  if (Date.now() - feedbackCache.at < 10 * 60_000 && feedbackCache.text) {
    return feedbackCache.text;
  }
  try {
    const metrics = await calculatePerformanceMetrics();
    feedbackCache = { text: metrics.strategyFeedback, at: Date.now() };
    return metrics.strategyFeedback;
  } catch {
    return 'Performance metrics unavailable.';
  }
}

/** Simple daily return from portfolio value history — for quick display. */
export function getDailyReturnHistory(): { date: string; value: number; returnPct: number }[] {
  const history = getPortfolioValueHistory();
  return history.map((h, i) => ({
    date:      h.date,
    value:     h.value,
    returnPct: i === 0 ? 0 : parseFloat(((h.value - 100_000) / 100_000 * 100).toFixed(2)),
  }));
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
