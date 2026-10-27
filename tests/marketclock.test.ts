import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketSessionStatus } from '../server/marketclock.js';

test('market session reports open during weekday cash session', () => {
  const status = getMarketSessionStatus(new Date('2026-03-10T15:00:00Z'));
  assert.equal(status.isWeekday, true);
  assert.equal(status.isOpen, true);
  assert.equal(status.session, 'open');
});

test('market session reports closed on weekend', () => {
  const status = getMarketSessionStatus(new Date('2026-03-14T15:00:00Z'));
  assert.equal(status.isWeekday, false);
  assert.equal(status.isOpen, false);
  assert.equal(status.session, 'closed');
});
