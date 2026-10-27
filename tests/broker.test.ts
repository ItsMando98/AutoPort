import test from 'node:test';
import assert from 'node:assert/strict';
import { getState, syncFromBroker } from '../server/portfolio.js';
import { syncToLocalPortfolio } from '../server/broker.js';

test('broker sync imports named portfolio module and updates local state', async () => {
  const previousEnv = {
    key: process.env.ALPACA_API_KEY,
    secret: process.env.ALPACA_API_SECRET,
    mode: process.env.ALPACA_MODE,
  };
  const previousFetch = globalThis.fetch;

  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_API_SECRET = 'test-secret';
  process.env.ALPACA_MODE = 'paper';

  syncFromBroker({ cash: 100_000, positions: [] });

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/v2/account')) {
      return new Response(JSON.stringify({
        cash: '91234.56',
        portfolio_value: '100100.00',
        buying_power: '182469.12',
        equity: '100100.00',
        long_market_value: '8865.44',
        trading_blocked: false,
        account_blocked: false,
      }), { status: 200 });
    }
    if (url.endsWith('/v2/positions')) {
      return new Response(JSON.stringify([
        {
          symbol: 'NVDA',
          qty: '12',
          avg_entry_price: '184.25',
          current_price: '185.10',
          market_value: '2221.20',
          unrealized_pl: '10.20',
          unrealized_plpc: '0.0046',
          side: 'long',
        },
        {
          symbol: 'TSLA',
          qty: '5',
          avg_entry_price: '250.00',
          current_price: '255.00',
          market_value: '-1275.00',
          unrealized_pl: '-25.00',
          unrealized_plpc: '-0.02',
          side: 'short',
        },
      ]), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    await syncToLocalPortfolio();
    const state = getState();
    assert.equal(state.cash, 91234.56);
    assert.deepEqual(state.positions, [
      { symbol: 'NVDA', shares: 12, avgPrice: 184.25 },
      { symbol: 'TSLA', shares: -5, avgPrice: 250 },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    syncFromBroker({ cash: 100_000, positions: [] });
    if (previousEnv.key === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previousEnv.key;
    if (previousEnv.secret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previousEnv.secret;
    if (previousEnv.mode === undefined) delete process.env.ALPACA_MODE;
    else process.env.ALPACA_MODE = previousEnv.mode;
  }
});
