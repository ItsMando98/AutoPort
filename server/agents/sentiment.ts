import {
  hasOpenForecast,
  saveAgentObservations,
  saveEventForecasts,
  saveSymbolTheses,
} from '../autonomy.js';
import { getOptionsFlow, getShortInterest, refreshSentimentData } from '../sentiment.js';
import { ALL_SYMBOLS } from '../universe.js';
import { BaseAgent } from './base.js';

export class SentimentAgent extends BaseAgent {
  readonly name = 'sentiment';
  readonly intervalMs = 2 * 60 * 60 * 1000;
  readonly sourceKey = 'sentiment_options';

  protected override get freshnessTtlMs(): number {
    return 4 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    const result = await refreshSentimentData();
    publishSentimentOutputs();
    this.markSuccess(result.optionsSaved + result.shortInterestSaved, result);
  }
}

function publishSentimentOutputs(now = Date.now()): void {
  const optionsRows = getOptionsFlow();
  const shortRows = getShortInterest();

  const latestOptions = new Map<string, any>();
  for (const row of optionsRows) {
    if (!latestOptions.has(row.symbol)) latestOptions.set(row.symbol, row);
  }
  const latestShort = new Map<string, any>();
  for (const row of shortRows) {
    if (!latestShort.has(row.symbol)) latestShort.set(row.symbol, row);
  }

  for (const symbol of ALL_SYMBOLS) {
    const options = latestOptions.get(symbol) ?? null;
    const short = latestShort.get(symbol) ?? null;
    const observations: any[] = [];

    if (options) {
      observations.push({
        agentName: 'sentiment',
        sourceKey: 'sentiment_options',
        symbol,
        topic: 'options_flow',
        observationType: 'put_call_ratio',
        value: options.put_call_volume_ratio,
        confidence: options.sentiment === 'neutral' ? 0.5 : 0.72,
        details: options,
        observedAt: Date.parse(`${options.observation_date}T00:00:00Z`),
        expiresAt: now + 4 * 60 * 60 * 1000,
      });
    }

    if (short) {
      observations.push({
        agentName: 'sentiment',
        sourceKey: 'sentiment_options',
        symbol,
        topic: 'short_interest',
        observationType: 'short_volume_ratio',
        value: short.short_volume_ratio,
        confidence: short.squeeze_risk === 'high' || short.trend === 'increasing' ? 0.75 : 0.5,
        details: short,
        observedAt: Date.parse(`${short.report_date}T00:00:00Z`),
        expiresAt: now + 10 * 24 * 60 * 60 * 1000,
      });
    }

    const observationIds = observations.length > 0 ? saveAgentObservations(observations) : [];

    const stance = deriveSentimentStance(options, short);
    const confidence = deriveSentimentConfidence(options, short);
    saveSymbolTheses([{
      agentName: 'sentiment',
      sourceKey: 'sentiment_options',
      symbol,
      stance,
      confidence,
      horizon: '3d',
      catalyst: short?.squeeze_risk === 'high'
        ? 'short_squeeze_setup'
        : options?.sentiment === 'bullish'
          ? 'heavy_call_buying'
          : options?.sentiment === 'bearish'
            ? 'heavy_put_buying'
            : 'neutral_sentiment',
      invalidation: 'Put/call ratio normalizes or short-interest trend reverses.',
      thesis: buildSentimentThesis(symbol, options, short, stance),
      supportingObservationIds: observationIds,
      freshnessScore: stance === 'HOLD' ? 0.65 : 0.8,
      createdAt: now,
      expiresAt: now + 4 * 60 * 60 * 1000,
    }]);

    if (stance === 'HOLD') continue;
    // Don't re-assert the same 3-day call every cycle (or on every process
    // restart) while the previous forecast for this symbol hasn't resolved yet.
    if (hasOpenForecast('sentiment_options', symbol, 'price_direction_3d')) continue;

    saveEventForecasts([{
      agentName: 'sentiment',
      sourceKey: 'sentiment_options',
      symbol,
      targetVariable: 'price_direction_3d',
      eventType: short?.squeeze_risk === 'high' ? 'squeeze_follow_through' : 'flow_follow_through',
      direction: stance === 'BUY' ? 'up' : 'down',
      probability: confidence,
      confidence,
      reasoning: buildSentimentThesis(symbol, options, short, stance),
      windowStartAt: now,
      windowEndAt: now + 3 * 24 * 60 * 60 * 1000,
    }]);
  }
}

function deriveSentimentStance(options: any, short: any): 'BUY' | 'SELL' | 'HOLD' {
  if (short?.squeeze_risk === 'high' && Number(short.short_volume_ratio) > 0.45) return 'BUY';
  if (options?.sentiment === 'bullish') return 'BUY';
  if (options?.sentiment === 'bearish') return 'SELL';
  if (short?.trend === 'increasing' && Number(short.short_volume_ratio) > 0.5) return 'SELL';
  return 'HOLD';
}

function deriveSentimentConfidence(options: any, short: any): number {
  if (!options && !short) return 0.5;
  if (short?.squeeze_risk === 'high') return 0.8;
  if (options?.sentiment === 'bullish') return 0.72;
  if (options?.sentiment === 'bearish') return 0.75;
  if (short?.trend === 'increasing' && Number(short.short_volume_ratio) > 0.5) return 0.68;
  return 0.5;
}

function buildSentimentThesis(symbol: string, options: any, short: any, stance: 'BUY' | 'SELL' | 'HOLD'): string {
  if (!options && !short) {
    return `${symbol} has no fresh options-flow or short-interest signal, so sentiment remains neutral.`;
  }
  const pieces = [
    options ? `PCR ${Number(options.put_call_volume_ratio).toFixed(2)}` : null,
    short ? `short ratio ${Number(short.short_volume_ratio).toFixed(2)} (${short.trend})` : null,
    short?.squeeze_risk ? `squeeze risk ${short.squeeze_risk}` : null,
  ].filter(Boolean);
  return `${symbol} ${stance === 'BUY' ? 'has bullish flow pressure' : stance === 'SELL' ? 'has bearish flow pressure' : 'is balanced'} with ${pieces.join(', ')}.`;
}
