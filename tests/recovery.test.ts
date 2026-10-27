import test from 'node:test';
import assert from 'node:assert/strict';
import { getExecutionRecoveryThresholdMs, getMinimumResubmitCooldownMs, getRecoveryStatus, recoverExecutionAttempts } from '../server/recovery.js';
import { getAutoResubmitCount } from '../server/executionMeta.js';

test('recovery thresholds are stricter for submitted than partial fills', () => {
  assert.equal(getExecutionRecoveryThresholdMs('submitted'), 2 * 60 * 1000);
  assert.equal(getExecutionRecoveryThresholdMs('partially_filled'), 5 * 60 * 1000);
  assert.equal(getMinimumResubmitCooldownMs(), 30 * 1000);
});

test('recovery records a successful skipped run when broker is not connected', async () => {
  const result = await recoverExecutionAttempts();
  assert.deepEqual(result, {
    scanned: 0,
    staleSubmitted: 0,
    stalePartial: 0,
    cancelled: 0,
    brokerMissing: 0,
    recoveredPartial: 0,
    resubmitted: 0,
  });

  const status = getRecoveryStatus();
  assert.equal(status.running, false);
  assert.equal(status.lastError, null);
  assert.deepEqual(status.lastResult, result);
});

test('auto resubmit counter parses retry metadata', () => {
  assert.equal(getAutoResubmitCount(null), 0);
  assert.equal(getAutoResubmitCount('target_weight'), 0);
  assert.equal(getAutoResubmitCount('auto_resubmit:2:target_weight'), 2);
});
