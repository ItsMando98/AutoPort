import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCandidateFunnel, summarizeExecutionLifecycle, summarizeExecutionOps, summarizeRiskEvents } from '../server/reports.js';

test('candidate funnel summary counts statuses and actions', () => {
  const summary = summarizeCandidateFunnel([
    {
      id: 'c1',
      symbol: 'NVDA',
      action: 'BUY',
      score: 28,
      confidence: 82,
      status: 'new',
      reasoning: 'Bullish research',
      sourceEventIds: ['e1'],
      factorBreakdown: { research: 28 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'c2',
      symbol: 'AAPL',
      action: 'SELL',
      score: -30,
      confidence: 88,
      status: 'executed',
      reasoning: 'Bearish filing',
      sourceEventIds: ['e2'],
      factorBreakdown: { research: -30 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'c3',
      symbol: 'MSFT',
      action: 'BUY',
      score: 20,
      confidence: 61,
      status: 'blocked',
      reasoning: 'Blocked by risk',
      sourceEventIds: ['e3'],
      factorBreakdown: { research: 20 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'c4',
      symbol: 'META',
      action: 'BUY',
      score: 24,
      confidence: 79,
      status: 'in_flight',
      reasoning: 'Submitted to broker',
      sourceEventIds: ['e4'],
      factorBreakdown: { research: 24 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.buy, 3);
  assert.equal(summary.sell, 1);
  assert.equal(summary.inFlight, 1);
  assert.equal(summary.executed, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.highConfidence, 3);
});

test('execution lifecycle summary computes fill rate', () => {
  const summary = summarizeExecutionLifecycle([
    {
      id: 'a1',
      cycleId: null,
      candidateId: 'c1',
      symbol: 'NVDA',
      action: 'BUY',
      mode: 'paper',
      status: 'filled',
      plannedShares: 10,
      plannedPrice: 120,
      filledShares: 10,
      fillPrice: 120,
      brokerOrderId: null,
      slippageBps: 0,
      retryReason: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'a2',
      cycleId: null,
      candidateId: 'c2',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'partially_filled',
      plannedShares: 8,
      plannedPrice: 200,
      filledShares: 3,
      fillPrice: 201,
      brokerOrderId: 'ord-2',
      slippageBps: 50,
      retryReason: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'a3',
      cycleId: null,
      candidateId: 'c3',
      symbol: 'AAPL',
      action: 'SELL',
      mode: 'paper',
      status: 'rejected',
      plannedShares: 5,
      plannedPrice: 200,
      filledShares: null,
      fillPrice: null,
      brokerOrderId: null,
      slippageBps: null,
      retryReason: 'risk',
      error: 'blocked',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.partiallyFilled, 1);
  assert.equal(summary.filled, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.fillRate, 33.3);
});

test('risk summary aggregates top block reasons', () => {
  const summary = summarizeRiskEvents([
    { allowed: 0, failed_check: 'market_hours' },
    { allowed: 0, failed_check: 'market_hours' },
    { allowed: 0, failed_check: 'price_freshness' },
    { allowed: 1, failed_check: null },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.blocked, 3);
  assert.equal(summary.passed, 1);
  assert.equal(summary.topBlockReasons[0]?.reason, 'market_hours');
  assert.equal(summary.topBlockReasons[0]?.count, 2);
});

test('execution ops summary highlights stale in-flight attempts', () => {
  const now = Date.now();
  const summary = summarizeExecutionOps([
    {
      id: 'a1',
      cycleId: null,
      candidateId: 'c1',
      symbol: 'NVDA',
      action: 'BUY',
      mode: 'paper',
      status: 'submitted',
      plannedShares: 10,
      plannedPrice: 120,
      filledShares: null,
      fillPrice: null,
      brokerOrderId: 'ord-1',
      slippageBps: null,
      retryReason: null,
      error: null,
      createdAt: now - 5 * 60_000,
      updatedAt: now - 5 * 60_000,
    },
    {
      id: 'a2',
      cycleId: null,
      candidateId: 'c2',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'partially_filled',
      plannedShares: 8,
      plannedPrice: 200,
      filledShares: 3,
      fillPrice: 201,
      brokerOrderId: 'ord-2',
      slippageBps: 50,
      retryReason: 'auto_recovery_partial_cancelled',
      error: null,
      createdAt: now - 6 * 60_000,
      updatedAt: now - 6 * 60_000,
    },
  ], now);

  assert.equal(summary.active, 2);
  assert.equal(summary.submitted, 1);
  assert.equal(summary.partiallyFilled, 1);
  assert.equal(summary.stale, 2);
  assert.equal(summary.autoRecoveryTagged, 1);
  assert.equal(summary.items[0]?.stale, true);
  assert.equal(summary.items[0]?.rolloutProfile ?? null, null);
  assert.equal(summary.items[0]?.sessionRegime ?? null, null);
  assert.equal(summary.items[0]?.policyBand, 'base');
  assert.equal(typeof summary.items[0]?.policyReason, 'string');
  assert.equal(summary.items[0]?.maxResubmits, 2);
  assert.equal(typeof summary.items[0]?.staleAfterMinutes, 'number');
  assert.equal(typeof summary.items[0]?.resubmitCooldownMinutes, 'number');
  assert.equal(summary.items[0]?.recoveryTimingBand, 'base');
  assert.equal(typeof summary.items[0]?.recoveryTimingReason, 'string');
  assert.equal(summary.items[0]?.resubmitStrategyBand, 'base');
  assert.equal(summary.items[0]?.resubmitSizePct, 100);
  assert.equal(summary.items[0]?.allowPartialResubmit, true);
  assert.equal(typeof summary.items[0]?.resubmitStrategyReason, 'string');
});
