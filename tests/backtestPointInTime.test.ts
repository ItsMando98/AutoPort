import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { DEFAULT_CONFIG, runBacktest } from '../server/backtest.js';

const SYMBOL = 'PITX';

function seedReplayFixture(): void {
  db.prepare('DELETE FROM research_events WHERE symbol = ?').run(SYMBOL);
  db.prepare('DELETE FROM price_history WHERE symbol IN (?, ?)').run(SYMBOL, 'SPY');

  const insertPrice = db.prepare(`
    INSERT INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const dates: string[] = [];
  for (let offset = 29; offset >= 0; offset--) {
    const date = new Date(Date.UTC(2026, 0, 31 - offset));
    dates.push(date.toISOString().slice(0, 10));
  }
  for (const [index, date] of dates.entries()) {
    const isDecisionDay = date === '2026-01-30';
    const isFillDay = date === '2026-01-31';
    const open = isFillDay ? 100 : 80 + index * 0.2;
    const close = isDecisionDay ? 90 : isFillDay ? 105 : open + 0.1;
    insertPrice.run(SYMBOL, date, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, 2_000_000);
    insertPrice.run('SPY', date, 400, 402, 399, 401, 5_000_000);
  }

  const eventTimestamp = Date.parse('2026-01-30T20:00:00Z') / 1000;
  for (const [id, sourceType] of [['pit-filing', 'filing'], ['pit-news', 'news']] as const) {
    db.prepare(`
      INSERT INTO research_events
        (id, source_type, source_id, symbol, title, sentiment, importance, event_timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, 'bullish', 1, ?, ?)
    `).run(id, sourceType, id, SYMBOL, 'Point-in-time bullish catalyst', eventTimestamp, eventTimestamp);
  }
}

function cleanup(): void {
  db.prepare('DELETE FROM research_events WHERE symbol = ?').run(SYMBOL);
  db.prepare('DELETE FROM price_history WHERE symbol IN (?, ?)').run(SYMBOL, 'SPY');
}

test('research observed on day D can first fill at day D+1 open', () => {
  seedReplayFixture();
  const result = runBacktest({
    ...DEFAULT_CONFIG,
    startDate: '2026-01-30',
    endDate: '2026-01-31',
    minCandidateConfidence: 0,
    spreadBps: 0,
    slippageBps: 0,
  });

  const buy = result.trades.find(trade => trade.symbol === SYMBOL && trade.action === 'BUY');
  assert.ok(buy);
  assert.equal(buy.date, '2026-01-31');
  assert.equal(buy.price, 100);
  cleanup();
});

test('spread and slippage are side-aware and reported as modeled costs', () => {
  seedReplayFixture();
  const result = runBacktest({
    ...DEFAULT_CONFIG,
    startDate: '2026-01-30',
    endDate: '2026-01-31',
    minCandidateConfidence: 0,
    spreadBps: 10,
    slippageBps: 5,
  });

  const buy = result.trades.find(trade => trade.symbol === SYMBOL && trade.action === 'BUY');
  assert.ok(buy);
  assert.equal(buy.price, 100.1);
  assert.ok(result.diagnostics.modeledCosts > 0);
  cleanup();
});
