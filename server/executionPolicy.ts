import db from './db.js';
import { getExecutionQualityProfile, refreshExecutionQualityProfiles } from './executionQualityProfiles.js';
import type { ExecutionAttemptRecord } from './execution.js';
import type { ExecutionSessionRegime } from './executionContext.js';
import { getLiveRolloutProfile, type LiveRolloutProfile } from './rollout.js';

export interface RecentExecutionProfile {
  sampleSize: number;
  fillOutcomeCount: number;
  avgAbsSlippageBps: number | null;
  avgLatencySeconds: number | null;
  cancellationRate: number;
  partialRate: number;
  recentSampleSize?: number;
  baselineSampleSize?: number;
  source?: 'recent' | 'recent+baseline';
  baselineScope?: 'segment' | 'aggregate';
}

export interface AdaptiveResubmitDecision {
  allowResubmit: boolean;
  maxResubmits: number;
  band: 'blocked' | 'tightened' | 'base' | 'loosened';
  reason: string;
  profile: LiveRolloutProfile;
  metrics: RecentExecutionProfile;
}

export interface ExecutionRecoveryTimingPolicy {
  submittedTimeoutMs: number;
  partialTimeoutMs: number;
  resubmitCooldownMs: number;
  band: 'accelerated' | 'base' | 'extended';
  reason: string;
  profile: LiveRolloutProfile;
  metrics: RecentExecutionProfile;
}

export interface ExecutionResubmitStrategyPolicy {
  sizeMultiplier: number;
  allowPartialResubmit: boolean;
  band: 'aggressive' | 'base' | 'reduced' | 'halt_partial';
  reason: string;
  profile: LiveRolloutProfile;
  metrics: RecentExecutionProfile;
}

export interface ExecutionSizingPolicy {
  multiplier: number;
  band: 'base' | 'reduced' | 'severe' | 'blocked';
  blocked: boolean;
  reason: string;
  profile: LiveRolloutProfile;
  metrics: RecentExecutionProfile;
}

export interface PortfolioConstructionPolicy {
  targetWeightMultiplier: number;
  band: 'clean' | 'reduced' | 'severe';
  reason: string;
  profile: LiveRolloutProfile;
  metrics: RecentExecutionProfile;
}

export function evaluateAdaptiveResubmitPolicy(input: {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  currentRetryCount: number;
  rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
  sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  refreshProfiles?: boolean;
}): AdaptiveResubmitDecision {
  const profile =
    input.rolloutProfile === 'paper' || input.rolloutProfile === 'limited_live' || input.rolloutProfile === 'full_live'
      ? input.rolloutProfile
      : input.mode === 'live'
        ? getLiveRolloutProfile()
        : 'paper';
  if (input.refreshProfiles !== false) {
    refreshExecutionQualityProfiles();
  }
  const recentMetrics = summarizeRecentExecutionProfile(
    getRecentAttempts(input.symbol, input.action, input.mode, input.rolloutProfile ?? null, input.sessionRegime ?? null)
  );
  const baseline = getExecutionQualityProfile(input.symbol, input.action, input.mode, {
    rolloutProfile: input.rolloutProfile ?? null,
    sessionRegime: input.sessionRegime ?? null,
  });
  const metrics = mergeExecutionProfiles(recentMetrics, baseline);
  return deriveAdaptiveResubmitDecision(profile, input.currentRetryCount, metrics);
}

export function deriveAdaptiveResubmitDecision(
  profile: LiveRolloutProfile,
  currentRetryCount: number,
  metrics: RecentExecutionProfile,
): AdaptiveResubmitDecision {
  const baseMaxResubmits = profile === 'limited_live' ? 1 : 2;
  const scope = describeMetricsScope(metrics);
  let maxResubmits = baseMaxResubmits;
  let band: AdaptiveResubmitDecision['band'] = 'base';
  let reason = `${scope} Using base ${profile.replace(/_/g, ' ')} resubmit policy.`;

  if (metrics.fillOutcomeCount >= 3) {
    const severe = (metrics.avgAbsSlippageBps ?? 0) > 60 || (metrics.avgLatencySeconds ?? 0) > 240 || metrics.cancellationRate >= 0.5;
    const elevated = (metrics.avgAbsSlippageBps ?? 0) > 35 || (metrics.avgLatencySeconds ?? 0) > 120 || metrics.cancellationRate >= 0.3 || metrics.partialRate >= 0.4;
    const clean = (metrics.avgAbsSlippageBps ?? 999) < 15 && (metrics.avgLatencySeconds ?? 999) < 45 && metrics.cancellationRate === 0 && metrics.partialRate < 0.2;

    if (severe) {
      maxResubmits = 0;
      band = 'blocked';
      reason = `${scope} Fill quality is poor: high slippage, high latency, or frequent cancellations.`;
    } else if (elevated) {
      maxResubmits = Math.max(0, baseMaxResubmits - 1);
      band = 'tightened';
      reason = `${scope} Fill quality is elevated-risk, so autonomous resubmits are tightened.`;
    } else if (clean) {
      maxResubmits = Math.min(3, baseMaxResubmits + 1);
      band = 'loosened';
      reason = `${scope} Fill quality is strong, so autonomous resubmits are slightly loosened.`;
    }
  }

  if (currentRetryCount >= maxResubmits) {
    return {
      allowResubmit: false,
      maxResubmits,
      band: maxResubmits === 0 ? 'blocked' : band,
      reason: maxResubmits === 0
        ? reason
        : `${scope} Retry budget exhausted (${currentRetryCount}/${maxResubmits}) under the current adaptive policy.`,
      profile,
      metrics,
    };
  }

  return {
    allowResubmit: true,
    maxResubmits,
    band,
    reason,
    profile,
    metrics,
  };
}

export function evaluateExecutionRecoveryTimingPolicy(input: {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
  sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  refreshProfiles?: boolean;
}): ExecutionRecoveryTimingPolicy {
  const profile =
    input.rolloutProfile === 'paper' || input.rolloutProfile === 'limited_live' || input.rolloutProfile === 'full_live'
      ? input.rolloutProfile
      : input.mode === 'live'
        ? getLiveRolloutProfile()
        : 'paper';
  if (input.refreshProfiles !== false) {
    refreshExecutionQualityProfiles();
  }
  const recentMetrics = summarizeRecentExecutionProfile(
    getRecentAttempts(input.symbol, input.action, input.mode, input.rolloutProfile ?? null, input.sessionRegime ?? null)
  );
  const baseline = getExecutionQualityProfile(input.symbol, input.action, input.mode, {
    rolloutProfile: input.rolloutProfile ?? null,
    sessionRegime: input.sessionRegime ?? null,
  });
  const metrics = mergeExecutionProfiles(recentMetrics, baseline);
  return deriveExecutionRecoveryTimingPolicy(profile, metrics);
}

export function evaluateExecutionResubmitStrategyPolicy(input: {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
  sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  refreshProfiles?: boolean;
}): ExecutionResubmitStrategyPolicy {
  const profile =
    input.rolloutProfile === 'paper' || input.rolloutProfile === 'limited_live' || input.rolloutProfile === 'full_live'
      ? input.rolloutProfile
      : input.mode === 'live'
        ? getLiveRolloutProfile()
        : 'paper';
  if (input.refreshProfiles !== false) {
    refreshExecutionQualityProfiles();
  }
  const recentMetrics = summarizeRecentExecutionProfile(
    getRecentAttempts(input.symbol, input.action, input.mode, input.rolloutProfile ?? null, input.sessionRegime ?? null)
  );
  const baseline = getExecutionQualityProfile(input.symbol, input.action, input.mode, {
    rolloutProfile: input.rolloutProfile ?? null,
    sessionRegime: input.sessionRegime ?? null,
  });
  const metrics = mergeExecutionProfiles(recentMetrics, baseline);
  return deriveExecutionResubmitStrategyPolicy(profile, metrics);
}

export function evaluateExecutionSizingPolicy(input: {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
  sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  degradationSeverity?: 'none' | 'warning' | 'critical';
  degradationReasons?: string[];
  refreshProfiles?: boolean;
}): ExecutionSizingPolicy {
  const profile =
    input.rolloutProfile === 'paper' || input.rolloutProfile === 'limited_live' || input.rolloutProfile === 'full_live'
      ? input.rolloutProfile
      : input.mode === 'live'
        ? getLiveRolloutProfile()
        : 'paper';
  if (input.refreshProfiles !== false) {
    refreshExecutionQualityProfiles();
  }
  const recentMetrics = summarizeRecentExecutionProfile(
    getRecentAttempts(input.symbol, input.action, input.mode, input.rolloutProfile ?? null, input.sessionRegime ?? null)
  );
  const baseline = getExecutionQualityProfile(input.symbol, input.action, input.mode, {
    rolloutProfile: input.rolloutProfile ?? null,
    sessionRegime: input.sessionRegime ?? null,
  });
  const metrics = mergeExecutionProfiles(recentMetrics, baseline);
  return deriveExecutionSizingPolicy(profile, metrics, input.degradationSeverity ?? 'none', input.degradationReasons ?? []);
}

export function evaluatePortfolioConstructionPolicy(input: {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile?: LiveRolloutProfile | 'legacy' | null;
  sessionRegime?: ExecutionSessionRegime | 'legacy' | null;
  degradationSeverity?: 'none' | 'warning' | 'critical';
  degradationReasons?: string[];
  refreshProfiles?: boolean;
}): PortfolioConstructionPolicy {
  const profile =
    input.rolloutProfile === 'paper' || input.rolloutProfile === 'limited_live' || input.rolloutProfile === 'full_live'
      ? input.rolloutProfile
      : input.mode === 'live'
        ? getLiveRolloutProfile()
        : 'paper';
  if (input.refreshProfiles !== false) {
    refreshExecutionQualityProfiles();
  }
  const recentMetrics = summarizeRecentExecutionProfile(
    getRecentAttempts(input.symbol, input.action, input.mode, input.rolloutProfile ?? null, input.sessionRegime ?? null)
  );
  const baseline = getExecutionQualityProfile(input.symbol, input.action, input.mode, {
    rolloutProfile: input.rolloutProfile ?? null,
    sessionRegime: input.sessionRegime ?? null,
  });
  const metrics = mergeExecutionProfiles(recentMetrics, baseline);
  return derivePortfolioConstructionPolicy(profile, metrics, input.degradationSeverity ?? 'none', input.degradationReasons ?? []);
}

export function deriveExecutionRecoveryTimingPolicy(
  profile: LiveRolloutProfile,
  metrics: RecentExecutionProfile,
): ExecutionRecoveryTimingPolicy {
  const scope = describeMetricsScope(metrics);
  const base = getBaseRecoveryTiming(profile);
  let submittedTimeoutMs = base.submittedTimeoutMs;
  let partialTimeoutMs = base.partialTimeoutMs;
  let resubmitCooldownMs = base.resubmitCooldownMs;
  let band: ExecutionRecoveryTimingPolicy['band'] = 'base';
  let reason = `${scope} Using base ${profile.replace(/_/g, ' ')} recovery timing.`;

  if (metrics.fillOutcomeCount >= 3) {
    const slowOrExpensive =
      (metrics.avgLatencySeconds ?? 0) > 180 ||
      (metrics.avgAbsSlippageBps ?? 0) > 45 ||
      metrics.cancellationRate >= 0.4 ||
      metrics.partialRate >= 0.35;
    const elevatedPressure =
      (metrics.avgLatencySeconds ?? 0) > 90 ||
      (metrics.avgAbsSlippageBps ?? 0) > 25 ||
      metrics.cancellationRate >= 0.2 ||
      metrics.partialRate >= 0.2;
    const clean =
      (metrics.avgLatencySeconds ?? 999) < 30 &&
      (metrics.avgAbsSlippageBps ?? 999) < 12 &&
      metrics.cancellationRate === 0 &&
      metrics.partialRate < 0.15;

    if (slowOrExpensive) {
      submittedTimeoutMs = Math.round(base.submittedTimeoutMs * 2);
      partialTimeoutMs = Math.round(base.partialTimeoutMs * 1.8);
      resubmitCooldownMs = Math.max(base.resubmitCooldownMs, profile === 'full_live' ? 240_000 : 180_000);
      band = 'extended';
      reason = `${scope} Segment pressure is high, so recovery waits longer before cancel/resubmit to reduce churn and slippage.`;
    } else if (elevatedPressure) {
      submittedTimeoutMs = Math.round(base.submittedTimeoutMs * 1.5);
      partialTimeoutMs = Math.round(base.partialTimeoutMs * 1.4);
      resubmitCooldownMs = Math.max(base.resubmitCooldownMs, 120_000);
      band = 'extended';
      reason = `${scope} Segment pressure is elevated, so recovery timeouts and resubmit cadence are widened.`;
    } else if (clean) {
      submittedTimeoutMs = Math.max(60_000, Math.round(base.submittedTimeoutMs * 0.75));
      partialTimeoutMs = Math.max(180_000, Math.round(base.partialTimeoutMs * 0.8));
      resubmitCooldownMs = Math.max(30_000, Math.round(base.resubmitCooldownMs * 0.75));
      band = 'accelerated';
      reason = `${scope} Segment fill quality is clean, so recovery responds faster and retries with tighter cadence.`;
    }
  }

  return {
    submittedTimeoutMs,
    partialTimeoutMs,
    resubmitCooldownMs,
    band,
    reason,
    profile,
    metrics,
  };
}

export function deriveExecutionResubmitStrategyPolicy(
  profile: LiveRolloutProfile,
  metrics: RecentExecutionProfile,
): ExecutionResubmitStrategyPolicy {
  const scope = describeMetricsScope(metrics);
  let sizeMultiplier = profile === 'limited_live' ? 0.75 : 1;
  let allowPartialResubmit = true;
  let band: ExecutionResubmitStrategyPolicy['band'] = 'base';
  let reason = `${scope} Using base ${profile.replace(/_/g, ' ')} resubmit sizing and partial-fill behavior.`;

  if (metrics.fillOutcomeCount >= 3) {
    const severe =
      (metrics.avgAbsSlippageBps ?? 0) > 55 ||
      (metrics.avgLatencySeconds ?? 0) > 210 ||
      metrics.cancellationRate >= 0.45 ||
      metrics.partialRate >= 0.45;
    const elevated =
      (metrics.avgAbsSlippageBps ?? 0) > 30 ||
      (metrics.avgLatencySeconds ?? 0) > 100 ||
      metrics.cancellationRate >= 0.2 ||
      metrics.partialRate >= 0.25;
    const clean =
      (metrics.avgAbsSlippageBps ?? 999) < 12 &&
      (metrics.avgLatencySeconds ?? 999) < 30 &&
      metrics.cancellationRate === 0 &&
      metrics.partialRate < 0.12;

    if (severe && metrics.partialRate >= 0.45) {
      sizeMultiplier = 0.4;
      allowPartialResubmit = false;
      band = 'halt_partial';
      reason = `${scope} Segment partial-fill pressure is severe, so autonomous recovery will shrink size sharply and stop retrying once a partial fill has landed.`;
    } else if (severe) {
      sizeMultiplier = 0.5;
      allowPartialResubmit = false;
      band = 'reduced';
      reason = `${scope} Segment execution quality is severe, so autonomous recovery resubmits smaller size and avoids repeated partial-fill churn.`;
    } else if (elevated) {
      sizeMultiplier = profile === 'full_live' ? 0.65 : 0.75;
      allowPartialResubmit = true;
      band = 'reduced';
      reason = `${scope} Segment execution quality is elevated-risk, so autonomous recovery decays remaining size on resubmit.`;
    } else if (clean) {
      sizeMultiplier = 1;
      allowPartialResubmit = true;
      band = 'aggressive';
      reason = `${scope} Segment execution quality is clean, so autonomous recovery keeps full remaining size on resubmit.`;
    }
  }

  return {
    sizeMultiplier,
    allowPartialResubmit,
    band,
    reason,
    profile,
    metrics,
  };
}

export function deriveExecutionSizingPolicy(
  profile: LiveRolloutProfile,
  metrics: RecentExecutionProfile,
  degradationSeverity: 'none' | 'warning' | 'critical' = 'none',
  degradationReasons: string[] = [],
): ExecutionSizingPolicy {
  const scope = describeMetricsScope(metrics);
  let multiplier = profile === 'limited_live' ? 0.85 : 1;
  let band: ExecutionSizingPolicy['band'] = 'base';
  let blocked = false;
  let reason = `${scope} Using base ${profile.replace(/_/g, ' ')} initial sizing.`;

  if (degradationSeverity === 'critical') {
    multiplier = 0;
    band = 'blocked';
    blocked = true;
    reason = `Execution is blocked by critical degradation. ${degradationReasons.join(' ')}`.trim();
  } else if (degradationSeverity === 'warning' && !blocked) {
    multiplier = Number((multiplier * 0.85).toFixed(2));
    if (multiplier < 0.99) {
      band = band === 'base' ? 'reduced' : band;
    }
    reason = `${reason} Non-critical degradation is present, so sizing is reduced further. ${degradationReasons.join(' ')}`.trim();
  }

  return {
    multiplier,
    band,
    blocked,
    reason,
    profile,
    metrics,
  };
}

export function derivePortfolioConstructionPolicy(
  profile: LiveRolloutProfile,
  metrics: RecentExecutionProfile,
  degradationSeverity: 'none' | 'warning' | 'critical' = 'none',
  degradationReasons: string[] = [],
): PortfolioConstructionPolicy {
  const scope = describeMetricsScope(metrics);
  let targetWeightMultiplier = 1;
  let band: PortfolioConstructionPolicy['band'] = 'clean';
  let reason = `${scope} Target weight uses the base confidence curve.`;

  if (metrics.fillOutcomeCount >= 3) {
    const severe =
      (metrics.avgAbsSlippageBps ?? 0) > 50 ||
      (metrics.avgLatencySeconds ?? 0) > 180 ||
      metrics.partialRate >= 0.4 ||
      metrics.cancellationRate >= 0.35;
    const elevated =
      (metrics.avgAbsSlippageBps ?? 0) > 25 ||
      (metrics.avgLatencySeconds ?? 0) > 90 ||
      metrics.partialRate >= 0.2 ||
      metrics.cancellationRate >= 0.2;

    if (severe) {
      targetWeightMultiplier = 0.55;
      band = 'severe';
      reason = `${scope} Execution quality is weak for this segment, so the initial target weight is cut sharply before the first submit.`;
    } else if (elevated) {
      targetWeightMultiplier = 0.8;
      band = 'reduced';
      reason = `${scope} Execution quality is elevated-risk for this segment, so the initial target weight is reduced before the first submit.`;
    }
  }

  if (degradationSeverity === 'critical') {
    targetWeightMultiplier = Math.min(targetWeightMultiplier, 0.5);
    band = 'severe';
    reason = `${reason} Critical degradation is also present, so the portfolio target stays defensive even before downstream execution gates run. ${degradationReasons.join(' ')}`.trim();
  } else if (degradationSeverity === 'warning') {
    targetWeightMultiplier = Number((targetWeightMultiplier * 0.9).toFixed(2));
    if (band === 'clean') band = 'reduced';
    reason = `${reason} Non-critical degradation reduces the target weight further. ${degradationReasons.join(' ')}`.trim();
  }

  return {
    targetWeightMultiplier,
    band,
    reason,
    profile,
    metrics,
  };
}

export function summarizeRecentExecutionProfile(attempts: ExecutionAttemptRecord[]): RecentExecutionProfile {
  const sampleSize = attempts.length;
  const fillOutcomes = attempts.filter(attempt => (attempt.filledShares ?? 0) > 0 && attempt.fillPrice !== null);
  const avg = (values: number[]): number | null =>
    values.length > 0 ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

  return {
    sampleSize,
    fillOutcomeCount: fillOutcomes.length,
    avgAbsSlippageBps: avg(fillOutcomes.flatMap(attempt => attempt.slippageBps === null ? [] : [Math.abs(attempt.slippageBps)])),
    avgLatencySeconds: avg(fillOutcomes.map(attempt => Math.max(0, Math.round((attempt.updatedAt - attempt.createdAt) / 1000)))),
    cancellationRate: sampleSize > 0
      ? Number((attempts.filter(attempt => attempt.status === 'cancelled').length / sampleSize).toFixed(2))
      : 0,
    partialRate: sampleSize > 0
      ? Number((attempts.filter(attempt => attempt.status === 'partially_filled' || (attempt.status === 'cancelled' && (attempt.filledShares ?? 0) > 0)).length / sampleSize).toFixed(2))
      : 0,
    recentSampleSize: sampleSize,
    baselineSampleSize: 0,
    source: 'recent',
  };
}

export function mergeExecutionProfiles(
  recent: RecentExecutionProfile,
  baseline: {
    sampleSize: number;
    fillOutcomeCount: number;
    avgAbsSlippageBps: number | null;
    avgLatencySeconds: number | null;
    cancellationRate: number;
    partialRate: number;
    scope: 'segment' | 'aggregate';
  } | null,
): RecentExecutionProfile {
  if (!baseline || baseline.sampleSize <= 0) {
    return {
      ...recent,
      recentSampleSize: recent.sampleSize,
      baselineSampleSize: 0,
      source: 'recent',
    };
  }

  const baselineWeight = Math.min(40, baseline.sampleSize);
  const recentWeight = Math.max(1, recent.sampleSize);
  const weightedAverage = (a: number | null, aWeight: number, b: number | null, bWeight: number): number | null => {
    const values = [
      ...(a !== null ? [{ value: a, weight: aWeight }] : []),
      ...(b !== null ? [{ value: b, weight: bWeight }] : []),
    ];
    if (values.length === 0) return null;
    const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
    return Number((values.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight).toFixed(2));
  };

  return {
    sampleSize: recent.sampleSize + baselineWeight,
    fillOutcomeCount: recent.fillOutcomeCount + Math.min(20, baseline.fillOutcomeCount),
    avgAbsSlippageBps: weightedAverage(recent.avgAbsSlippageBps, Math.max(1, recent.fillOutcomeCount), baseline.avgAbsSlippageBps, Math.max(1, Math.min(20, baseline.fillOutcomeCount))),
    avgLatencySeconds: weightedAverage(recent.avgLatencySeconds, Math.max(1, recent.fillOutcomeCount), baseline.avgLatencySeconds, Math.max(1, Math.min(20, baseline.fillOutcomeCount))),
    cancellationRate: weightedAverage(recent.cancellationRate, recentWeight, baseline.cancellationRate, baselineWeight) ?? recent.cancellationRate,
    partialRate: weightedAverage(recent.partialRate, recentWeight, baseline.partialRate, baselineWeight) ?? recent.partialRate,
    recentSampleSize: recent.sampleSize,
    baselineSampleSize: baseline.sampleSize,
    source: 'recent+baseline',
    baselineScope: baseline.scope,
  };
}

function getRecentAttempts(
  symbol: string,
  action: 'BUY' | 'SELL',
  mode: string,
  rolloutProfile: LiveRolloutProfile | 'legacy' | null,
  sessionRegime: ExecutionSessionRegime | 'legacy' | null,
): ExecutionAttemptRecord[] {
  const useSegmentFilter = rolloutProfile !== null || sessionRegime !== null;
  const rows = useSegmentFilter
    ? db.prepare(`
        SELECT *
        FROM execution_attempts
        WHERE symbol = ?
          AND action = ?
          AND mode = ?
          AND COALESCE(rollout_profile, 'legacy') = ?
          AND COALESCE(session_regime, 'legacy') = ?
        ORDER BY updated_at DESC
        LIMIT 20
      `).all(symbol, action, mode, rolloutProfile ?? 'legacy', sessionRegime ?? 'legacy') as any[]
    : db.prepare(`
        SELECT *
        FROM execution_attempts
        WHERE symbol = ?
          AND action = ?
          AND mode = ?
        ORDER BY updated_at DESC
        LIMIT 20
      `).all(symbol, action, mode) as any[];

  return rows.map(row => ({
    id: row.id,
    cycleId: row.cycle_id ?? null,
    candidateId: row.candidate_id ?? null,
    symbol: row.symbol,
    action: row.action,
    mode: row.mode,
    status: row.status,
    plannedShares: row.planned_shares ?? null,
    plannedPrice: row.planned_price ?? null,
    filledShares: row.filled_shares ?? null,
    fillPrice: row.fill_price ?? null,
    brokerOrderId: row.broker_order_id ?? null,
    slippageBps: row.slippage_bps ?? null,
    rolloutProfile: row.rollout_profile ?? null,
    sessionRegime: row.session_regime ?? null,
    retryReason: row.retry_reason ?? null,
    error: row.error ?? null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  })) as ExecutionAttemptRecord[];
}

function describeMetricsScope(metrics: RecentExecutionProfile): string {
  if (metrics.source === 'recent+baseline' && (metrics.baselineSampleSize ?? 0) > 0) {
    const baselineScope = metrics.baselineScope === 'aggregate' ? 'aggregate mode-level baseline' : 'matching segment baseline';
    return `Adaptive policy is using ${metrics.recentSampleSize ?? metrics.sampleSize} recent attempts plus ${metrics.baselineSampleSize} persisted ${baselineScope} samples.`;
  }
  return `Adaptive policy is using ${metrics.recentSampleSize ?? metrics.sampleSize} recent attempts.`;
}

function getBaseRecoveryTiming(profile: LiveRolloutProfile): {
  submittedTimeoutMs: number;
  partialTimeoutMs: number;
  resubmitCooldownMs: number;
} {
  switch (profile) {
    case 'full_live':
      return {
        submittedTimeoutMs: 180_000,
        partialTimeoutMs: 420_000,
        resubmitCooldownMs: 120_000,
      };
    case 'limited_live':
      return {
        submittedTimeoutMs: 150_000,
        partialTimeoutMs: 360_000,
        resubmitCooldownMs: 90_000,
      };
    default:
      return {
        submittedTimeoutMs: 120_000,
        partialTimeoutMs: 300_000,
        resubmitCooldownMs: 60_000,
      };
  }
}
