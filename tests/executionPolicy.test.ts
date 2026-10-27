import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import {
  deriveAdaptiveResubmitDecision,
  derivePortfolioConstructionPolicy,
  deriveExecutionRecoveryTimingPolicy,
  deriveExecutionResubmitStrategyPolicy,
  deriveExecutionSizingPolicy,
  evaluateAdaptiveResubmitPolicy,
  mergeExecutionProfiles,
  summarizeRecentExecutionProfile,
} from '../server/executionPolicy.js';
import { getExecutionQualityProfile, refreshExecutionQualityProfiles } from '../server/executionQualityProfiles.js';

test('adaptive resubmit policy blocks retries when recent fill quality is poor', () => {
  const decision = deriveAdaptiveResubmitDecision('full_live', 0, {
    sampleSize: 6,
    fillOutcomeCount: 4,
    avgAbsSlippageBps: 72,
    avgLatencySeconds: 280,
    cancellationRate: 0.5,
    partialRate: 0.25,
  });

  assert.equal(decision.allowResubmit, false);
  assert.equal(decision.band, 'blocked');
  assert.equal(decision.maxResubmits, 0);
});

test('adaptive resubmit policy loosens retry budget when fill quality is consistently clean', () => {
  const decision = deriveAdaptiveResubmitDecision('limited_live', 0, {
    sampleSize: 7,
    fillOutcomeCount: 5,
    avgAbsSlippageBps: 9,
    avgLatencySeconds: 22,
    cancellationRate: 0,
    partialRate: 0.1,
  });

  assert.equal(decision.allowResubmit, true);
  assert.equal(decision.band, 'loosened');
  assert.equal(decision.maxResubmits, 2);
});

test('recent execution profile summarizes fills, latency, cancellations, and partials', () => {
  const now = Date.now();
  const profile = summarizeRecentExecutionProfile([
    {
      id: 'a1',
      cycleId: null,
      candidateId: 'c1',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'filled',
      plannedShares: 10,
      plannedPrice: 100,
      filledShares: 10,
      fillPrice: 100.2,
      brokerOrderId: 'ord-1',
      slippageBps: 20,
      retryReason: null,
      error: null,
      createdAt: now - 30_000,
      updatedAt: now,
    },
    {
      id: 'a2',
      cycleId: null,
      candidateId: 'c2',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'cancelled',
      plannedShares: 10,
      plannedPrice: 100,
      filledShares: 4,
      fillPrice: 100.5,
      brokerOrderId: 'ord-2',
      slippageBps: 50,
      retryReason: 'auto_resubmit:1:recovery',
      error: null,
      createdAt: now - 180_000,
      updatedAt: now,
    },
    {
      id: 'a3',
      cycleId: null,
      candidateId: 'c3',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'cancelled',
      plannedShares: 6,
      plannedPrice: 100,
      filledShares: null,
      fillPrice: null,
      brokerOrderId: 'ord-3',
      slippageBps: null,
      retryReason: 'risk',
      error: 'blocked',
      createdAt: now - 240_000,
      updatedAt: now,
    },
  ]);

  assert.equal(profile.sampleSize, 3);
  assert.equal(profile.fillOutcomeCount, 2);
  assert.equal(profile.avgAbsSlippageBps, 35);
  assert.equal(profile.avgLatencySeconds, 105);
  assert.equal(profile.cancellationRate, 0.67);
  assert.equal(profile.partialRate, 0.33);
});

test('execution profiles blend persisted baseline with recent attempts', () => {
  const merged = mergeExecutionProfiles({
    sampleSize: 4,
    fillOutcomeCount: 3,
    avgAbsSlippageBps: 48,
    avgLatencySeconds: 140,
    cancellationRate: 0.25,
    partialRate: 0.25,
    recentSampleSize: 4,
    baselineSampleSize: 0,
    source: 'recent',
  }, {
    sampleSize: 30,
    fillOutcomeCount: 24,
    avgAbsSlippageBps: 14,
    avgLatencySeconds: 35,
    cancellationRate: 0.05,
    partialRate: 0.08,
    scope: 'segment',
  });

  assert.equal(merged.source, 'recent+baseline');
  assert.equal(merged.sampleSize, 34);
  assert.equal(merged.fillOutcomeCount, 23);
  assert.equal(merged.avgAbsSlippageBps, 18.43);
  assert.equal(merged.avgLatencySeconds, 48.7);
});

test('persistent execution quality profiles incrementally aggregate terminal attempts', () => {
  const symbol = 'TSTPERSIST';
  db.prepare(`DELETE FROM execution_attempts WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM execution_quality_segments WHERE symbol = ?`).run(symbol);

  db.prepare(`
    INSERT INTO execution_attempts (
      id, cycle_id, candidate_id, symbol, action, mode, status, planned_shares, planned_price,
      filled_shares, fill_price, broker_order_id, slippage_bps, rollout_profile, session_regime, retry_reason, error, created_at, updated_at
    ) VALUES (
      @id, NULL, NULL, @symbol, 'BUY', 'paper', @status, 10, 100,
      @filled_shares, @fill_price, NULL, @slippage_bps, 'paper', 'cash_open', NULL, NULL, @created_at, @updated_at
    )
  `).run({
    id: 'persist-a1',
    symbol,
    status: 'filled',
    filled_shares: 10,
    fill_price: 100.2,
    slippage_bps: 20,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_030,
  });

  db.prepare(`
    INSERT INTO execution_attempts (
      id, cycle_id, candidate_id, symbol, action, mode, status, planned_shares, planned_price,
      filled_shares, fill_price, broker_order_id, slippage_bps, rollout_profile, session_regime, retry_reason, error, created_at, updated_at
    ) VALUES (
      @id, NULL, NULL, @symbol, 'BUY', 'paper', @status, 10, 100,
      @filled_shares, @fill_price, NULL, @slippage_bps, 'paper', 'cash_open', NULL, NULL, @created_at, @updated_at
    )
  `).run({
    id: 'persist-a2',
    symbol,
    status: 'cancelled',
    filled_shares: 4,
    fill_price: 100.5,
    slippage_bps: 50,
    created_at: 1_700_000_060,
    updated_at: 1_700_000_120,
  });

  const firstRefresh = refreshExecutionQualityProfiles();
  const secondRefresh = refreshExecutionQualityProfiles();
  const profile = getExecutionQualityProfile(symbol, 'BUY', 'paper', {
    rolloutProfile: 'paper',
    sessionRegime: 'cash_open',
  });

  assert.equal(firstRefresh, 2);
  assert.equal(secondRefresh, 0);
  assert.equal(profile?.sampleSize, 2);
  assert.equal(profile?.fillOutcomeCount, 2);
  assert.equal(profile?.avgAbsSlippageBps, 35);
  assert.equal(profile?.avgLatencySeconds, 45);
  assert.equal(profile?.cancellationRate, 0.5);
  assert.equal(profile?.partialRate, 0.5);
  assert.equal(profile?.scope, 'segment');

  db.prepare(`DELETE FROM execution_attempts WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM execution_quality_segments WHERE symbol = ?`).run(symbol);
});

test('adaptive policy falls back to aggregate baseline when a segment has no persisted history yet', () => {
  const symbol = 'TSTSEG';
  db.prepare(`DELETE FROM execution_attempts WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM execution_quality_segments WHERE symbol = ?`).run(symbol);

  db.prepare(`
    INSERT INTO execution_attempts (
      id, cycle_id, candidate_id, symbol, action, mode, status, planned_shares, planned_price,
      filled_shares, fill_price, broker_order_id, slippage_bps, rollout_profile, session_regime, retry_reason, error, created_at, updated_at
    ) VALUES (
      @id, NULL, NULL, @symbol, 'BUY', 'paper', 'filled', 10, 100,
      10, 100.1, NULL, 10, 'paper', 'cash_open', NULL, NULL, @created_at, @updated_at
    )
  `).run({
    id: 'seg-a1',
    symbol,
    created_at: 1_700_100_000,
    updated_at: 1_700_100_030,
  });

  db.prepare(`
    INSERT INTO execution_attempts (
      id, cycle_id, candidate_id, symbol, action, mode, status, planned_shares, planned_price,
      filled_shares, fill_price, broker_order_id, slippage_bps, rollout_profile, session_regime, retry_reason, error, created_at, updated_at
    ) VALUES (
      @id, NULL, NULL, @symbol, 'BUY', 'paper', 'cancelled', 10, 100,
      5, 100.4, NULL, 40, 'paper', 'cash_open', NULL, NULL, @created_at, @updated_at
    )
  `).run({
    id: 'seg-a2',
    symbol,
    created_at: 1_700_100_060,
    updated_at: 1_700_100_130,
  });

  refreshExecutionQualityProfiles();

  const decision = evaluateAdaptiveResubmitPolicy({
    symbol,
    action: 'BUY',
    mode: 'paper',
    currentRetryCount: 0,
    rolloutProfile: 'paper',
    sessionRegime: 'off_session_weekday',
    refreshProfiles: false,
  });

  assert.equal(decision.metrics.source, 'recent+baseline');
  assert.equal(decision.metrics.baselineScope, 'aggregate');
  assert.match(decision.reason, /aggregate mode-level baseline/);

  db.prepare(`DELETE FROM execution_attempts WHERE symbol = ?`).run(symbol);
  db.prepare(`DELETE FROM execution_quality_segments WHERE symbol = ?`).run(symbol);
});

test('portfolio construction policy reduces target weight for stressed segments before the first submit', () => {
  const severe = derivePortfolioConstructionPolicy('full_live', {
    sampleSize: 8,
    fillOutcomeCount: 6,
    avgAbsSlippageBps: 58,
    avgLatencySeconds: 210,
    cancellationRate: 0.25,
    partialRate: 0.42,
    recentSampleSize: 8,
    baselineSampleSize: 0,
    source: 'recent',
  });

  assert.equal(severe.band, 'severe');
  assert.equal(severe.targetWeightMultiplier, 0.55);

  const reduced = derivePortfolioConstructionPolicy('paper', {
    sampleSize: 8,
    fillOutcomeCount: 6,
    avgAbsSlippageBps: 28,
    avgLatencySeconds: 110,
    cancellationRate: 0.22,
    partialRate: 0.18,
    recentSampleSize: 8,
    baselineSampleSize: 0,
    source: 'recent',
  });

  assert.equal(reduced.band, 'reduced');
  assert.equal(reduced.targetWeightMultiplier, 0.8);
});

test('execution sizing policy now reserves hard reductions for rollout and degradation controls', () => {
  const limitedLive = deriveExecutionSizingPolicy('limited_live', {
    sampleSize: 8,
    fillOutcomeCount: 6,
    avgAbsSlippageBps: 58,
    avgLatencySeconds: 210,
    cancellationRate: 0.25,
    partialRate: 0.42,
    recentSampleSize: 8,
    baselineSampleSize: 0,
    source: 'recent',
  });

  assert.equal(limitedLive.band, 'base');
  assert.equal(limitedLive.multiplier, 0.85);

  const blocked = deriveExecutionSizingPolicy('paper', {
    sampleSize: 8,
    fillOutcomeCount: 6,
    avgAbsSlippageBps: 18,
    avgLatencySeconds: 45,
    cancellationRate: 0.1,
    partialRate: 0.15,
    recentSampleSize: 8,
    baselineSampleSize: 0,
    source: 'recent',
  }, 'critical', ['live_price_freshness']);

  assert.equal(blocked.band, 'blocked');
  assert.equal(blocked.multiplier, 0);
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason, /critical degradation/i);
});

test('recovery timing extends in slow segments and accelerates in clean ones', () => {
  const extended = deriveExecutionRecoveryTimingPolicy('full_live', {
    sampleSize: 18,
    fillOutcomeCount: 12,
    avgAbsSlippageBps: 58,
    avgLatencySeconds: 210,
    cancellationRate: 0.42,
    partialRate: 0.28,
    source: 'recent+baseline',
    recentSampleSize: 6,
    baselineSampleSize: 12,
    baselineScope: 'segment',
  });
  const accelerated = deriveExecutionRecoveryTimingPolicy('paper', {
    sampleSize: 14,
    fillOutcomeCount: 10,
    avgAbsSlippageBps: 8,
    avgLatencySeconds: 18,
    cancellationRate: 0,
    partialRate: 0.05,
    source: 'recent+baseline',
    recentSampleSize: 4,
    baselineSampleSize: 10,
    baselineScope: 'segment',
  });

  assert.equal(extended.band, 'extended');
  assert.equal(extended.submittedTimeoutMs, 360_000);
  assert.equal(extended.resubmitCooldownMs, 240_000);
  assert.equal(accelerated.band, 'accelerated');
  assert.equal(accelerated.submittedTimeoutMs, 90_000);
  assert.equal(accelerated.resubmitCooldownMs, 45_000);
});

test('resubmit strategy reduces size and halts repeated partial-fill churn in stressed segments', () => {
  const stressed = deriveExecutionResubmitStrategyPolicy('full_live', {
    sampleSize: 20,
    fillOutcomeCount: 14,
    avgAbsSlippageBps: 61,
    avgLatencySeconds: 230,
    cancellationRate: 0.48,
    partialRate: 0.5,
    source: 'recent+baseline',
    recentSampleSize: 8,
    baselineSampleSize: 12,
    baselineScope: 'segment',
  });
  const clean = deriveExecutionResubmitStrategyPolicy('paper', {
    sampleSize: 16,
    fillOutcomeCount: 11,
    avgAbsSlippageBps: 7,
    avgLatencySeconds: 20,
    cancellationRate: 0,
    partialRate: 0.05,
    source: 'recent+baseline',
    recentSampleSize: 6,
    baselineSampleSize: 10,
    baselineScope: 'segment',
  });

  assert.equal(stressed.band, 'halt_partial');
  assert.equal(stressed.sizeMultiplier, 0.4);
  assert.equal(stressed.allowPartialResubmit, false);
  assert.equal(clean.band, 'aggressive');
  assert.equal(clean.sizeMultiplier, 1);
  assert.equal(clean.allowPartialResubmit, true);
});
