import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTrade, getState, syncFromBroker } from '../server/portfolio.js';

test.afterEach(() => {
  syncFromBroker({ cash: 100_000, positions: [] });
});

test('portfolio supports opening and covering a short position', () => {
  syncFromBroker({ cash: 100_000, positions: [] });

  assert.equal(executeTrade('SELL', 'NVDA', 10, 100), true);
  let state = getState();
  assert.equal(state.cash, 101_000);
  assert.deepEqual(state.positions, [{ symbol: 'NVDA', shares: -10, avgPrice: 100 }]);

  assert.equal(executeTrade('BUY', 'NVDA', 4, 90), true);
  state = getState();
  assert.equal(state.cash, 100_640);
  assert.deepEqual(state.positions, [{ symbol: 'NVDA', shares: -6, avgPrice: 100 }]);

  assert.equal(executeTrade('BUY', 'NVDA', 6, 95), true);
  state = getState();
  assert.equal(state.cash, 100_070);
  assert.deepEqual(state.positions, []);
});

test('portfolio allows selling through an existing long into a net short', () => {
  syncFromBroker({ cash: 100_000, positions: [] });

  assert.equal(executeTrade('BUY', 'AAPL', 5, 100), true);
  assert.equal(executeTrade('SELL', 'AAPL', 8, 110), true);

  const state = getState();
  assert.equal(state.cash, 100_380);
  assert.deepEqual(state.positions, [{ symbol: 'AAPL', shares: -3, avgPrice: 110 }]);
});
