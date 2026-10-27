import test from 'node:test';
import assert from 'node:assert/strict';
import { getStopLossAlerts, getStopLossThreshold } from '../server/risk.js';

test('macro regime adjusts stop-loss thresholds', () => {
  assert.equal(getStopLossThreshold('bull'), -0.08);
  assert.equal(getStopLossThreshold('neutral'), -0.06);
  assert.equal(getStopLossThreshold('bear'), -0.05);
});

test('stop-loss scanning respects regime-specific thresholds', () => {
  const positions = [{ symbol: 'AAPL', shares: 10, avgPrice: 100 }];
  const prices = { AAPL: 94 };

  assert.equal(getStopLossAlerts(positions, prices, 'bull').length, 0);
  assert.equal(getStopLossAlerts(positions, prices, 'neutral').length, 1);
  assert.equal(getStopLossAlerts(positions, prices, 'bear').length, 1);
});

test('stop-loss scanning works for short positions when price rises against the trade', () => {
  const positions = [{ symbol: 'TSLA', shares: -10, avgPrice: 100 }];
  const prices = { TSLA: 107 };

  const alerts = getStopLossAlerts(positions, prices, 'neutral');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.symbol, 'TSLA');
  assert.ok((alerts[0]?.pnlPct ?? 0) < 0);
});
