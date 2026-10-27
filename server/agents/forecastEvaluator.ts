import { getCalibrationSummary, resolveForecastOutcomes } from '../autonomy.js';
import db from '../db.js';
import { BaseAgent } from './base.js';

export class ForecastEvaluatorAgent extends BaseAgent {
  readonly name = 'forecast_evaluator';
  readonly intervalMs = 15 * 60 * 1000;
  readonly sourceKey = 'forecast_evaluator';

  private lastHitRates = new Map<string, number>();

  async run(): Promise<void> {
    const { resolved, expired } = resolveForecastOutcomes();

    if (resolved === 0 && expired === 0) {
      this.markSuccess(0, { resolved, expired });
      return;
    }

    const summary = getCalibrationSummary();
    const now = Math.floor(Date.now() / 1000);
    const upsert = db.prepare(`
      INSERT INTO agent_calibration_weights (source_key, weight, hit_rate, brier_score, sample_size, last_computed_at, updated_at)
      VALUES (@source_key, @weight, @hit_rate, @brier_score, @sample_size, @now, @now)
      ON CONFLICT(source_key) DO UPDATE SET
        weight = excluded.weight,
        hit_rate = excluded.hit_rate,
        brier_score = excluded.brier_score,
        sample_size = excluded.sample_size,
        last_computed_at = excluded.last_computed_at,
        updated_at = excluded.updated_at
    `);

    const upsertMany = db.transaction((rows: typeof summary.bySource) => {
      for (const row of rows) {
        upsert.run({
          source_key: row.sourceKey,
          weight: row.weight,
          hit_rate: row.hitRate,
          brier_score: row.brierScore,
          sample_size: row.sampleSize,
          now,
        });

        // Log when any agent's hit rate shifts by more than 2%
        const prevRate = this.lastHitRates.get(row.sourceKey);
        if (prevRate !== undefined && row.hitRate !== null) {
          const shift = Math.abs(row.hitRate - prevRate);
          if (shift >= 0.02) {
            db.prepare(`
              INSERT INTO engine_logs (id, timestamp, log_type, asset, content, action, status)
              VALUES (hex(randomblob(16)), ?, 'MONITOR', 'calibration', ?, ?, 'COMPLETED')
            `).run(
              Date.now(),
              `${row.sourceKey} hit rate shifted from ${(prevRate * 100).toFixed(1)}% to ${(row.hitRate * 100).toFixed(1)}% (n=${row.sampleSize})`,
              'calibration_shift',
            );
          }
        }
        if (row.hitRate !== null) {
          this.lastHitRates.set(row.sourceKey, row.hitRate);
        }
      }
    });

    upsertMany(summary.bySource);
    this.markSuccess(summary.bySource.length, { resolved, expired });
  }
}
