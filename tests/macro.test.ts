import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { classifyMacroRegime, emitMacroResearchEvents } from '../server/macro.js';

test('macro regime classification follows deterministic VIX and yield curve rules', () => {
  assert.equal(classifyMacroRegime({
    fedFunds: 4.5,
    unemployment: 4.1,
    cpiYoY: 2.7,
    yieldCurve: -0.7,
    vixLevel: 22,
  }), 'bear');

  assert.equal(classifyMacroRegime({
    fedFunds: 4.0,
    unemployment: 4.0,
    cpiYoY: 2.4,
    yieldCurve: 0.5,
    vixLevel: 15,
  }), 'bull');
});

test('macro event emission records threshold-crossing research events', () => {
  db.prepare(`DELETE FROM research_events WHERE source_id LIKE 'macro:%'`).run();

  const eventsSaved = emitMacroResearchEvents(new Map([
    ['VIXCLS', [{ date: '2026-03-12', value: 27 }, { date: '2026-03-11', value: 22 }]],
    ['T10Y2Y', [{ date: '2026-03-12', value: -0.1 }, { date: '2026-03-11', value: 0.2 }]],
    ['CPIAUCSL', [
      { date: '2026-02-01', value: 320 },
      { date: '2026-01-01', value: 318 },
      { date: '2025-02-01', value: 300 },
      { date: '2025-01-01', value: 301 },
    ]],
  ]), new Date('2026-03-17T12:00:00Z'));

  const rows = db.prepare(`
    SELECT source_id, event_type
    FROM research_events
    WHERE source_id LIKE 'macro:%'
    ORDER BY source_id ASC
  `).all() as any[];

  assert.equal(eventsSaved >= 3, true);
  assert.ok(rows.some(row => row.event_type === 'volatility_spike'));
  assert.ok(rows.some(row => row.event_type === 'yield_curve_inversion'));
  assert.ok(rows.some(row => row.event_type === 'fed_decision'));
});
