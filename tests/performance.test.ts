import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeExecutionQuality } from '../server/performance.js';

test('execution quality separates first-pass and resubmitted fill outcomes', () => {
  const now = Date.now();
  const summary = summarizeExecutionQuality([
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
      fillPrice: 120.5,
      brokerOrderId: 'ord-1',
      slippageBps: 41.67,
      retryReason: 'target_weight',
      error: null,
      createdAt: now - 40_000,
      updatedAt: now,
    },
    {
      id: 'a2',
      cycleId: null,
      candidateId: 'c2',
      symbol: 'AAPL',
      action: 'BUY',
      mode: 'paper',
      status: 'filled',
      plannedShares: 8,
      plannedPrice: 200,
      filledShares: 8,
      fillPrice: 201,
      brokerOrderId: 'ord-2',
      slippageBps: 50,
      retryReason: 'auto_resubmit:1:target_weight',
      error: null,
      createdAt: now - 180_000,
      updatedAt: now,
    },
    {
      id: 'a3',
      cycleId: null,
      candidateId: 'c3',
      symbol: 'MSFT',
      action: 'SELL',
      mode: 'paper',
      status: 'cancelled',
      plannedShares: 6,
      plannedPrice: 300,
      filledShares: 2,
      fillPrice: 301,
      brokerOrderId: 'ord-3',
      slippageBps: -33.33,
      retryReason: 'auto_resubmit:2:recovery',
      error: null,
      createdAt: now - 360_000,
      updatedAt: now,
    },
  ]);

  assert.equal(summary.totalFillOutcomes, 3);
  assert.equal(summary.fullFills, 2);
  assert.equal(summary.partialOutcomes, 1);
  assert.equal(summary.resubmittedOutcomes, 2);
  assert.equal(summary.firstPassAvgLatencySeconds, 40);
  assert.equal(summary.resubmitAvgLatencySeconds, 270);
  assert.equal(summary.worstCases[0]?.symbol, 'AAPL');
});
