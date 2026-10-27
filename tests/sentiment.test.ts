import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { aggregateRegshoRows, emitOptionsFlowEvents, emitShortInterestEvents } from '../server/sentiment.js';

test('Reg SHO aggregation computes short-volume ratios by symbol', () => {
  const rows = aggregateRegshoRows([
    'Date\tSymbol\tShortVolume\tShortExemptVolume\tTotalVolume\tMarket',
    '20260301\tAAPL\t450\t0\t900\tNMS',
    '20260301\tAAPL\t150\t0\t300\tNMS',
    '20260301\tMSFT\t100\t0\t500\tNMS',
  ].join('\n'));

  const aapl = rows.find(row => row.symbol === 'AAPL');
  assert.equal(aapl?.shortVolume, 600);
  assert.equal(aapl?.shortVolumeRatio, 0.5);
});

test('options flow emission creates heavy call and heavy put research events', () => {
  db.prepare(`DELETE FROM research_events WHERE source_type = 'options_flow'`).run();

  const saved = emitOptionsFlowEvents([
    { symbol: 'AAPL', observation_date: '2026-03-12', put_call_volume_ratio: 0.4, put_call_oi_ratio: 0.6 },
    { symbol: 'MSFT', observation_date: '2026-03-12', put_call_volume_ratio: 1.8, put_call_oi_ratio: 1.4 },
  ]);

  const rows = db.prepare(`
    SELECT symbol, event_type
    FROM research_events
    WHERE source_type = 'options_flow'
    ORDER BY symbol ASC
  `).all() as any[];

  assert.equal(saved, 2);
  assert.deepEqual(rows.map(row => row.event_type), ['heavy_call_buying', 'heavy_put_buying']);
});

test('short interest emission creates squeeze and short buildup events', () => {
  db.prepare(`DELETE FROM research_events WHERE source_type = 'short_interest'`).run();
  db.prepare(`DELETE FROM short_interest WHERE report_date = '2026-03-01'`).run();

  db.prepare(`
    INSERT INTO short_interest
      (symbol, report_date, short_volume, total_volume, short_volume_ratio, prior_ratio, trend, squeeze_risk)
    VALUES
      ('AAPL', '2026-03-01', 450, 900, 0.50, 0.40, 'increasing', 'high'),
      ('MSFT', '2026-03-01', 550, 1000, 0.55, 0.45, 'increasing', 'moderate')
  `).run();

  const saved = emitShortInterestEvents('2026-03-01');
  const rows = db.prepare(`
    SELECT symbol, event_type
    FROM research_events
    WHERE source_type = 'short_interest'
    ORDER BY symbol ASC
  `).all() as any[];

  assert.equal(saved, 2);
  assert.deepEqual(rows.map(row => row.event_type), ['short_squeeze_setup', 'short_buildup']);
});
