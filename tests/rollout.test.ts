import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLiveExecutionPolicy, getRolloutPolicy } from '../server/rollout.js';

test('limited live rollout is autonomous but constrained', () => {
  const policy = getRolloutPolicy('limited_live');
  assert.equal(policy.maxOrderValue, 5000);
  assert.equal(policy.maxFilledOrdersPerDay, 3);
});

test('full live rollout raises autonomous limits', () => {
  const policy = getRolloutPolicy('full_live');
  assert.equal(policy.maxFilledOrdersPerDay, 10);
});

test('non-live broker mode bypasses live rollout blocking', () => {
  const decision = evaluateLiveExecutionPolicy({ shares: 10, price: 100 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'Broker is not in live mode.');
});
