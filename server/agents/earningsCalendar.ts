import { saveSymbolTheses } from '../autonomy.js';
import db from '../db.js';
import { markDataSourceFailure, markDataSourceSuccess } from '../ops.js';
import { getCachedPrices } from '../marketdata.js';
import { WATCHLIST } from '../technicals.js';
import { BaseAgent } from './base.js';

const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export class EarningsCalendarAgent extends BaseAgent {
  readonly name = 'earnings_calendar';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'earnings_calendar';

  async run(): Promise<void> {
    let upserted = 0;
    for (const symbol of WATCHLIST) {
      try {
        await this.fetchAndUpsertEarnings(symbol);
        upserted += 1;
        // Gentle rate limit
        await sleep(300);
      } catch {
        // Non-fatal per symbol
      }
    }

    // Post-earnings drift: symbols with earnings in last 1–3 days
    this.publishPostEarningsDriftTheses();

    markDataSourceSuccess('earnings_calendar', upserted, { symbols: upserted });
    this.markSuccess(upserted, { symbols: upserted });
  }

  private async fetchAndUpsertEarnings(symbol: string): Promise<void> {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return;

    const data = await res.json();
    const calEvents = data?.quoteSummary?.result?.[0]?.calendarEvents;
    if (!calEvents) return;

    const earningsDates: number[] = calEvents?.earnings?.earningsDate ?? [];
    const epsEstimate: number | null = calEvents?.earnings?.epsEstimate?.raw ?? null;
    const revenueEstimate: number | null = calEvents?.earnings?.revenueEstimate?.raw ?? null;

    for (const rawDate of earningsDates) {
      if (!rawDate) continue;
      try {
        db.prepare(`
          INSERT INTO earnings_calendar (symbol, earnings_date, eps_estimate, revenue_estimate, confirmed)
          VALUES (@symbol, @earnings_date, @eps_estimate, @revenue_estimate, 1)
          ON CONFLICT(symbol, earnings_date) DO UPDATE SET
            eps_estimate = excluded.eps_estimate,
            revenue_estimate = excluded.revenue_estimate,
            confirmed = 1
        `).run({
          symbol,
          earnings_date: rawDate,
          eps_estimate: epsEstimate,
          revenue_estimate: revenueEstimate,
        });
      } catch {
        // Non-fatal
      }
    }
  }

  private publishPostEarningsDriftTheses(): void {
    const prices = getCachedPrices();
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);

    const recentEarnings = db.prepare(`
      SELECT symbol, earnings_date, eps_estimate
      FROM earnings_calendar
      WHERE confirmed = 1
        AND earnings_date >= @three_days_ago
        AND earnings_date <= @now
    `).all({ three_days_ago: threeDaysAgo, now }) as Array<{
      symbol: string;
      earnings_date: number;
      eps_estimate: number | null;
    }>;

    for (const row of recentEarnings) {
      const price = prices[row.symbol];
      if (!price) continue;

      // Get price at earnings date to determine gap direction
      const earningsDateStr = new Date(row.earnings_date * 1000).toISOString().split('T')[0];
      const priceOnEarnings = db.prepare(`
        SELECT close FROM price_history
        WHERE symbol = ? AND date <= ?
        ORDER BY date DESC LIMIT 1
      `).get(row.symbol, earningsDateStr) as { close: number } | undefined;

      if (!priceOnEarnings) continue;

      const gapPct = (price - priceOnEarnings.close) / priceOnEarnings.close;
      // BUY if gap held (stock is up from earnings), SELL if gap faded (stock reversed)
      const stance = gapPct > 0 ? 'BUY' as const : 'SELL' as const;
      const confidence = Math.min(0.55 + Math.abs(gapPct) * 2, 0.78);

      saveSymbolTheses([{
        agentName: 'earnings_calendar',
        sourceKey: 'earnings_calendar',
        symbol: row.symbol,
        stance,
        confidence,
        horizon: '1w',
        catalyst: 'post_earnings_drift',
        invalidation: 'Earnings drift reversal or broader market selloff.',
        thesis: `${row.symbol} post-earnings drift: ${gapPct >= 0 ? '+' : ''}${(gapPct * 100).toFixed(1)}% from earnings date ${earningsDateStr}.${row.eps_estimate ? ` EPS est $${row.eps_estimate.toFixed(2)}.` : ''}`,
        freshnessScore: 0.80,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }]);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
