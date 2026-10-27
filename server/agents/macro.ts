import {
  hasOpenMarketForecast,
  saveAgentObservations,
  saveMarketForecasts,
  saveSymbolTheses,
} from '../autonomy.js';
import { getLatestMacroRegime, getMacroIndicators, refreshMacroData } from '../macro.js';
import { ALL_SYMBOLS } from '../universe.js';
import { BaseAgent } from './base.js';

export class MacroAgent extends BaseAgent {
  readonly name = 'macro';
  readonly intervalMs = 60 * 60 * 1000;
  readonly sourceKey = 'macro_fred';

  protected override get freshnessTtlMs(): number {
    return 2 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    if (!process.env.FRED_API_KEY) {
      const regime = publishMacroOutputs();
      this.markSuccess(ALL_SYMBOLS.length, {
        configured: false,
        fallback: 'last_known_or_default_regime',
        regime: regime.regime,
      });
      return;
    }

    const result = await refreshMacroData();
    publishMacroOutputs();
    this.markSuccess(result.indicatorsSaved, result);
  }
}

function publishMacroOutputs(now = Date.now()) {
  const regime = getLatestMacroRegime();
  const indicators = getMacroIndicators(2);

  const observationIds = saveAgentObservations([
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol: 'MARKET',
      topic: 'regime',
      observationType: 'macro_regime',
      details: regime,
      observedAt: regime.computedAt ?? now,
      expiresAt: now + 2 * 60 * 60 * 1000,
    },
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol: 'MARKET',
      topic: 'volatility',
      observationType: 'vix_level',
      value: regime.vixLevel,
      details: indicators.VIXCLS?.[0] ?? null,
      observedAt: regime.computedAt ?? now,
      expiresAt: now + 2 * 60 * 60 * 1000,
    },
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol: 'MARKET',
      topic: 'rates',
      observationType: 'yield_curve',
      value: regime.yieldCurve,
      details: indicators.T10Y2Y?.[0] ?? null,
      observedAt: regime.computedAt ?? now,
      expiresAt: now + 2 * 60 * 60 * 1000,
    },
  ]);

  const stance = regime.regime === 'bull'
    ? 'BUY'
    : regime.regime === 'bear'
      ? 'SELL'
      : 'HOLD';
  const confidence = regime.regime === 'neutral' ? 0.55 : 0.78;

  const thesisSummary = regime.reasoning
    ? `Macro regime ${regime.regime}: ${regime.reasoning}.`
    : `Macro regime ${regime.regime}.`;
  const thesisExpiry = now + 2 * 60 * 60 * 1000;

  // Publish a market-level thesis (for market-wide queries)
  // AND per-symbol theses so portfolio committee can count macro_fred as a covered source
  saveSymbolTheses([
    {
      agentName: 'macro',
      sourceKey: 'macro_fred',
      symbol: 'MARKET',
      stance,
      confidence,
      horizon: '1w',
      catalyst: 'macro_regime',
      invalidation: 'Regime reclassification on new FRED observations.',
      thesis: thesisSummary,
      supportingObservationIds: observationIds,
      freshnessScore: 0.9,
      createdAt: regime.computedAt ?? now,
      expiresAt: thesisExpiry,
    },
    // Per-symbol macro context — lets the committee count macro as covered for each stock
    ...ALL_SYMBOLS.map(symbol => ({
      agentName: 'macro' as const,
      sourceKey: 'macro_fred',
      symbol,
      stance: stance as import('../autonomy.js').ThesisStance,
      // Slightly lower confidence for individual stocks — macro is market-wide context
      confidence: Math.max(confidence - 0.08, 0.45),
      horizon: '1w' as const,
      catalyst: 'macro_regime',
      invalidation: 'Regime reclassification on new FRED observations.',
      thesis: thesisSummary,
      supportingObservationIds: observationIds,
      freshnessScore: 0.9,
      createdAt: regime.computedAt ?? now,
      expiresAt: thesisExpiry,
    })),
  ]);

  // Don't re-assert the same 5-day market call every hour (or on every process
  // restart) while the previous forecast hasn't resolved yet.
  if (!hasOpenMarketForecast('macro_fred', 'market', 'market_direction_5d')) {
    saveMarketForecasts([{
      agentName: 'macro',
      sourceKey: 'macro_fred',
      scope: 'market',
      targetVariable: 'market_direction_5d',
      outcomeSymbol: 'SPY',
      direction: regime.regime === 'bull' ? 'up' : regime.regime === 'bear' ? 'down' : 'flat',
      probability: confidence,
      confidence,
      reasoning: regime.reasoning ?? `Macro regime ${regime.regime}.`,
      windowStartAt: now,
      windowEndAt: now + 5 * 24 * 60 * 60 * 1000,
      regime: regime.regime,
    }]);
  }

  return regime;
}
