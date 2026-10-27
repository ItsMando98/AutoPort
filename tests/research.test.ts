import test from 'node:test';
import assert from 'node:assert/strict';
import { getSignalThreshold, scoreResearchEvents, type ResearchEvent } from '../server/research.js';

function makeEvent(overrides: Partial<ResearchEvent>): ResearchEvent {
  return {
    id: 'evt',
    sourceType: 'news',
    sourceId: 'src',
    symbol: 'NVDA',
    title: 'Event',
    summary: 'Summary',
    sentiment: 'bullish',
    eventType: 'general',
    importance: 0.8,
    url: null,
    payload: {},
    eventTimestamp: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

test('research scoring turns bullish events into buy bias', () => {
  const result = scoreResearchEvents([
    makeEvent({ sourceType: 'filing', sentiment: 'bullish', importance: 1 }),
    makeEvent({ id: 'evt-2', sourceType: 'news', sentiment: 'bullish', importance: 0.7 }),
  ]);

  assert.equal(result.direction, 'BUY');
  assert.ok(result.score > 0);
  assert.match(result.reasoning, /bullish/i);
});

test('research scoring turns bearish insider activity into sell bias', () => {
  const result = scoreResearchEvents([
    makeEvent({ sourceType: 'insider', sentiment: 'bearish', importance: 0.9 }),
  ]);

  assert.equal(result.direction, 'SELL');
  assert.ok(result.score < 0);
});

test('hedge fund events are discounted when older than 60 days', () => {
  const fresh = scoreResearchEvents([
    makeEvent({ sourceType: 'hedge_fund', sentiment: 'bullish', importance: 1, eventTimestamp: Date.now() }),
  ]);
  const stale = scoreResearchEvents([
    makeEvent({ sourceType: 'hedge_fund', sentiment: 'bullish', importance: 1, eventTimestamp: Date.now() - 61 * 24 * 60 * 60 * 1000 }),
  ]);

  assert.equal(fresh.score, 14);
  assert.equal(stale.score, 7);
});

test('options flow and short interest use their configured source weights', () => {
  const options = scoreResearchEvents([
    makeEvent({ sourceType: 'options_flow', sentiment: 'bullish', importance: 1 }),
  ]);
  const shortInterest = scoreResearchEvents([
    makeEvent({ sourceType: 'short_interest', sentiment: 'bearish', importance: 1 }),
  ]);

  assert.equal(options.score, 12);
  assert.equal(shortInterest.score, -10);
});

test('macro regime changes candidate thresholds', () => {
  assert.equal(getSignalThreshold('bull'), 15);
  assert.equal(getSignalThreshold('neutral'), 20);
  assert.equal(getSignalThreshold('bear'), 28);
});
