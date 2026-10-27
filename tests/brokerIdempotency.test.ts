import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrderByClientOrderId, placeMarketOrder } from '../server/broker.js';

function withBrokerEnv(): () => void {
  const previous = {
    key: process.env.ALPACA_API_KEY,
    secret: process.env.ALPACA_API_SECRET,
    mode: process.env.ALPACA_MODE,
  };
  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_API_SECRET = 'test-secret';
  process.env.ALPACA_MODE = 'paper';
  return () => {
    if (previous.key === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previous.secret;
    if (previous.mode === undefined) delete process.env.ALPACA_MODE;
    else process.env.ALPACA_MODE = previous.mode;
  };
}

test('market orders include a deterministic client order id', async () => {
  const restoreEnv = withBrokerEnv();
  const previousFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: 'broker-order-1', client_order_id: 'attempt-123', symbol: 'AAPL', side: 'buy',
      qty: '2', filled_qty: '0', filled_avg_price: null, status: 'accepted', type: 'market',
      time_in_force: 'day', created_at: '2026-07-19T12:00:00Z', filled_at: null,
    }), { status: 200 });
  }) as typeof fetch;

  try {
    await placeMarketOrder('AAPL', 'buy', 2, 'attempt-123');
    assert.deepEqual(requestBody, {
      symbol: 'AAPL', qty: '2', side: 'buy', type: 'market', time_in_force: 'day',
      client_order_id: 'attempt-123',
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('client order lookup returns null only when Alpaca reports 404', async () => {
  const restoreEnv = withBrokerEnv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;

  try {
    assert.equal(await getOrderByClientOrderId('attempt-404'), null);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});
