import test from 'node:test';
import assert from 'node:assert/strict';
import { determineOrderPlan, deriveBaseTargetWeight } from '../server/strategy.js';

test('determineOrderPlan preserves base target weight and applies construction feedback before share sizing', () => {
  const plan = determineOrderPlan(
    'BUY',
    88,
    'AAPL',
    100,
    {
      cash: 20_000,
      positions: [],
    },
    100_000,
    {
      targetWeightMultiplier: 0.55,
      executionFeedbackBand: 'severe',
      executionFeedbackReason: 'Execution quality for this segment is weak.',
    },
    'bull',
  );

  assert.equal(deriveBaseTargetWeight('BUY', 88, 'bull'), 0.15);
  assert.equal(plan.baseTargetWeight, 0.15);
  assert.equal(plan.adjustedTargetWeight, 0.0825);
  assert.equal(plan.targetWeight, 0.0825);
  assert.equal(plan.shares, 82);
  assert.equal(plan.executionFeedbackBand, 'severe');
  assert.match(plan.executionFeedbackReason ?? '', /segment is weak/i);
});

test('sell order plans remain outside target-weight construction', () => {
  const plan = determineOrderPlan(
    'SELL',
    90,
    'AAPL',
    100,
    {
      cash: 10_000,
      positions: [{ symbol: 'AAPL', shares: 12 }],
    },
    50_000,
    {
      targetWeightMultiplier: 0.55,
      executionFeedbackBand: 'severe',
      executionFeedbackReason: 'Should not apply to sell exits.',
    },
    'neutral',
  );

  assert.equal(plan.intent, 'close');
  assert.equal(plan.shares, 12);
  assert.equal(plan.baseTargetWeight, 0);
  assert.equal(plan.adjustedTargetWeight, 0);
  assert.equal(plan.executionFeedbackBand, null);
  assert.equal(plan.executionFeedbackReason, null);
});

test('sell order plans open short exposure when no long position exists', () => {
  const plan = determineOrderPlan(
    'SELL',
    90,
    'AAPL',
    100,
    {
      cash: 10_000,
      positions: [],
    },
    50_000,
    {
      targetWeightMultiplier: 0.5,
      executionFeedbackBand: 'reduced',
      executionFeedbackReason: 'Construction reduced the short sleeve size.',
    },
    'neutral',
  );

  assert.equal(deriveBaseTargetWeight('SELL', 90, 'neutral'), 0.1275);
  assert.equal(plan.intent, 'target_weight');
  assert.equal(plan.baseTargetWeight, -0.1275);
  assert.equal(plan.adjustedTargetWeight, -0.0638);
  assert.equal(plan.targetWeight, -0.0638);
  assert.equal(plan.shares, 31);
  assert.equal(plan.executionFeedbackBand, 'reduced');
});

test('macro regime reduces buy sizing before construction feedback is applied', () => {
  assert.equal(deriveBaseTargetWeight('BUY', 88, 'neutral'), 0.1275);
  assert.equal(deriveBaseTargetWeight('BUY', 88, 'bear'), 0.0975);
  assert.equal(deriveBaseTargetWeight('SELL', 88, 'bear'), 0.0975);
});
