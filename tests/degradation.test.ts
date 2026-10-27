import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { fetchCurrentPrices, resetMarketDataCacheForTests } from '../server/marketdata.js';
import { refreshDegradationState } from '../server/degradation.js';
import { upsertDataSourceStatus } from '../server/ops.js';

function resetDegradationRow() {
  db.prepare(`
    UPDATE system_degradation_state
    SET live_auto_lock_engaged = 0,
        live_auto_lock_reason = NULL,
        severity = 'none',
        execution_allowed_live = 1,
        execution_allowed_paper = 1,
        last_critical_at = NULL,
        last_healthy_at = NULL,
        stable_after = NULL,
        details = '{}',
        updated_at = unixepoch()
    WHERE id = 1
  `).run();
  db.prepare(`DELETE FROM data_source_status WHERE source IN ('live_prices', 'broker_submit', 'broker_reconciliation')`).run();
}

async function resetMarketDataStatus() {
  resetMarketDataCacheForTests();
  const symbol = 'RESETMKT';
  db.prepare(`DELETE FROM price_history WHERE symbol = ?`).run(symbol);
  db.prepare(`
    INSERT INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (?, date('now'), 100, 101, 99, 100, 1000)
  `).run(symbol);
  await fetchCurrentPrices([symbol]);
  db.prepare(`DELETE FROM price_history WHERE symbol = ?`).run(symbol);
}

test('degradation auto-lock stays engaged until the stability window passes', async () => {
  resetDegradationRow();
  resetMarketDataCacheForTests();

  const previous = {
    key: process.env.ALPACA_API_KEY,
    secret: process.env.ALPACA_API_SECRET,
    mode: process.env.ALPACA_MODE,
  };

  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_API_SECRET = 'test-secret';
  process.env.ALPACA_MODE = 'live';
  try {
    const t0 = Date.now();
    upsertDataSourceStatus({
      source: 'live_prices',
      status: 'ok',
      lastSuccessAt: Math.floor(t0 / 1000),
      details: { source: 'stored_eod_fallback' },
    });

    const critical = refreshDegradationState(t0);
    assert.equal(critical.severity, 'critical');
    assert.equal(critical.liveAutoLockEngaged, true);
    assert.equal(critical.executionAllowedLive, false);

    upsertDataSourceStatus({
      source: 'live_prices',
      status: 'ok',
      lastSuccessAt: Math.floor((t0 + 60_000) / 1000),
      details: { source: 'alpaca' },
    });

    const stillLocked = refreshDegradationState(t0 + 60_000);
    assert.equal(stillLocked.severity, 'none');
    assert.equal(stillLocked.liveAutoLockEngaged, true);
    assert.equal(stillLocked.executionAllowedLive, false);

    const released = refreshDegradationState(t0 + (6 * 60_000));
    assert.equal(released.severity, 'none');
    assert.equal(released.liveAutoLockEngaged, false);
    assert.equal(released.executionAllowedLive, true);
  } finally {
    if (previous.key === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previous.secret;
    if (previous.mode === undefined) delete process.env.ALPACA_MODE;
    else process.env.ALPACA_MODE = previous.mode;
    resetDegradationRow();
    await resetMarketDataStatus();
  }
});

test('paper execution is blocked when there is no valid price path', async () => {
  resetDegradationRow();
  resetMarketDataCacheForTests();

  const previous = {
    key: process.env.ALPACA_API_KEY,
    secret: process.env.ALPACA_API_SECRET,
    mode: process.env.ALPACA_MODE,
  };

  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_API_SECRET;
  delete process.env.ALPACA_MODE;
  try {
    db.prepare(`DELETE FROM price_history WHERE symbol = 'NOPRICEPATH'`).run();
    await fetchCurrentPrices(['NOPRICEPATH']);

    const degraded = refreshDegradationState();
    assert.equal(degraded.severity, 'critical');
    assert.equal(degraded.executionAllowedPaper, false);
  } finally {
    if (previous.key === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previous.secret;
    if (previous.mode === undefined) delete process.env.ALPACA_MODE;
    else process.env.ALPACA_MODE = previous.mode;
    resetDegradationRow();
    await resetMarketDataStatus();
  }
});

test('paper mode treats polygon delayed quotes as acceptable', async () => {
  resetDegradationRow();
  resetMarketDataCacheForTests();

  const previous = {
    key: process.env.ALPACA_API_KEY,
    secret: process.env.ALPACA_API_SECRET,
    mode: process.env.ALPACA_MODE,
    polygon: process.env.POLYGON_API_KEY,
  };
  const previousFetch = globalThis.fetch;

  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_API_SECRET;
  process.env.ALPACA_MODE = 'paper';
  process.env.POLYGON_API_KEY = 'test-polygon-key';
  globalThis.fetch = (async () => new Response(JSON.stringify({
    tickers: [{ ticker: 'AAPL', day: { c: 200 } }],
  }), { status: 200 })) as typeof fetch;
  try {
    await fetchCurrentPrices(['AAPL']);

    const degraded = refreshDegradationState();
    assert.equal(degraded.severity, 'none');
    assert.equal(degraded.executionAllowedPaper, true);
    assert.equal(degraded.signals.find(signal => signal.id === 'quote_fallback')?.severity, 'none');
  } finally {
    if (previous.key === undefined) delete process.env.ALPACA_API_KEY;
    else process.env.ALPACA_API_KEY = previous.key;
    if (previous.secret === undefined) delete process.env.ALPACA_API_SECRET;
    else process.env.ALPACA_API_SECRET = previous.secret;
    if (previous.mode === undefined) delete process.env.ALPACA_MODE;
    else process.env.ALPACA_MODE = previous.mode;
    if (previous.polygon === undefined) delete process.env.POLYGON_API_KEY;
    else process.env.POLYGON_API_KEY = previous.polygon;
    globalThis.fetch = previousFetch;
    resetDegradationRow();
    resetMarketDataCacheForTests();
  }
});
