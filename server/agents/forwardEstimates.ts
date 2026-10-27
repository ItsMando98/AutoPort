import { saveSymbolTheses } from '../autonomy.js';
import db from '../db.js';
import { markDataSourceSuccess } from '../ops.js';
import { WATCHLIST } from '../technicals.js';
import { BaseAgent } from './base.js';

const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export class ForwardEstimatesAgent extends BaseAgent {
  readonly name = 'forward_estimates';
  readonly intervalMs = 24 * 60 * 60 * 1000;
  readonly sourceKey = 'forward_estimates';

  async run(): Promise<void> {
    let updated = 0;
    for (const symbol of WATCHLIST) {
      try {
        await this.fetchAndUpsert(symbol);
        updated += 1;
        await sleep(400);
      } catch {
        // Non-fatal per symbol
      }
    }

    markDataSourceSuccess('forward_estimates', updated, { symbols: updated });
    this.markSuccess(updated, { symbols: updated });
  }

  private async fetchAndUpsert(symbol: string): Promise<void> {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return;

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return;

    const stats = result.defaultKeyStatistics ?? {};
    const finData = result.financialData ?? {};

    const forwardPE: number | null = stats.forwardPE?.raw ?? null;
    const pegRatio: number | null = stats.pegRatio?.raw ?? null;
    const epsForward: number | null = stats.forwardEps?.raw ?? null;
    const recommendationMean: number | null = finData.recommendationMean?.raw ?? null;
    const numberOfAnalystOpinions: number | null = finData.numberOfAnalystOpinions?.raw ?? null;
    const targetMeanPrice: number | null = finData.targetMeanPrice?.raw ?? null;

    db.prepare(`
      INSERT INTO fundamentals (symbol, forward_pe, peg_ratio, eps_forward, recommendation_mean, analyst_count, analyst_target_price, updated_at)
      VALUES (@symbol, @forward_pe, @peg_ratio, @eps_forward, @recommendation_mean, @analyst_count, @analyst_target_price, unixepoch())
      ON CONFLICT(symbol) DO UPDATE SET
        forward_pe = excluded.forward_pe,
        peg_ratio = excluded.peg_ratio,
        eps_forward = excluded.eps_forward,
        recommendation_mean = excluded.recommendation_mean,
        analyst_count = excluded.analyst_count,
        analyst_target_price = excluded.analyst_target_price,
        updated_at = unixepoch()
    `).run({
      symbol,
      forward_pe: forwardPE,
      peg_ratio: pegRatio,
      eps_forward: epsForward,
      recommendation_mean: recommendationMean,
      analyst_count: numberOfAnalystOpinions,
      analyst_target_price: targetMeanPrice,
    });

    // Publish thesis based on analyst consensus
    if (recommendationMean !== null) {
      const analystCount = numberOfAnalystOpinions ?? 0;
      const baseConf = recommendationMean <= 2.0 ? 0.65 : recommendationMean >= 3.8 ? 0.60 : 0;
      if (baseConf === 0) return;

      // Scale confidence by analyst count (more = higher, cap 0.78)
      const scaledConf = Math.min(baseConf + (Math.min(analystCount, 30) / 30) * 0.13, 0.78);
      const stance = recommendationMean <= 2.0 ? 'BUY' as const : 'SELL' as const;

      saveSymbolTheses([{
        agentName: 'forward_estimates',
        sourceKey: 'forward_estimates',
        symbol,
        stance,
        confidence: scaledConf,
        horizon: '3m',
        catalyst: 'analyst_consensus',
        invalidation: 'Analyst consensus shifts or new earnings guidance.',
        thesis: `${symbol} analyst consensus: mean rating ${recommendationMean.toFixed(1)}/5.0 (${analystCount} analysts)${targetMeanPrice ? `, target $${targetMeanPrice.toFixed(0)}` : ''}${forwardPE ? `, fwd P/E ${forwardPE.toFixed(1)}` : ''}${pegRatio ? `, PEG ${pegRatio.toFixed(2)}` : ''}.`,
        freshnessScore: 0.70,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }]);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
