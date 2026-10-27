import db from './db.js';
import type { ExecutionSessionRegime } from './executionContext.js';
import type { LiveRolloutProfile } from './rollout.js';

type ExecutionSegmentRolloutProfile = LiveRolloutProfile | 'legacy' | 'aggregate';
type ExecutionSegmentSessionRegime = ExecutionSessionRegime | 'aggregate';

export interface PersistedExecutionQualityProfile {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile: ExecutionSegmentRolloutProfile;
  sessionRegime: ExecutionSegmentSessionRegime;
  scope: 'segment' | 'aggregate';
  sampleSize: number;
  fillOutcomeCount: number;
  avgAbsSlippageBps: number | null;
  avgLatencySeconds: number | null;
  cancellationRate: number;
  partialRate: number;
  lastAttemptUpdatedAt: number | null;
  lastAttemptId: string | null;
  updatedAt: number;
}

interface ProfileAccumulatorRow {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rollout_profile: string;
  session_regime: string;
  sample_count: number;
  fill_outcome_count: number;
  cancellation_count: number;
  partial_count: number;
  abs_slippage_sample_count: number;
  total_abs_slippage_bps: number;
  latency_sample_count: number;
  total_latency_seconds: number;
  last_attempt_updated_at: number | null;
  last_attempt_id: string | null;
  updated_at: number;
}

interface ProfileAccumulator {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile: ExecutionSegmentRolloutProfile;
  sessionRegime: ExecutionSegmentSessionRegime;
  sampleCount: number;
  fillOutcomeCount: number;
  cancellationCount: number;
  partialCount: number;
  absSlippageSampleCount: number;
  totalAbsSlippageBps: number;
  latencySampleCount: number;
  totalLatencySeconds: number;
  lastAttemptUpdatedAt: number | null;
  lastAttemptId: string | null;
}

interface AttemptRow {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rollout_profile: string | null;
  session_regime: string | null;
  status: string;
  filled_shares: number | null;
  fill_price: number | null;
  slippage_bps: number | null;
  created_at: number;
  updated_at: number;
}

const loadProfileRow = db.prepare(`
  SELECT *
  FROM execution_quality_segments
  WHERE symbol = ?
    AND action = ?
    AND mode = ?
    AND rollout_profile = ?
    AND session_regime = ?
  LIMIT 1
`);

const loadAggregateProfileRow = db.prepare(`
  SELECT
    symbol,
    action,
    mode,
    'aggregate' AS rollout_profile,
    'aggregate' AS session_regime,
    SUM(sample_count) AS sample_count,
    SUM(fill_outcome_count) AS fill_outcome_count,
    SUM(cancellation_count) AS cancellation_count,
    SUM(partial_count) AS partial_count,
    SUM(abs_slippage_sample_count) AS abs_slippage_sample_count,
    SUM(total_abs_slippage_bps) AS total_abs_slippage_bps,
    SUM(latency_sample_count) AS latency_sample_count,
    SUM(total_latency_seconds) AS total_latency_seconds,
    MAX(last_attempt_updated_at) AS last_attempt_updated_at,
    MAX(last_attempt_id) AS last_attempt_id,
    MAX(updated_at) AS updated_at
  FROM execution_quality_segments
  WHERE symbol = ?
    AND action = ?
    AND mode = ?
  GROUP BY symbol, action, mode
  LIMIT 1
`);

const upsertProfile = db.prepare(`
  INSERT INTO execution_quality_segments (
    symbol,
    action,
    mode,
    rollout_profile,
    session_regime,
    sample_count,
    fill_outcome_count,
    cancellation_count,
    partial_count,
    abs_slippage_sample_count,
    total_abs_slippage_bps,
    latency_sample_count,
    total_latency_seconds,
    last_attempt_updated_at,
    last_attempt_id,
    updated_at
  ) VALUES (
    @symbol,
    @action,
    @mode,
    @rollout_profile,
    @session_regime,
    @sample_count,
    @fill_outcome_count,
    @cancellation_count,
    @partial_count,
    @abs_slippage_sample_count,
    @total_abs_slippage_bps,
    @latency_sample_count,
    @total_latency_seconds,
    @last_attempt_updated_at,
    @last_attempt_id,
    unixepoch()
  )
  ON CONFLICT(symbol, action, mode, rollout_profile, session_regime) DO UPDATE SET
    sample_count = excluded.sample_count,
    fill_outcome_count = excluded.fill_outcome_count,
    cancellation_count = excluded.cancellation_count,
    partial_count = excluded.partial_count,
    abs_slippage_sample_count = excluded.abs_slippage_sample_count,
    total_abs_slippage_bps = excluded.total_abs_slippage_bps,
    latency_sample_count = excluded.latency_sample_count,
    total_latency_seconds = excluded.total_latency_seconds,
    last_attempt_updated_at = excluded.last_attempt_updated_at,
    last_attempt_id = excluded.last_attempt_id,
    updated_at = unixepoch()
`);

export function refreshExecutionQualityProfiles(): number {
  const attempts = db.prepare(`
    SELECT id, symbol, action, mode, rollout_profile, session_regime, status, filled_shares, fill_price, slippage_bps, created_at, updated_at
    FROM execution_attempts
    WHERE status IN ('filled', 'cancelled', 'rejected')
    ORDER BY updated_at ASC, id ASC
  `).all() as AttemptRow[];

  if (attempts.length === 0) return 0;

  let updatedProfiles = 0;
  const cache = new Map<string, ProfileAccumulator>();

  const tx = db.transaction(() => {
    for (const attempt of attempts) {
      const rolloutProfile = normalizeRolloutProfile(attempt.rollout_profile);
      const sessionRegime = normalizeSessionRegime(attempt.session_regime);
      const key = `${attempt.symbol}:${attempt.action}:${attempt.mode}:${rolloutProfile}:${sessionRegime}`;
      let profile = cache.get(key);
      if (!profile) {
        profile = fromRow(
          loadProfileRow.get(attempt.symbol, attempt.action, attempt.mode, rolloutProfile, sessionRegime) as ProfileAccumulatorRow | undefined
        );
        if (!profile.symbol) {
          profile.symbol = attempt.symbol;
          profile.action = attempt.action;
          profile.mode = attempt.mode;
          profile.rolloutProfile = rolloutProfile;
          profile.sessionRegime = sessionRegime;
        }
        cache.set(key, profile);
      }

      if (!isNewAttempt(profile, attempt)) continue;

      profile.sampleCount += 1;
      if (attempt.status === 'cancelled') profile.cancellationCount += 1;

      const filledShares = attempt.filled_shares ?? 0;
      const isFillOutcome = filledShares > 0 && attempt.fill_price !== null;
      if (isFillOutcome) {
        profile.fillOutcomeCount += 1;
        const latencySeconds = Math.max(0, Math.round(attempt.updated_at - attempt.created_at));
        profile.latencySampleCount += 1;
        profile.totalLatencySeconds += latencySeconds;

        if (attempt.slippage_bps !== null) {
          profile.absSlippageSampleCount += 1;
          profile.totalAbsSlippageBps += Math.abs(attempt.slippage_bps);
        }
      }

      if (attempt.status === 'cancelled' && filledShares > 0) {
        profile.partialCount += 1;
      }

      profile.lastAttemptUpdatedAt = attempt.updated_at;
      profile.lastAttemptId = attempt.id;
      upsertProfile.run(toRow(profile));
      updatedProfiles += 1;
    }
  });

  tx();
  return updatedProfiles;
}

export function getExecutionQualityProfile(
  symbol: string,
  action: 'BUY' | 'SELL',
  mode: string,
  segment?: {
    rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
    sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  },
): PersistedExecutionQualityProfile | null {
  const rolloutProfile = normalizeRolloutProfile(segment?.rolloutProfile ?? null);
  const sessionRegime = normalizeSessionRegime(segment?.sessionRegime ?? null);
  const exact = loadProfileRow.get(symbol, action, mode, rolloutProfile, sessionRegime) as ProfileAccumulatorRow | undefined;
  if (exact) return summarizeProfile(fromRow(exact), 'segment');

  const aggregate = loadAggregateProfileRow.get(symbol, action, mode) as ProfileAccumulatorRow | undefined;
  return aggregate ? summarizeProfile(fromRow(aggregate), 'aggregate') : null;
}

function isNewAttempt(profile: ProfileAccumulator, attempt: AttemptRow): boolean {
  if (profile.lastAttemptUpdatedAt == null) return true;
  if (attempt.updated_at > profile.lastAttemptUpdatedAt) return true;
  if (attempt.updated_at < profile.lastAttemptUpdatedAt) return false;
  return attempt.id > String(profile.lastAttemptId ?? '');
}

function fromRow(row: ProfileAccumulatorRow | undefined): ProfileAccumulator {
  if (!row) {
    return {
      symbol: '',
      action: 'BUY',
      mode: 'paper',
      rolloutProfile: 'legacy',
      sessionRegime: 'legacy',
      sampleCount: 0,
      fillOutcomeCount: 0,
      cancellationCount: 0,
      partialCount: 0,
      absSlippageSampleCount: 0,
      totalAbsSlippageBps: 0,
      latencySampleCount: 0,
      totalLatencySeconds: 0,
      lastAttemptUpdatedAt: null,
      lastAttemptId: null,
    };
  }

  return {
    symbol: row.symbol,
    action: row.action,
    mode: row.mode,
    rolloutProfile: normalizeRolloutProfile(row.rollout_profile),
    sessionRegime: normalizeSessionRegime(row.session_regime),
    sampleCount: row.sample_count ?? 0,
    fillOutcomeCount: row.fill_outcome_count ?? 0,
    cancellationCount: row.cancellation_count ?? 0,
    partialCount: row.partial_count ?? 0,
    absSlippageSampleCount: row.abs_slippage_sample_count ?? 0,
    totalAbsSlippageBps: row.total_abs_slippage_bps ?? 0,
    latencySampleCount: row.latency_sample_count ?? 0,
    totalLatencySeconds: row.total_latency_seconds ?? 0,
    lastAttemptUpdatedAt: row.last_attempt_updated_at ?? null,
    lastAttemptId: row.last_attempt_id ?? null,
  };
}

function toRow(profile: ProfileAccumulator) {
  return {
    symbol: profile.symbol,
    action: profile.action,
    mode: profile.mode,
    rollout_profile: profile.rolloutProfile,
    session_regime: profile.sessionRegime,
    sample_count: profile.sampleCount,
    fill_outcome_count: profile.fillOutcomeCount,
    cancellation_count: profile.cancellationCount,
    partial_count: profile.partialCount,
    abs_slippage_sample_count: profile.absSlippageSampleCount,
    total_abs_slippage_bps: profile.totalAbsSlippageBps,
    latency_sample_count: profile.latencySampleCount,
    total_latency_seconds: profile.totalLatencySeconds,
    last_attempt_updated_at: profile.lastAttemptUpdatedAt,
    last_attempt_id: profile.lastAttemptId,
  };
}

function summarizeProfile(profile: ProfileAccumulator, scope: 'segment' | 'aggregate'): PersistedExecutionQualityProfile {
  const avg = (total: number, count: number): number | null =>
    count > 0 ? Number((total / count).toFixed(2)) : null;

  return {
    symbol: profile.symbol,
    action: profile.action,
    mode: profile.mode,
    rolloutProfile: scope === 'aggregate' ? 'aggregate' : profile.rolloutProfile,
    sessionRegime: scope === 'aggregate' ? 'aggregate' : profile.sessionRegime,
    scope,
    sampleSize: profile.sampleCount,
    fillOutcomeCount: profile.fillOutcomeCount,
    avgAbsSlippageBps: avg(profile.totalAbsSlippageBps, profile.absSlippageSampleCount),
    avgLatencySeconds: avg(profile.totalLatencySeconds, profile.latencySampleCount),
    cancellationRate: profile.sampleCount > 0 ? Number((profile.cancellationCount / profile.sampleCount).toFixed(2)) : 0,
    partialRate: profile.sampleCount > 0 ? Number((profile.partialCount / profile.sampleCount).toFixed(2)) : 0,
    lastAttemptUpdatedAt: profile.lastAttemptUpdatedAt ? profile.lastAttemptUpdatedAt * 1000 : null,
    lastAttemptId: profile.lastAttemptId,
    updatedAt: Date.now(),
  };
}

function normalizeRolloutProfile(value: string | null | undefined): ExecutionSegmentRolloutProfile {
  if (value === 'limited_live' || value === 'full_live' || value === 'paper' || value === 'aggregate') return value;
  return 'legacy';
}

function normalizeSessionRegime(value: string | null | undefined): ExecutionSegmentSessionRegime {
  if (value === 'cash_open' || value === 'off_session_weekday' || value === 'weekend' || value === 'legacy' || value === 'aggregate') return value;
  return 'legacy';
}
