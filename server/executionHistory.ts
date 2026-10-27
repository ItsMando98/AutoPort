import db from './db.js';
import { getExecutionAttemptById, type ExecutionAttemptRecord } from './execution.js';

export interface ExecutionHistoryFilters {
  symbol?: string;
  status?: string;
  terminalPath?: string;
  retryBand?: string;
  degraded?: boolean;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface ExecutionHistoryRow {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  status: string;
  terminalPath: string | null;
  retryCount: number;
  strategyBand: string | null;
  timingBand: string | null;
  sizingBand: string | null;
  sizingMultiplier: number | null;
  initialTargetShares: number | null;
  finalTargetShares: number | null;
  initialTargetValue: number | null;
  finalTargetValue: number | null;
  baseTargetWeight: number | null;
  adjustedTargetWeight: number | null;
  constructionBand: string | null;
  constructionReason: string | null;
  plannedShares: number | null;
  filledShares: number | null;
  completionRatio: number | null;
  completionState: string | null;
  slippageBps: number | null;
  latencySeconds: number | null;
  createdAt: number;
  submittedAt: number | null;
  firstFillAt: number | null;
  lastFillAt: number | null;
  cancelledAt: number | null;
  rejectedAt: number | null;
  completedAt: number | null;
  brokerOrderId: string | null;
  brokerOrderIds: string[];
  rolloutProfile: string | null;
  sessionRegime: string | null;
  degradedExecution: boolean;
  degradationReasons: string[];
  candidateId: string | null;
  candidateReasoning: string | null;
  linkedTradeId: string | null;
  linkedTradeStatus: string | null;
  linkedTradePrice: number | null;
  linkedTradeShares: number | null;
  realizedPnl: number | null;
  stateHistory: Array<Record<string, any>>;
  error: string | null;
}

export interface ExecutionHistoryResponse {
  total: number;
  items: ExecutionHistoryRow[];
}

export interface ExecutionQualitySummaryRow {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile: string | null;
  sessionRegime: string | null;
  terminalPath: string;
  attempts: number;
  avgRetryCount: number | null;
  avgCompletionRatio: number | null;
  avgAbsSlippageBps: number | null;
  avgLatencySeconds: number | null;
  degradedAttempts: number;
}

export function getExecutionHistory(filters: ExecutionHistoryFilters = {}): ExecutionHistoryResponse {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.symbol) {
    conditions.push('symbol = ?');
    params.push(filters.symbol.toUpperCase());
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.terminalPath) {
    conditions.push('terminal_path = ?');
    params.push(filters.terminalPath);
  }
  if (filters.retryBand) {
    conditions.push('strategy_band = ?');
    params.push(filters.retryBand);
  }
  if (filters.degraded !== undefined) {
    conditions.push('degraded_execution = ?');
    params.push(filters.degraded ? 1 : 0);
  }
  if (filters.from) {
    conditions.push('created_at >= ?');
    params.push(Math.floor(filters.from / 1000));
  }
  if (filters.to) {
    conditions.push('created_at <= ?');
    params.push(Math.floor(filters.to / 1000));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM execution_attempts ${where}`).get(...params) as { count: number };
  const ids = db.prepare(`
    SELECT id
    FROM execution_attempts
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
    OFFSET ?
  `).all(...params, limit, offset) as Array<{ id: string }>;

  return {
    total: totalRow.count,
    items: ids
      .map(row => getExecutionAttemptById(row.id))
      .filter((attempt): attempt is ExecutionAttemptRecord => Boolean(attempt))
      .map(mapAttemptToHistoryRow),
  };
}

export function getExecutionQualitySummary(limit = 200): ExecutionQualitySummaryRow[] {
  const attempts = getExecutionHistory({ limit }).items.filter(item => item.terminalPath);
  const groups = new Map<string, ExecutionQualitySummaryRow & {
    retryTotal: number;
    completionTotal: number;
    completionCount: number;
    absSlipTotal: number;
    absSlipCount: number;
    latencyTotal: number;
    latencyCount: number;
  }>();

  for (const item of attempts) {
    const key = [
      item.symbol,
      item.action,
      item.mode,
      item.rolloutProfile ?? 'legacy',
      item.sessionRegime ?? 'legacy',
      item.terminalPath ?? 'unknown',
    ].join(':');
    const entry = groups.get(key) ?? {
      symbol: item.symbol,
      action: item.action,
      mode: item.mode,
      rolloutProfile: item.rolloutProfile ?? null,
      sessionRegime: item.sessionRegime ?? null,
      terminalPath: item.terminalPath ?? 'unknown',
      attempts: 0,
      avgRetryCount: null,
      avgCompletionRatio: null,
      avgAbsSlippageBps: null,
      avgLatencySeconds: null,
      degradedAttempts: 0,
      retryTotal: 0,
      completionTotal: 0,
      completionCount: 0,
      absSlipTotal: 0,
      absSlipCount: 0,
      latencyTotal: 0,
      latencyCount: 0,
    };

    entry.attempts += 1;
    entry.retryTotal += item.retryCount;
    entry.degradedAttempts += item.degradedExecution ? 1 : 0;
    if (item.completionRatio !== null) {
      entry.completionTotal += item.completionRatio;
      entry.completionCount += 1;
    }
    if (item.slippageBps !== null) {
      entry.absSlipTotal += Math.abs(item.slippageBps);
      entry.absSlipCount += 1;
    }
    if (item.latencySeconds !== null) {
      entry.latencyTotal += item.latencySeconds;
      entry.latencyCount += 1;
    }
    groups.set(key, entry);
  }

  return [...groups.values()]
    .map(entry => ({
      symbol: entry.symbol,
      action: entry.action,
      mode: entry.mode,
      rolloutProfile: entry.rolloutProfile,
      sessionRegime: entry.sessionRegime,
      terminalPath: entry.terminalPath,
      attempts: entry.attempts,
      avgRetryCount: Number((entry.retryTotal / entry.attempts).toFixed(2)),
      avgCompletionRatio: entry.completionCount > 0 ? Number((entry.completionTotal / entry.completionCount).toFixed(3)) : null,
      avgAbsSlippageBps: entry.absSlipCount > 0 ? Number((entry.absSlipTotal / entry.absSlipCount).toFixed(2)) : null,
      avgLatencySeconds: entry.latencyCount > 0 ? Number((entry.latencyTotal / entry.latencyCount).toFixed(2)) : null,
      degradedAttempts: entry.degradedAttempts,
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 100);
}

function mapAttemptToHistoryRow(attempt: ExecutionAttemptRecord): ExecutionHistoryRow {
  const trade = db.prepare(`
    SELECT id, status, price, shares, created_at
    FROM trades
    WHERE execution_attempt_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(attempt.id) as { id: string; status: string; price: number; shares: number; created_at: number } | undefined;

  const candidate = attempt.candidateId
    ? db.prepare(`SELECT reasoning FROM signal_candidates WHERE id = ? LIMIT 1`).get(attempt.candidateId) as { reasoning: string } | undefined
    : undefined;

  return {
    id: attempt.id,
    symbol: attempt.symbol,
    action: attempt.action,
    mode: attempt.mode,
    status: attempt.status,
    terminalPath: attempt.terminalPath ?? null,
    retryCount: attempt.retryCount ?? 0,
    strategyBand: attempt.strategyBand ?? null,
    timingBand: attempt.timingBand ?? null,
    sizingBand: attempt.sizingBand ?? null,
    sizingMultiplier: attempt.sizingMultiplier ?? null,
    initialTargetShares: attempt.initialTargetShares ?? null,
    finalTargetShares: attempt.finalTargetShares ?? null,
    initialTargetValue: attempt.initialTargetValue ?? null,
    finalTargetValue: attempt.finalTargetValue ?? null,
    baseTargetWeight: attempt.baseTargetWeight ?? null,
    adjustedTargetWeight: attempt.adjustedTargetWeight ?? null,
    constructionBand: attempt.constructionBand ?? null,
    constructionReason: attempt.constructionReason ?? null,
    plannedShares: attempt.plannedShares,
    filledShares: attempt.filledShares,
    completionRatio: attempt.completionRatio ?? null,
    completionState: attempt.completionState ?? null,
    slippageBps: attempt.slippageBps,
    latencySeconds: computeLatencySeconds(attempt),
    createdAt: attempt.createdAt,
    submittedAt: attempt.submittedAt ?? null,
    firstFillAt: attempt.firstFillAt ?? null,
    lastFillAt: attempt.lastFillAt ?? null,
    cancelledAt: attempt.cancelledAt ?? null,
    rejectedAt: attempt.rejectedAt ?? null,
    completedAt: attempt.completedAt ?? null,
    brokerOrderId: attempt.brokerOrderId,
    brokerOrderIds: attempt.brokerOrderIds ?? [],
    rolloutProfile: attempt.rolloutProfile ?? null,
    sessionRegime: attempt.sessionRegime ?? null,
    degradedExecution: attempt.degradedExecution ?? false,
    degradationReasons: attempt.degradationReasons ?? [],
    candidateId: attempt.candidateId,
    candidateReasoning: candidate?.reasoning ?? null,
    linkedTradeId: trade?.id ?? null,
    linkedTradeStatus: trade?.status ?? null,
    linkedTradePrice: trade?.price ?? null,
    linkedTradeShares: trade?.shares ?? null,
    realizedPnl: computeRealizedPnl(attempt.symbol, attempt.action, trade?.price ?? null, trade?.shares ?? null, trade?.created_at ?? null),
    stateHistory: attempt.stateHistory ?? [],
    error: attempt.error,
  };
}

function computeLatencySeconds(attempt: ExecutionAttemptRecord): number | null {
  const endAt = attempt.completedAt ?? attempt.lastFillAt ?? attempt.rejectedAt ?? attempt.cancelledAt ?? null;
  const startAt = attempt.submittedAt ?? attempt.createdAt;
  if (!endAt) return null;
  return Math.max(0, Math.round((endAt - startAt) / 1000));
}

function computeRealizedPnl(
  symbol: string,
  action: 'BUY' | 'SELL',
  tradePrice: number | null,
  tradeShares: number | null,
  tradeCreatedAt: number | null,
): number | null {
  if (!tradePrice || !tradeShares || !tradeCreatedAt) return null;

  if (action === 'SELL') {
    const firstBuy = db.prepare(`
      SELECT price
      FROM trades
      WHERE symbol = ? AND action = 'BUY' AND created_at <= ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(symbol, tradeCreatedAt) as { price: number } | undefined;
    if (!firstBuy?.price) return null;
    return Number(((tradePrice - firstBuy.price) * tradeShares).toFixed(2));
  }

  const firstSell = db.prepare(`
    SELECT price
    FROM trades
    WHERE symbol = ? AND action = 'SELL' AND created_at <= ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(symbol, tradeCreatedAt) as { price: number } | undefined;
  if (!firstSell?.price) return null;
  return Number(((firstSell.price - tradePrice) * tradeShares).toFixed(2));
}
