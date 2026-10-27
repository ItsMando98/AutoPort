import test from 'node:test';
import assert from 'node:assert/strict';
import { getReconciliationStatus, normalizeBrokerStatus, reconcileBrokerOrders } from '../server/reconciliation.js';

test('reconciliation records a successful skipped run when broker is not connected', async () => {
  const before = getReconciliationStatus();
  assert.equal(before.running, false);

  const result = await reconcileBrokerOrders();
  assert.deepEqual(result, {
    scanned: 0,
    updated: 0,
    filled: 0,
    rejected: 0,
    cancelled: 0,
  });

  const after = getReconciliationStatus();
  assert.equal(after.running, false);
  assert.equal(after.lastError, null);
  assert.ok(after.lastRunAt !== null);
  assert.ok(after.lastSuccessAt !== null);
  assert.deepEqual(after.lastResult, result);
});

test('broker status normalization distinguishes partial fills from submitted orders', () => {
  assert.equal(normalizeBrokerStatus('new'), 'submitted');
  assert.equal(normalizeBrokerStatus('partially_filled'), 'partially_filled');
  assert.equal(normalizeBrokerStatus('filled'), 'filled');
  assert.equal(normalizeBrokerStatus('canceled'), 'cancelled');
});
