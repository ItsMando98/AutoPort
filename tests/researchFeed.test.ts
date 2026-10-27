import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { syncFromBroker } from '../server/portfolio.js';
import { saveResearchEvents } from '../server/research.js';
import { getResearchFeed } from '../server/researchFeed.js';

const TEST_PREFIX = 'RFTEST';

function cleanup(): void {
  db.prepare(`DELETE FROM signal_candidates WHERE symbol LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM research_events WHERE symbol LIKE ? OR source_id LIKE ?`).run(`${TEST_PREFIX}%`, `${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM news_articles WHERE id LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM companies WHERE symbol LIKE ?`).run(`${TEST_PREFIX}%`);
  syncFromBroker({ cash: 100_000, positions: [] });
}

function insertCompany(symbol: string, sector: string, name = symbol): void {
  db.prepare(`
    INSERT INTO companies (symbol, name, sector, market_cap_category, description, updated_at)
    VALUES (?, ?, ?, 'large', NULL, unixepoch())
    ON CONFLICT(symbol) DO UPDATE SET
      name = excluded.name,
      sector = excluded.sector,
      updated_at = unixepoch()
  `).run(symbol, name, sector);
}

function insertCandidate(symbol: string, action: 'BUY' | 'SELL', score: number, confidence: number): void {
  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, updated_at)
    VALUES
      (?, ?, ?, ?, ?, 'new', 'Test candidate', '[]', '{}', unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      score = excluded.score,
      confidence = excluded.confidence,
      updated_at = unixepoch()
  `).run(`${symbol}-candidate`, symbol, action, score, confidence);
}

test.beforeEach(cleanup);
test.after(cleanup);

test('market events appear in market and sector views but not in stock stories', () => {
  insertCompany('RFTESTM1', 'Test Macro Sector');

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: 'RFTEST-market-open',
      symbol: 'MARKET',
      title: 'Macro stress is rising',
      sentiment: 'bearish',
      eventType: 'macro_shift',
      importance: 0.9,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'filing',
      sourceId: 'RFTEST-stock-1',
      symbol: 'RFTESTM1',
      title: 'RFTESTM1 files positive update',
      sentiment: 'bullish',
      eventType: 'filing_update',
      importance: 0.8,
      eventTimestamp: Date.now(),
    },
  ]);

  const stockFeed = getResearchFeed({ scope: 'stock', entity: 'RFTESTM1', hoursBack: 72 });
  assert.ok(stockFeed.stories.length > 0);
  assert.equal(stockFeed.stories.some(story => story.events.some(event => event.symbol === 'MARKET')), false);

  const sectorFeed = getResearchFeed({ scope: 'sector', entity: 'Test Macro Sector', hoursBack: 72 });
  assert.ok(sectorFeed.stories.some(story => story.events.some(event => event.symbol === 'MARKET')));

  const marketFeed = getResearchFeed({ scope: 'market', entity: 'MARKET', hoursBack: 72 });
  assert.ok(marketFeed.stories.length > 0);
  assert.equal(marketFeed.stories.every(story => story.events.every(event => event.symbol === 'MARKET')), true);
});

test('sector aggregation uses company sector mapping for stock stories', () => {
  insertCompany('RFTESTS1', 'Sector Alpha');
  insertCompany('RFTESTS2', 'Sector Alpha');
  insertCompany('RFTESTS3', 'Sector Beta');

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: 'RFTEST-sector-a1',
      symbol: 'RFTESTS1',
      title: 'Sector Alpha stock one gains support',
      sentiment: 'bullish',
      eventType: 'product_cycle',
      importance: 0.8,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'insider',
      sourceId: 'RFTEST-sector-a2',
      symbol: 'RFTESTS2',
      title: 'Sector Alpha stock two insider buy',
      sentiment: 'bullish',
      eventType: 'insider_transaction',
      importance: 0.9,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: 'RFTEST-sector-b1',
      symbol: 'RFTESTS3',
      title: 'Sector Beta turns weaker',
      sentiment: 'bearish',
      eventType: 'downgrade',
      importance: 0.7,
      eventTimestamp: Date.now(),
    },
  ]);

  const feed = getResearchFeed({ scope: 'sector', entity: 'Sector Alpha', hoursBack: 72 });
  assert.equal(feed.selectedEntity.entity, 'Sector Alpha');
  assert.equal(feed.selectedEntity.topSymbols.some(item => item.symbol === 'RFTESTS1'), true);
  assert.equal(feed.selectedEntity.topSymbols.some(item => item.symbol === 'RFTESTS2'), true);
  assert.equal(feed.selectedEntity.topSymbols.some(item => item.symbol === 'RFTESTS3'), false);
});

test('tracked universe excludes symbols that are not tracked or in portfolio', () => {
  insertCompany('RFTESTU1', 'Universe Sector');

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: 'RFTEST-tracked',
      symbol: 'RFTESTU1',
      title: 'Tracked symbol appears',
      sentiment: 'bullish',
      eventType: 'coverage',
      importance: 0.6,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: 'RFTEST-untracked',
      symbol: 'ZZZUNTRACKED',
      title: 'Untracked symbol should disappear',
      sentiment: 'bullish',
      eventType: 'coverage',
      importance: 1,
      eventTimestamp: Date.now(),
    },
  ]);

  const feed = getResearchFeed({ scope: 'stock', entity: 'ZZZUNTRACKED', hoursBack: 72 });
  assert.equal(feed.entities.stocks.some(row => row.entity === 'ZZZUNTRACKED'), false);
  assert.notEqual(feed.selectedEntity.entity, 'ZZZUNTRACKED');
  assert.equal(feed.stories.some(story => story.symbols.includes('ZZZUNTRACKED')), false);
});

test('ranking prefers fresh confirmed actionable stories over older single events', () => {
  insertCompany('RFTESTR1', 'Ranking Sector');
  insertCompany('RFTESTR2', 'Ranking Sector');

  const now = Date.now();
  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: 'RFTEST-rank-fresh-1',
      symbol: 'RFTESTR1',
      title: 'Fresh symbol gets strong positive news',
      sentiment: 'bullish',
      eventType: 'contract_win',
      importance: 0.85,
      eventTimestamp: now,
    },
    {
      sourceType: 'filing',
      sourceId: 'RFTEST-rank-fresh-2',
      symbol: 'RFTESTR1',
      title: 'Fresh symbol confirms in filing',
      sentiment: 'bullish',
      eventType: 'contract_win',
      importance: 0.9,
      eventTimestamp: now - 60_000,
    },
    {
      sourceType: 'news',
      sourceId: 'RFTEST-rank-stale',
      symbol: 'RFTESTR2',
      title: 'Older symbol had one bullish mention',
      sentiment: 'bullish',
      eventType: 'legacy_buzz',
      importance: 1,
      eventTimestamp: now - 6 * 24 * 60 * 60 * 1000,
    },
  ]);
  insertCandidate('RFTESTR1', 'BUY', 34, 81);

  const feed = getResearchFeed({ scope: 'sector', entity: 'Ranking Sector', hoursBack: 168 });
  assert.ok(feed.stories.length >= 2);
  assert.equal(feed.stories[0]?.topSymbol, 'RFTESTR1');
  assert.equal(feed.stories[0]?.actionable, true);
  assert.ok((feed.stories[0]?.storyScore ?? 0) > (feed.stories[1]?.storyScore ?? 0));
});

test('portfolioOnly filter limits stock entities to current holdings while preserving market context', () => {
  insertCompany('RFTESTP1', 'Portfolio Sector');
  insertCompany('RFTESTP2', 'Portfolio Sector');
  syncFromBroker({ cash: 95_000, positions: [{ symbol: 'RFTESTP1', shares: 10, avgPrice: 100 }] });

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: 'RFTEST-portfolio-market',
      symbol: 'MARKET',
      title: 'Market update remains visible',
      sentiment: 'neutral',
      eventType: 'macro_watch',
      importance: 0.5,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: 'RFTEST-portfolio-held',
      symbol: 'RFTESTP1',
      title: 'Held symbol gets coverage',
      sentiment: 'bullish',
      eventType: 'coverage',
      importance: 0.7,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: 'RFTEST-portfolio-not-held',
      symbol: 'RFTESTP2',
      title: 'Non-held symbol gets coverage',
      sentiment: 'bullish',
      eventType: 'coverage',
      importance: 0.7,
      eventTimestamp: Date.now(),
    },
  ]);

  const feed = getResearchFeed({ scope: 'stock', hoursBack: 72, portfolioOnly: true });
  assert.deepEqual(feed.entities.stocks.map(row => row.entity), ['RFTESTP1']);
  assert.equal(feed.entities.market.length, 1);
});
