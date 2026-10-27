import db from './db.js';
import { getBrokerMode } from './broker.js';
import { getSystemControls, type SystemControls } from './controls.js';
import { refreshDegradationState, type DegradationStatus } from './degradation.js';
import { getMarketSessionStatus } from './marketclock.js';
import { getFreshnessSummary } from './ops.js';

const PAPER_GATE_DAYS = 28;
const STUCK_ATTEMPT_MINUTES = 10;
const CRITICAL_SOURCES = ['live_prices', 'price_history', 'research_events', 'signal_candidates'];

export interface ReadinessGate {
  id: string;
  label: string;
  passed: boolean;
  value: string;
  detail: string;
}

export interface ReadinessStatus {
  eligibleForLive: boolean;
  liveExecutionAllowed: boolean;
  brokerMode: string;
  controls: SystemControls;
  degradation: DegradationStatus;
  gates: ReadinessGate[];
  summary: string;
  stats: {
    paperTrackRecordDays: number;
    paperFilledExecutions: number;
    staleCriticalSources: number;
    orphanedAttempts: number;
    offSessionFills: number;
    auditCoveragePct: number;
    filledAttemptCoveragePct: number;
  };
}

export function getReadinessStatus(): ReadinessStatus {
  const controls = getSystemControls();
  const brokerMode = getBrokerMode();
  const degradation = refreshDegradationState();
  const freshness = getFreshnessSummary();
  const staleCriticalSources = freshness.sources.filter(source =>
    CRITICAL_SOURCES.includes(source.source) && source.status !== 'ok'
  ).length;

  const oldestPaperFill = db.prepare(`
    SELECT created_at
    FROM execution_attempts
    WHERE mode = 'paper' AND status = 'filled'
    ORDER BY created_at ASC
    LIMIT 1
  `).get() as { created_at: number } | undefined;
  const paperFilledExecutions = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM execution_attempts
    WHERE mode = 'paper' AND status = 'filled'
  `).get() as { count: number }).count;
  const paperTrackRecordDays = oldestPaperFill
    ? Math.floor((Date.now() / 1000 - oldestPaperFill.created_at) / 86400)
    : 0;

  const orphanedAttempts = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM execution_attempts
    WHERE status IN ('planned', 'submitted', 'submitted_unknown', 'partially_filled')
      AND updated_at <= unixepoch('now', ?)
  `).get(`-${STUCK_ATTEMPT_MINUTES} minutes`) as { count: number }).count;

  const filledAttemptRows = db.prepare(`
    SELECT updated_at
    FROM execution_attempts
    WHERE status IN ('filled', 'partially_filled')
    ORDER BY updated_at DESC
    LIMIT 500
  `).all() as Array<{ updated_at: number }>;
  const offSessionFills = filledAttemptRows.filter(row => !isWithinRegularSession(row.updated_at)).length;

  const filledAttemptCoverage = db.prepare(`
    SELECT
      COUNT(*) AS filled_attempts,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM trades t WHERE t.execution_attempt_id = ea.id
      ) THEN 1 ELSE 0 END) AS covered_attempts
    FROM execution_attempts ea
    WHERE ea.status IN ('filled', 'partially_filled')
  `).get() as { filled_attempts: number; covered_attempts: number | null };
  const auditCoverage = db.prepare(`
    SELECT
      COUNT(*) AS trade_count,
      SUM(CASE WHEN execution_attempt_id IS NOT NULL THEN 1 ELSE 0 END) AS covered_trades
    FROM trades
    WHERE status IN ('executed', 'partial')
  `).get() as { trade_count: number; covered_trades: number | null };
  const filledAttemptCoveragePct = toPct(filledAttemptCoverage.covered_attempts ?? 0, filledAttemptCoverage.filled_attempts);
  const auditCoveragePct = toPct(auditCoverage.covered_trades ?? 0, auditCoverage.trade_count);

  const gates: ReadinessGate[] = [
    {
      id: 'paper_track_record',
      label: 'Paper Track Record',
      passed: paperTrackRecordDays >= PAPER_GATE_DAYS && paperFilledExecutions > 0,
      value: `${paperTrackRecordDays}d`,
      detail: `Requires at least ${PAPER_GATE_DAYS} days of filled paper executions.`,
    },
    {
      id: 'orphaned_attempts',
      label: 'No Orphaned Orders',
      passed: orphanedAttempts === 0,
      value: `${orphanedAttempts}`,
      detail: `No planned/submitted execution attempts older than ${STUCK_ATTEMPT_MINUTES} minutes.`,
    },
    {
      id: 'session_compliance',
      label: 'Session Compliance',
      passed: offSessionFills === 0,
      value: `${offSessionFills}`,
      detail: 'No filled execution attempts outside regular market hours.',
    },
    {
      id: 'audit_coverage',
      label: 'Audit Coverage',
      passed: auditCoveragePct === 100 && filledAttemptCoveragePct === 100,
      value: `${auditCoveragePct}%`,
      detail: 'Every executed trade and filled attempt is linked in the audit trail.',
    },
    {
      id: 'data_freshness',
      label: 'Critical Data Freshness',
      passed: staleCriticalSources === 0,
      value: `${staleCriticalSources}`,
      detail: 'Critical backend sources must be fresh and error-free.',
    },
    {
      id: 'kill_switch',
      label: 'Kill Switch Released',
      passed: !controls.killSwitchEngaged,
      value: controls.killSwitchEngaged ? 'engaged' : 'released',
      detail: 'Live execution stays blocked while the kill switch is engaged.',
    },
    {
      id: 'degradation_lock',
      label: 'No Critical Degradation Lock',
      passed: !degradation.liveAutoLockEngaged,
      value: degradation.liveAutoLockEngaged ? 'locked' : 'clear',
      detail: degradation.liveAutoLockReason ?? 'No degradation-driven live auto-lock is active.',
    },
  ];

  const eligibleForLive = summarizeReadinessGates(gates);
  const liveExecutionAllowed = brokerMode === 'live' && eligibleForLive && controls.liveTradingEnabled && degradation.executionAllowedLive;

  return {
    eligibleForLive,
    liveExecutionAllowed,
    brokerMode,
    controls,
    degradation,
    gates,
    summary: liveExecutionAllowed
      ? 'Live execution is unlocked and allowed.'
      : degradation.liveAutoLockEngaged
        ? `Live execution is auto-locked by degradation controls. ${degradation.liveAutoLockReason ?? ''}`.trim()
        : eligibleForLive
        ? 'Paper gates passed; live execution still requires manual enable and live broker mode.'
        : 'Paper gates are not yet satisfied.',
    stats: {
      paperTrackRecordDays,
      paperFilledExecutions,
      staleCriticalSources,
      orphanedAttempts,
      offSessionFills,
      auditCoveragePct,
      filledAttemptCoveragePct,
    },
  };
}

export function summarizeReadinessGates(gates: ReadinessGate[]): boolean {
  return gates.every(gate => gate.passed);
}

export function isWithinRegularSession(timestampSeconds: number): boolean {
  return getMarketSessionStatus(new Date(timestampSeconds * 1000)).isOpen;
}

function toPct(covered: number, total: number): number {
  if (total <= 0) return 0;
  return parseFloat(((covered / total) * 100).toFixed(1));
}
