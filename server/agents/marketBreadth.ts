import { hasOpenMarketForecast, saveAgentObservations, saveMarketForecasts } from '../autonomy.js';
import db from '../db.js';
import { getMarketSessionStatus } from '../marketclock.js';
import { markDataSourceFailure, markDataSourceSuccess } from '../ops.js';
import { BaseAgent } from './base.js';

const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export class MarketBreadthAgent extends BaseAgent {
  readonly name = 'market_breadth';
  readonly intervalMs = 30 * 60 * 1000;
  readonly sourceKey = 'market_breadth';

  async run(): Promise<void> {
    // Only run during market hours
    const market = getMarketSessionStatus();
    if (!market.isOpen) {
      this.markSuccess(0, { skipped: 'market_closed' });
      return;
    }

    try {
      const [advanceCount, declineCount] = await Promise.all([
        fetchQuoteValue('^ADVN'),
        fetchQuoteValue('^DECN'),
      ]);
      const [newHighs, newLows] = await Promise.all([
        fetchQuoteValue('^HIGHS'),
        fetchQuoteValue('^LOWS'),
      ]);

      const adRatio = advanceCount !== null && declineCount !== null && declineCount > 0
        ? advanceCount / declineCount
        : null;
      const hlRatio = newHighs !== null && newLows !== null && newLows > 0
        ? newHighs / newLows
        : null;

      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO market_breadth (observation_date, advance_count, decline_count, ad_ratio, new_highs, new_lows, hl_ratio)
        VALUES (@observation_date, @advance_count, @decline_count, @ad_ratio, @new_highs, @new_lows, @hl_ratio)
        ON CONFLICT(observation_date) DO UPDATE SET
          advance_count = excluded.advance_count,
          decline_count = excluded.decline_count,
          ad_ratio = excluded.ad_ratio,
          new_highs = excluded.new_highs,
          new_lows = excluded.new_lows,
          hl_ratio = excluded.hl_ratio,
          fetched_at = unixepoch()
      `).run({
        observation_date: today,
        advance_count: advanceCount,
        decline_count: declineCount,
        ad_ratio: adRatio,
        new_highs: newHighs,
        new_lows: newLows,
        hl_ratio: hlRatio,
      });

      const now = Date.now();
      const nowSec = Math.floor(now / 1000);
      const tomorrowSec = nowSec + 24 * 60 * 60;

      saveAgentObservations([{
        agentName: 'market_breadth',
        sourceKey: 'market_breadth',
        topic: 'market_breadth',
        observationType: 'breadth_snapshot',
        value: adRatio,
        confidence: 0.70,
        details: { adRatio, hlRatio, advanceCount, declineCount, newHighs, newLows, date: today },
        observedAt: now,
        expiresAt: now + 30 * 60 * 1000,
      }]);

      // Publish negative breadth forecast when A/D ratio < 0.5 — but don't
      // re-assert the same call every 30 minutes while breadth stays negative
      // and the previous forecast hasn't resolved yet.
      if (adRatio !== null && adRatio < 0.5 && !hasOpenMarketForecast('market_breadth', 'market', 'market_direction')) {
        saveMarketForecasts([{
          agentName: 'market_breadth',
          sourceKey: 'market_breadth',
          scope: 'market',
          targetVariable: 'market_direction',
          outcomeSymbol: 'SPY',
          direction: 'down',
          probability: Math.min(0.55 + (0.5 - adRatio) * 0.3, 0.75),
          confidence: 0.65,
          reasoning: `Negative market breadth: A/D ratio ${adRatio.toFixed(2)} (advances ${advanceCount}, declines ${declineCount}).`,
          windowStartAt: nowSec,
          windowEndAt: tomorrowSec,
          regime: 'breadth_negative',
        }]);
      }

      markDataSourceSuccess('market_breadth', 1, { adRatio, hlRatio });
      this.markSuccess(1, { adRatio, hlRatio });
    } catch (err: any) {
      markDataSourceFailure('market_breadth', err?.message ?? 'Unknown error');
      this.markFailure(err?.message ?? 'Unknown error');
    }
  }
}

export function getMarketBreadthHistory(limit = 30): any[] {
  return db.prepare(`
    SELECT observation_date, advance_count, decline_count, ad_ratio, new_highs, new_lows, hl_ratio, fetched_at
    FROM market_breadth
    ORDER BY observation_date DESC
    LIMIT ?
  `).all(Math.min(limit, 90));
}

async function fetchQuoteValue(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}
