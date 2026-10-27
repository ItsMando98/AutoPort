import db from './db.js';
import { getStatus as getAgentStatus } from './agent.js';
import { evaluateAdaptiveResubmitPolicy, evaluateExecutionRecoveryTimingPolicy, evaluateExecutionResubmitStrategyPolicy } from './executionPolicy.js';
import { getExecutionAttempts, type ExecutionAttemptRecord } from './execution.js';
import { getAutoResubmitCount } from './executionMeta.js';
import { refreshExecutionQualityProfiles } from './executionQualityProfiles.js';
import { getMarketSessionStatus } from './marketclock.js';
import { getFreshnessSummary } from './ops.js';
import { calculatePerformanceMetrics } from './performance.js';
import { getRecentResearchEvents, getSignalCandidates, type SignalCandidate } from './research.js';
import { getRecoveryStatus } from './recovery.js';
import { getReconciliationStatus } from './reconciliation.js';
import { getTradingMode } from './runtime.js';

interface RiskEventRow {
  allowed: number;
  failed_check: string | null;
}

export interface CandidateFunnelSummary {
  total: number;
  new: number;
  pendingApproval: number;
  inFlight: number;
  executed: number;
  blocked: number;
  stale: number;
  buy: number;
  sell: number;
  highConfidence: number;
}

export interface ExecutionLifecycleSummary {
  total: number;
  planned: number;
  submitted: number;
  submittedUnknown: number;
  partiallyFilled: number;
  filled: number;
  rejected: number;
  cancelled: number;
  fillRate: number | null;
}

export interface RiskSummary {
  total: number;
  blocked: number;
  passed: number;
  topBlockReasons: Array<{ reason: string; count: number }>;
}

export interface ExecutionOpsSummary {
  active: number;
  submitted: number;
  submittedUnknown: number;
  partiallyFilled: number;
  stale: number;
  autoRecoveryTagged: number;
  blockedTerminal: number;
  items: Array<{
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    status: string;
    ageMinutes: number;
    stale: boolean;
    retryReason: string | null;
    error: string | null;
    plannedShares: number | null;
    filledShares: number | null;
    retryCount: number;
    rolloutProfile: string | null;
    sessionRegime: string | null;
    policyBand: 'blocked' | 'tightened' | 'base' | 'loosened';
    policyReason: string;
    maxResubmits: number;
    recoveryTimingBand: 'accelerated' | 'base' | 'extended';
    recoveryTimingReason: string;
    staleAfterMinutes: number;
    resubmitCooldownMinutes: number;
    resubmitStrategyBand: 'aggressive' | 'base' | 'reduced' | 'halt_partial';
    resubmitStrategyReason: string;
    resubmitSizePct: number;
    allowPartialResubmit: boolean;
  }>;
}

export interface DecisionTrailRow {
  candidateId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  decisionAction: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | null;
  actionable: boolean;
  decisionBatchId: string | null;
  candidateStatus: string;
  executionStatus: string | null;
  confidence: number;
  score: number;
  reasoning: string;
  heldOutReason: string | null;
  sourceTypes: string[];
  eventTitles: string[];
  fillPrice: number | null;
  plannedShares: number | null;
  filledShares: number | null;
  pnl: number | null;
  exitReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConstructionSummary {
  clean: number;
  reduced: number;
  severe: number;
}

export function summarizeCandidateFunnel(candidates: SignalCandidate[]): CandidateFunnelSummary {
  return candidates.reduce<CandidateFunnelSummary>((summary, candidate) => {
    summary.total += 1;
    summary.new += candidate.status === 'new' ? 1 : 0;
    summary.pendingApproval += candidate.status === 'pending_approval' ? 1 : 0;
    summary.inFlight += candidate.status === 'in_flight' ? 1 : 0;
    summary.executed += candidate.status === 'executed' ? 1 : 0;
    summary.blocked += candidate.status === 'blocked' ? 1 : 0;
    summary.stale += candidate.status === 'stale' ? 1 : 0;
    summary.buy += candidate.action === 'BUY' ? 1 : 0;
    summary.sell += candidate.action === 'SELL' ? 1 : 0;
    summary.highConfidence += candidate.confidence >= 75 ? 1 : 0;
    return summary;
  }, {
    total: 0,
    new: 0,
    pendingApproval: 0,
    inFlight: 0,
    executed: 0,
    blocked: 0,
    stale: 0,
    buy: 0,
    sell: 0,
    highConfidence: 0,
  });
}

export function summarizeExecutionLifecycle(attempts: ExecutionAttemptRecord[]): ExecutionLifecycleSummary {
  const summary = attempts.reduce<ExecutionLifecycleSummary>((acc, attempt) => {
    acc.total += 1;
    acc.planned += attempt.status === 'planned' ? 1 : 0;
    acc.submitted += attempt.status === 'submitted' ? 1 : 0;
    acc.submittedUnknown += attempt.status === 'submitted_unknown' ? 1 : 0;
    acc.partiallyFilled += attempt.status === 'partially_filled' ? 1 : 0;
    acc.filled += attempt.status === 'filled' ? 1 : 0;
    acc.rejected += attempt.status === 'rejected' ? 1 : 0;
    acc.cancelled += attempt.status === 'cancelled' ? 1 : 0;
    return acc;
  }, {
    total: 0,
    planned: 0,
    submitted: 0,
    submittedUnknown: 0,
    partiallyFilled: 0,
    filled: 0,
    rejected: 0,
    cancelled: 0,
    fillRate: null,
  });

  summary.fillRate = summary.total > 0
    ? parseFloat(((summary.filled / summary.total) * 100).toFixed(1))
    : null;

  return summary;
}

export function summarizeConstructionBands(attempts: ExecutionAttemptRecord[]): ConstructionSummary {
  return attempts.reduce<ConstructionSummary>((summary, attempt) => {
    if (attempt.constructionBand === 'reduced') summary.reduced += 1;
    else if (attempt.constructionBand === 'severe') summary.severe += 1;
    else summary.clean += 1;
    return summary;
  }, {
    clean: 0,
    reduced: 0,
    severe: 0,
  });
}

export function summarizeRiskEvents(rows: RiskEventRow[]): RiskSummary {
  const blocked = rows.filter(row => row.allowed === 0);
  const counts = blocked.reduce((acc, row) => {
    const key = row.failed_check ?? 'Unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    total: rows.length,
    blocked: blocked.length,
    passed: rows.length - blocked.length,
    topBlockReasons: Object.entries(counts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function summarizeExecutionOps(attempts: ExecutionAttemptRecord[], now = Date.now()): ExecutionOpsSummary {
  refreshExecutionQualityProfiles();
  const activeAttempts = attempts.filter(
    (attempt): attempt is ExecutionAttemptRecord & { status: 'submitted' | 'submitted_unknown' | 'partially_filled' } =>
      attempt.status === 'submitted' || attempt.status === 'submitted_unknown' || attempt.status === 'partially_filled'
  );
  const items = activeAttempts
    .map(attempt => {
      const ageMinutes = parseFloat(((now - attempt.updatedAt) / 60_000).toFixed(1));
      const retryCount = getAutoResubmitCount(attempt.retryReason);
      const policy = evaluateAdaptiveResubmitPolicy({
        symbol: attempt.symbol,
        action: attempt.action,
        mode: attempt.mode,
        currentRetryCount: retryCount,
        rolloutProfile: attempt.rolloutProfile ?? null,
        sessionRegime: attempt.sessionRegime ?? null,
        refreshProfiles: false,
      });
      const timing = evaluateExecutionRecoveryTimingPolicy({
        symbol: attempt.symbol,
        action: attempt.action,
        mode: attempt.mode,
        rolloutProfile: attempt.rolloutProfile ?? null,
        sessionRegime: attempt.sessionRegime ?? null,
        refreshProfiles: false,
      });
      const strategy = evaluateExecutionResubmitStrategyPolicy({
        symbol: attempt.symbol,
        action: attempt.action,
        mode: attempt.mode,
        rolloutProfile: attempt.rolloutProfile ?? null,
        sessionRegime: attempt.sessionRegime ?? null,
        refreshProfiles: false,
      });
      const staleAfterMinutes = Number((
        (attempt.status === 'partially_filled'
          ? Math.max(timing.partialTimeoutMs, timing.resubmitCooldownMs)
          : Math.max(timing.submittedTimeoutMs, timing.resubmitCooldownMs)) / 60_000
      ).toFixed(1));
      return {
        id: attempt.id,
        symbol: attempt.symbol,
        action: attempt.action,
        status: attempt.status,
        ageMinutes,
        stale: ageMinutes >= staleAfterMinutes,
        retryReason: attempt.retryReason,
        error: attempt.error,
        plannedShares: attempt.plannedShares,
        filledShares: attempt.filledShares,
        retryCount,
        rolloutProfile: attempt.rolloutProfile ?? null,
        sessionRegime: attempt.sessionRegime ?? null,
        policyBand: policy.band,
        policyReason: policy.reason,
        maxResubmits: policy.maxResubmits,
        recoveryTimingBand: timing.band,
        recoveryTimingReason: timing.reason,
        staleAfterMinutes,
        resubmitCooldownMinutes: Number((timing.resubmitCooldownMs / 60_000).toFixed(1)),
        resubmitStrategyBand: strategy.band,
        resubmitStrategyReason: strategy.reason,
        resubmitSizePct: Number((strategy.sizeMultiplier * 100).toFixed(0)),
        allowPartialResubmit: strategy.allowPartialResubmit,
      };
    })
    .sort((a, b) => Number(b.stale) - Number(a.stale) || b.ageMinutes - a.ageMinutes)
    .slice(0, 8);

  return {
    active: activeAttempts.length,
    submitted: activeAttempts.filter(attempt => attempt.status === 'submitted').length,
    submittedUnknown: activeAttempts.filter(attempt => attempt.status === 'submitted_unknown').length,
    partiallyFilled: activeAttempts.filter(attempt => attempt.status === 'partially_filled').length,
    stale: items.filter(item => item.stale).length,
    autoRecoveryTagged: attempts.filter(attempt => String(attempt.retryReason ?? '').startsWith('auto_recovery')).length,
    blockedTerminal: attempts.filter(attempt => attempt.status === 'rejected' || attempt.status === 'cancelled').length,
    items,
  };
}

export async function buildDailyReport() {
  const [metrics] = await Promise.all([calculatePerformanceMetrics()]);
  const agentStatus = getAgentStatus();
  const candidates = getSignalCandidates(25);
  const researchEvents = getRecentResearchEvents(40);
  const executionAttempts = getExecutionAttempts(40);
  const riskEvents = db.prepare(`
    SELECT allowed, failed_check
    FROM risk_events
    ORDER BY created_at DESC
    LIMIT 100
  `).all() as RiskEventRow[];
  const recentCycles = db.prepare(`
    SELECT id, status, mode, selected_symbol, candidate_id, started_at, completed_at, error
    FROM agent_cycles
    ORDER BY started_at DESC
    LIMIT 10
  `).all();
  const recentTrades = db.prepare(`
    SELECT id, symbol, action, price, shares, candidate_id, execution_attempt_id, source_event_ids, entry_thesis, exit_reason, created_at
    FROM trades
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as Array<{
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    price: number;
    shares: number;
    candidate_id: string | null;
    execution_attempt_id: string | null;
    source_event_ids: string | null;
    entry_thesis: string | null;
    exit_reason: string | null;
    created_at: number;
  }>;

  const tradeEventIds = recentTrades.flatMap(trade => safeJson<string[]>(trade.source_event_ids, []));
  const allEventIds = [...new Set([
    ...researchEvents.map(event => event.id),
    ...candidates.flatMap(candidate => candidate.sourceEventIds),
    ...tradeEventIds,
  ])];
  const eventsById = new Map(getResearchEventsByIds(allEventIds).map(event => [event.id, event]));
  const latestAttemptByCandidate = new Map<string, ExecutionAttemptRecord>();
  for (const attempt of executionAttempts) {
    if (attempt.candidateId && !latestAttemptByCandidate.has(attempt.candidateId)) {
      latestAttemptByCandidate.set(attempt.candidateId, attempt);
    }
  }

  const decisionBatchIds = [...new Set(candidates
    .map(candidate => candidate.decisionBatchId)
    .filter((value): value is string => Boolean(value)))];
  const decisionsById = decisionBatchIds.length === 0
    ? new Map<string, { heldOutReason: string | null }>()
    : new Map((db.prepare(`
        SELECT id, held_out_reason
        FROM decision_batches
        WHERE id IN (${decisionBatchIds.map(() => '?').join(',')})
      `).all(...decisionBatchIds) as Array<{ id: string; held_out_reason: string | null }>)
      .map(row => [row.id, { heldOutReason: row.held_out_reason ?? null }]));

  const decisionTrail: DecisionTrailRow[] = candidates.slice(0, 12).map(candidate => {
    const linkedEvents = candidate.sourceEventIds
      .map(eventId => eventsById.get(eventId))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const attempt = latestAttemptByCandidate.get(candidate.id) ?? null;
    const matchedTrade = findTradeForDecision(candidate, attempt, recentTrades);
    const tradeSourceTypes = matchedTrade
      ? safeJson<string[]>(matchedTrade.source_event_ids, [])
          .map(eventId => eventsById.get(eventId)?.sourceType)
          .filter((source): source is string => Boolean(source))
      : [];
    const sourceTypes = [...new Set([...linkedEvents.map(event => event.sourceType), ...tradeSourceTypes])];
    const decisionMeta = candidate.decisionBatchId ? decisionsById.get(candidate.decisionBatchId) : null;

    return {
      candidateId: candidate.id,
      symbol: candidate.symbol,
      action: candidate.action,
      decisionAction: candidate.decisionAction ?? null,
      actionable: candidate.actionable ?? true,
      decisionBatchId: candidate.decisionBatchId ?? null,
      candidateStatus: candidate.status,
      executionStatus: attempt?.status ?? null,
      confidence: candidate.confidence,
      score: candidate.score,
      reasoning: matchedTrade?.entry_thesis ?? matchedTrade?.exit_reason ?? candidate.reasoning,
      heldOutReason: decisionMeta?.heldOutReason ?? null,
      sourceTypes,
      eventTitles: linkedEvents.map(event => event.title).slice(0, 3),
      fillPrice: attempt?.fillPrice ?? null,
      plannedShares: attempt?.plannedShares ?? null,
      filledShares: attempt?.filledShares ?? null,
      pnl: findRealizedPnlPct(matchedTrade ?? null),
      exitReason: matchedTrade?.exit_reason ?? null,
      // candidate.createdAt is in ms (research.ts multiplies by 1000); frontend expects seconds
      createdAt: Math.floor(candidate.createdAt / 1000),
      updatedAt: Math.floor(Math.max(candidate.updatedAt, attempt?.updatedAt ?? 0) / 1000),
    };
  });

  const blockedDecisions = decisionTrail
    .filter(row => row.actionable && (
      row.candidateStatus === 'blocked' ||
      row.executionStatus === 'rejected' ||
      row.executionStatus === 'cancelled'
    ))
    .slice(0, 8);

  const freshness = getFreshnessSummary();
  const staleSources = freshness.sources.filter(source => source.status !== 'ok');
  const executionOps = summarizeExecutionOps(executionAttempts);
  const recovery = getRecoveryStatus();
  const reconciliation = getReconciliationStatus();

  return {
    generatedAt: Date.now(),
    mode: getTradingMode(),
    operatorSummary: buildOperatorSummary({
      mode: getTradingMode(),
      degraded: agentStatus.degraded,
      staleSources: staleSources.length,
      filledExecutions: executionAttempts.filter(attempt => attempt.status === 'filled').length,
      blockedExecutions: executionAttempts.filter(attempt => attempt.status === 'rejected' || attempt.status === 'cancelled').length,
      inFlightExecutions: executionOps.active,
      staleExecutions: executionOps.stale,
    }),
    agent: agentStatus,
    marketSession: getMarketSessionStatus(),
    metrics,
    dataFreshness: freshness,
    staleSources,
    brokerOps: {
      reconciliation,
      recovery,
    },
    candidates,
    candidateFunnel: summarizeCandidateFunnel(candidates),
    researchEvents,
    executionAttempts,
    executionSummary: summarizeExecutionLifecycle(executionAttempts),
    constructionSummary: summarizeConstructionBands(executionAttempts),
    executionOps,
    risk: summarizeRiskEvents(riskEvents),
    decisionTrail,
    blockedDecisions,
    recentCycles,
  };
}

function findTradeForDecision(
  candidate: SignalCandidate,
  attempt: ExecutionAttemptRecord | null,
  trades: Array<{
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    price: number;
    shares: number;
    candidate_id: string | null;
    execution_attempt_id: string | null;
    source_event_ids: string | null;
    entry_thesis: string | null;
    exit_reason: string | null;
    created_at: number;
  }>
) {
  const directCandidateMatch = trades.find(trade => trade.candidate_id === candidate.id);
  if (directCandidateMatch) return directCandidateMatch;

  if (attempt) {
    const directAttemptMatch = trades.find(trade => trade.execution_attempt_id === attempt.id);
    if (directAttemptMatch) return directAttemptMatch;
  }

  const anchor = Math.floor((attempt?.createdAt ?? candidate.createdAt) / 1000);
  const sameSideTrades = trades.filter(trade =>
    trade.symbol === candidate.symbol &&
    trade.action === candidate.action &&
    Math.abs(trade.created_at - anchor) <= 6 * 3600
  );

  return sameSideTrades.sort((a, b) => Math.abs(a.created_at - anchor) - Math.abs(b.created_at - anchor))[0] ?? null;
}

function findRealizedPnlPct(trade: {
  symbol: string;
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  created_at: number;
} | null): number | null {
  if (!trade || trade.action !== 'SELL') return null;

  const firstBuy = db.prepare(`
    SELECT price
    FROM trades
    WHERE symbol = ? AND action = 'BUY' AND created_at <= ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(trade.symbol, trade.created_at) as { price: number } | undefined;

  if (!firstBuy) return null;

  return parseFloat((((trade.price - firstBuy.price) / firstBuy.price) * 100).toFixed(2));
}

function buildOperatorSummary(input: {
  mode: string;
  degraded: boolean;
  staleSources: number;
  filledExecutions: number;
  blockedExecutions: number;
  inFlightExecutions: number;
  staleExecutions: number;
}): string {
  const status = input.degraded ? 'degraded' : 'stable';
  return `${input.mode} mode, ${status}, ${input.staleSources} stale/error data sources, ${input.filledExecutions} filled executions, ${input.inFlightExecutions} in-flight attempts, ${input.staleExecutions} stale in-flight attempts, ${input.blockedExecutions} blocked terminal attempts in the current report window.`;
}

function getResearchEventsByIds(ids: string[]) {
  if (ids.length === 0) return [];

  const rows = db.prepare(`
    SELECT * FROM research_events
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as any[];

  return rows.map(row => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    symbol: row.symbol,
    title: row.title,
    summary: row.summary ?? null,
    sentiment: row.sentiment,
    eventType: row.event_type ?? null,
    importance: row.importance,
    url: row.url ?? null,
    payload: safeJson<Record<string, any>>(row.payload, {}),
    eventTimestamp: row.event_timestamp * 1000,
    createdAt: row.created_at * 1000,
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
