import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { saveResearchEvents } from '../server/research.js';
import {
  getThemeDetail,
  refreshThemeLab,
  rebuildTheme,
} from '../server/themes.js';

const TEST_SOURCE_PREFIX = 'THMTEST';
const TEST_DATE = '2099-01-01';

function cleanup(): void {
  db.prepare(`DELETE FROM theme_attribution`).run();
  db.prepare(`DELETE FROM theme_snapshots`).run();
  db.prepare(`DELETE FROM theme_sleeve_members`).run();
  db.prepare(`DELETE FROM theme_sleeves`).run();
  db.prepare(`DELETE FROM theme_research_briefs`).run();
  db.prepare(`DELETE FROM theme_benchmarks`).run();
  db.prepare(`DELETE FROM theme_discoveries`).run();
  db.prepare(`DELETE FROM theme_definitions`).run();
  db.prepare(`DELETE FROM agent_observations WHERE source_key LIKE 'theme_%'`).run();
  db.prepare(`DELETE FROM market_forecasts WHERE source_key LIKE 'theme_%'`).run();
  db.prepare(`DELETE FROM symbol_theses WHERE source_key LIKE 'theme_%'`).run();
  db.prepare(`DELETE FROM research_events WHERE source_id LIKE ?`).run(`${TEST_SOURCE_PREFIX}%`);
  db.prepare(`DELETE FROM price_history WHERE date = ? AND symbol IN ('NVDA', 'AMD', 'MSFT', 'QQQ', 'IBIT', 'COIN', 'MSTR')`).run(TEST_DATE);
}

function seedPrice(symbol: string, close: number): void {
  db.prepare(`
    INSERT INTO price_history (symbol, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, 1000000)
    ON CONFLICT(symbol, date) DO UPDATE SET
      close = excluded.close
  `).run(symbol, TEST_DATE, close, close, close, close);
}

test.beforeEach(cleanup);
test.after(cleanup);

test('theme refresh builds valid sleeves with benchmark mappings and normalized weights', async () => {
  seedPrice('NVDA', 100);
  seedPrice('AMD', 90);
  seedPrice('MSFT', 110);
  seedPrice('QQQ', 400);

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-ai-1`,
      symbol: 'NVDA',
      title: 'AI infrastructure spending accelerates across hyperscalers',
      sentiment: 'bullish',
      eventType: 'ai_capex',
      importance: 0.9,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'filing',
      sourceId: `${TEST_SOURCE_PREFIX}-ai-2`,
      symbol: 'AMD',
      title: 'Accelerator demand supports next AI deployment cycle',
      sentiment: 'bullish',
      eventType: 'accelerator_demand',
      importance: 0.85,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-ai-3`,
      symbol: 'MSFT',
      title: 'Cloud and data center AI expansion remains strong',
      sentiment: 'bullish',
      eventType: 'cloud_ai',
      importance: 0.8,
      eventTimestamp: Date.now(),
    },
  ]);

  const result = await refreshThemeLab({ now: Date.parse('2026-03-13T10:00:00Z'), useLivePrices: false });
  assert.ok(result.overview.activeThemeCount > 0);
  assert.ok(result.overview.activeThemeCount <= 10);

  const detail = getThemeDetail('ai-infrastructure');
  assert.ok(detail.theme);
  assert.equal(detail.benchmark?.symbol, 'QQQ');
  assert.ok(detail.sleeve);
  assert.ok((detail.sleeve?.members.length ?? 0) >= 3);
  const weightSum = detail.sleeve?.members.reduce((sum, member) => sum + member.weight, 0) ?? 0;
  assert.ok(Math.abs(weightSum - 1) < 0.00001);
});

test('theme validation excludes unresolved external symbols from published sleeves', async () => {
  seedPrice('COIN', 200);
  seedPrice('IBIT', 50);
  seedPrice('MSTR', 300);

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-crypto-1`,
      symbol: 'COIN',
      title: 'Bitcoin ETF inflows accelerate digital asset adoption',
      sentiment: 'bullish',
      eventType: 'bitcoin_etf',
      importance: 0.9,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-crypto-2`,
      symbol: 'ZZZUNKNOWN',
      title: 'Unknown blockchain operator claims major growth in crypto adoption',
      sentiment: 'bullish',
      eventType: 'blockchain_growth',
      importance: 1,
      eventTimestamp: Date.now(),
    },
  ]);

  await refreshThemeLab({ now: Date.parse('2026-03-13T12:00:00Z'), useLivePrices: false });
  const detail = getThemeDetail('digital-assets');
  assert.ok(detail.sleeve);
  assert.equal(detail.sleeve?.members.some(member => member.symbol === 'ZZZUNKNOWN'), false);
});

test('rebuild creates a new sleeve version and appends performance history', async () => {
  seedPrice('NVDA', 100);
  seedPrice('AMD', 90);
  seedPrice('MSFT', 110);
  seedPrice('QQQ', 400);

  saveResearchEvents([
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-rebuild-1`,
      symbol: 'NVDA',
      title: 'AI accelerator demand remains broad and persistent',
      sentiment: 'bullish',
      eventType: 'ai_demand',
      importance: 0.92,
      eventTimestamp: Date.now(),
    },
    {
      sourceType: 'news',
      sourceId: `${TEST_SOURCE_PREFIX}-rebuild-2`,
      symbol: 'AMD',
      title: 'Semiconductor and AI inference orders stay strong',
      sentiment: 'bullish',
      eventType: 'semiconductor_demand',
      importance: 0.88,
      eventTimestamp: Date.now(),
    },
  ]);

  await refreshThemeLab({ now: Date.parse('2026-03-13T09:00:00Z'), useLivePrices: false });
  const before = getThemeDetail('ai-infrastructure');
  assert.ok(before.sleeve);

  await rebuildTheme('ai-infrastructure', { now: Date.parse('2026-03-14T09:00:00Z'), useLivePrices: false });
  const after = getThemeDetail('ai-infrastructure');
  assert.ok(after.sleeve);
  assert.ok((after.sleeve?.version ?? 0) > (before.sleeve?.version ?? 0));
  assert.ok(after.history.length >= 2);
  assert.ok(after.attribution.length > 0);
});
