/**
 * Replay Backtest Engine
 *
 * Replays stored research events against historical price history using the same
 * candidate composition and sizing rules as the live agent.
 */

import db from './db.js';
import { evaluateExecutionSizingPolicy, evaluatePortfolioConstructionPolicy } from './executionPolicy.js';
import { scoreResearchEvents, type ResearchEvent } from './research.js';
import { composeSignalCandidate, determineOrderPlan } from './strategy.js';
import { calculateEMA, calculateRSI } from './technicals.js';

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  startingCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  maxPositions: number;
  rsiOversold: number;
  rsiOverbought: number;
  minVolumeRatioForBreakout: number;
  researchWindowHours?: number;
  minCandidateConfidence?: number;
  spreadBps?: number;
  slippageBps?: number;
}

export interface BacktestTrade {
  date: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  totalValue: number;
  reason: string;
  pnl?: number;
  returnPct?: number;
  holdDays?: number;
}

export interface BacktestDayValue {
  date: string;
  value: number;
  spyValue: number;
  returnPct: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  spyReturn: number;
  alpha: number;
  sharpe: number | null;
  maxDrawdown: number;
  winRate: number | null;
  profitFactor: number | null;
  totalTrades: number;
  avgHoldDays: number | null;
  bestTrade: { symbol: string; returnPct: number } | null;
  worstTrade: { symbol: string; returnPct: number } | null;
}

export interface ReplayDiagnostics {
  actionableCandidates: number;
  neutralOrLowConfidence: number;
  dataUnavailable: number;
  blockedByPositionLimit: number;
  blockedByNoPosition: number;
  blockedBySizing: number;
  executedBuys: number;
  executedSells: number;
  stopLossExits: number;
  eventsDeferred: number;
  modeledCosts: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  dailyValues: BacktestDayValue[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  symbolsCovered: number;
  tradingDays: number;
  researchEventsCovered: number;
  candidateCount: number;
  diagnostics: ReplayDiagnostics;
  mode: 'research_replay';
  runDurationMs: number;
}

interface DayPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SimPosition {
  shares: number;
  avgPrice: number;
  entryDate: string;
  entryIndex: number;
}

interface PendingIntent {
  symbol: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  reasoning: string;
  decisionDate: string;
}

type SymbolPrices = Record<string, DayPrice[]>;

export function runBacktest(config: BacktestConfig): BacktestResult {
  const startMs = Date.now();
  const researchWindowHours = config.researchWindowHours ?? 72;
  const minCandidateConfidence = config.minCandidateConfidence ?? 55;

  const allAvailable = (db.prepare(
    'SELECT DISTINCT symbol FROM price_history ORDER BY symbol'
  ).all() as any[]).map(row => row.symbol).filter((symbol: string) => symbol !== 'SPY');
  const priceData = loadPriceData([...allAvailable, 'SPY'], config.startDate, config.endDate);
  const tradingSymbols = allAvailable.filter(symbol => priceData[symbol]?.length >= 25);
  const tradingDays = getTradingDays(priceData, config.startDate, config.endDate);
  const researchEvents = loadResearchEvents(config.startDate, config.endDate);

  const symbolDateIdx = buildDateIndex(tradingSymbols, priceData);
  const spyPrices = priceData.SPY ?? [];
  const spyStart = spyPrices.find(price => price.date >= config.startDate)?.close ?? config.startingCapital;
  const diagnostics: ReplayDiagnostics = {
    actionableCandidates: 0,
    neutralOrLowConfidence: 0,
    dataUnavailable: 0,
    blockedByPositionLimit: 0,
    blockedByNoPosition: 0,
    blockedBySizing: 0,
    executedBuys: 0,
    executedSells: 0,
    stopLossExits: 0,
    eventsDeferred: 0,
    modeledCosts: 0,
  };

  let cash = config.startingCapital;
  const positions: Record<string, SimPosition> = {};
  const trades: BacktestTrade[] = [];
  const dailyValues: BacktestDayValue[] = [];
  const pendingIntents = new Map<string, PendingIntent>();
  const pendingStopLosses = new Set<string>();
  const consumedEventIds = new Set<string>();
  const deferredEventIds = new Set<string>();
  let candidateCount = 0;

  for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
    const date = tradingDays[dayIdx];

    // Signals and close-based risk observations from D are executable no earlier
    // than the next available symbol bar. Stop-loss exits take precedence.
    for (const symbol of [...pendingStopLosses]) {
      const position = positions[symbol];
      const row = getExactPriceAtDate(priceData[symbol], date);
      if (!position || !row) continue;
      const executionPrice = applyExecutionCosts(row.open, 'SELL', config);
      const modeledCost = Math.max(0, (row.open - executionPrice) * position.shares);
      const pnlPct = (executionPrice - position.avgPrice) / position.avgPrice;
      const pnl = (executionPrice - position.avgPrice) * position.shares;
      cash += executionPrice * position.shares;
      diagnostics.modeledCosts += modeledCost;
      diagnostics.stopLossExits++;
      trades.push({
        date,
        symbol,
        action: 'SELL',
        shares: position.shares,
        price: executionPrice,
        totalValue: round(executionPrice * position.shares),
        reason: `Stop-loss observed at prior close`,
        pnl: round(pnl),
        returnPct: round(pnlPct * 100),
        holdDays: dayIdx - position.entryIndex,
      });
      delete positions[symbol];
      pendingStopLosses.delete(symbol);
      pendingIntents.delete(symbol);
    }

    for (const [symbol, intent] of [...pendingIntents.entries()]) {
      const row = getExactPriceAtDate(priceData[symbol], date);
      if (!row) continue;
      const executionPrice = applyExecutionCosts(row.open, intent.action, config);
      const portfolioValue = cash + getPositionsValue(positions, priceData, date);

      if (intent.action === 'BUY') {
        if (positions[symbol] || Object.keys(positions).length >= config.maxPositions) {
          diagnostics.blockedByPositionLimit++;
          pendingIntents.delete(symbol);
          continue;
        }
        const constructionPolicy = evaluatePortfolioConstructionPolicy({
          symbol,
          action: 'BUY',
          mode: 'paper',
          degradationSeverity: 'none',
          refreshProfiles: false,
        });
        const plan = determineOrderPlan('BUY', intent.confidence, symbol, executionPrice, {
          cash,
          positions: Object.entries(positions).map(([positionSymbol, position]) => ({
            symbol: positionSymbol,
            shares: position.shares,
          })),
        }, portfolioValue, {
          targetWeightMultiplier: constructionPolicy.targetWeightMultiplier,
          executionFeedbackBand: constructionPolicy.band,
          executionFeedbackReason: constructionPolicy.reason,
        });
        const sizingPolicy = evaluateExecutionSizingPolicy({
          symbol,
          action: 'BUY',
          mode: 'paper',
          degradationSeverity: 'none',
          refreshProfiles: false,
        });
        const configuredCapShares = Math.floor((portfolioValue * config.positionSizePct) / executionPrice);
        plan.shares = sizingPolicy.blocked
          ? 0
          : Math.min(configuredCapShares, Math.floor(plan.shares * sizingPolicy.multiplier));
        const cost = plan.shares * executionPrice;
        if (plan.shares <= 0 || cash < cost) {
          diagnostics.blockedBySizing++;
          pendingIntents.delete(symbol);
          continue;
        }
        cash -= cost;
        diagnostics.modeledCosts += Math.max(0, (executionPrice - row.open) * plan.shares);
        positions[symbol] = { shares: plan.shares, avgPrice: executionPrice, entryDate: date, entryIndex: dayIdx };
        trades.push({
          date,
          symbol,
          action: 'BUY',
          shares: plan.shares,
          price: executionPrice,
          totalValue: round(cost),
          reason: `${intent.reasoning} (decided ${intent.decisionDate})`,
        });
        diagnostics.executedBuys++;
      } else if (positions[symbol]) {
        const position = positions[symbol];
        const plan = determineOrderPlan('SELL', intent.confidence, symbol, executionPrice, {
          cash,
          positions: Object.entries(positions).map(([positionSymbol, value]) => ({
            symbol: positionSymbol,
            shares: value.shares,
          })),
        }, portfolioValue);
        const sizingPolicy = evaluateExecutionSizingPolicy({
          symbol,
          action: 'SELL',
          mode: 'paper',
          degradationSeverity: 'none',
          refreshProfiles: false,
        });
        plan.shares = sizingPolicy.blocked ? 0 : Math.max(0, Math.floor(plan.shares * sizingPolicy.multiplier));
        const sharesToSell = Math.min(plan.shares, position.shares);
        if (sharesToSell <= 0) {
          diagnostics.blockedBySizing++;
          pendingIntents.delete(symbol);
          continue;
        }
        const pnl = (executionPrice - position.avgPrice) * sharesToSell;
        cash += sharesToSell * executionPrice;
        diagnostics.modeledCosts += Math.max(0, (row.open - executionPrice) * sharesToSell);
        trades.push({
          date,
          symbol,
          action: 'SELL',
          shares: sharesToSell,
          price: executionPrice,
          totalValue: round(sharesToSell * executionPrice),
          reason: `${intent.reasoning} (decided ${intent.decisionDate})`,
          pnl: round(pnl),
          returnPct: round(((executionPrice - position.avgPrice) / position.avgPrice) * 100),
          holdDays: dayIdx - position.entryIndex,
        });
        position.shares -= sharesToSell;
        if (position.shares <= 0) delete positions[symbol];
        diagnostics.executedSells++;
      } else {
        diagnostics.blockedByNoPosition++;
      }
      pendingIntents.delete(symbol);
    }

    for (const [symbol, position] of Object.entries(positions)) {
      const row = getExactPriceAtDate(priceData[symbol], date);
      if (!row) continue;
      const pnlPct = (row.close - position.avgPrice) / position.avgPrice;
      if (pnlPct <= config.stopLossPct) {
        pendingStopLosses.add(symbol);
      }
    }

    const decisionCutoff = Date.parse(`${date}T23:59:59Z`);
    const recentEvents = getRecentEventsForDate(researchEvents, date, researchWindowHours)
      .filter(event => !consumedEventIds.has(event.id));
    for (const event of researchEvents) {
      if (event.eventTimestamp <= decisionCutoff && getEventAvailabilityTimestamp(event) > decisionCutoff) {
        deferredEventIds.add(event.id);
      }
    }
    const bySymbol = groupBySymbol(recentEvents);

    for (const [symbol, events] of bySymbol.entries()) {
      const priceIdx = symbolDateIdx[symbol]?.[date];
      const prices = priceData[symbol];
      events.forEach(event => consumedEventIds.add(event.id));
      if (!prices || priceIdx === undefined || priceIdx < 20) {
        diagnostics.dataUnavailable++;
        continue;
      }

      const researchScore = scoreResearchEvents(events);
      const technicalFactors = getHistoricalTechnicalFactors(
        prices,
        priceIdx,
        researchScore.direction,
        config.rsiOversold,
        config.rsiOverbought,
        config.minVolumeRatioForBreakout,
      );
      const candidate = composeSignalCandidate({
        symbol,
        sourceEventIds: events.map(event => event.id),
        notes: [researchScore.reasoning, ...technicalFactors.notes],
        factors: { research: researchScore.score, ...technicalFactors.breakdown },
      });

      if (candidate.action === 'HOLD' || candidate.confidence < minCandidateConfidence) {
        diagnostics.neutralOrLowConfidence++;
        continue;
      }
      candidateCount++;
      diagnostics.actionableCandidates++;
      pendingIntents.set(symbol, {
        symbol,
        action: candidate.action,
        confidence: candidate.confidence,
        reasoning: candidate.reasoning,
        decisionDate: date,
      });
    }

    diagnostics.eventsDeferred = deferredEventIds.size;
    diagnostics.modeledCosts = round(diagnostics.modeledCosts);

    const total = cash + getPositionsValue(positions, priceData, date);
    const spyRow = spyPrices.filter(price => price.date <= date).pop();
    const spyValue = spyStart > 0 && spyRow
      ? (spyRow.close / spyStart) * config.startingCapital
      : config.startingCapital;

    dailyValues.push({
      date,
      value: round(total),
      spyValue: round(spyValue),
      returnPct: round(((total - config.startingCapital) / config.startingCapital) * 100),
    });
  }

  return {
    config,
    dailyValues,
    trades,
    metrics: computeMetrics(config, trades, dailyValues),
    symbolsCovered: tradingSymbols.length,
    tradingDays: tradingDays.length,
    researchEventsCovered: researchEvents.length,
    candidateCount,
    diagnostics,
    mode: 'research_replay',
    runDurationMs: Date.now() - startMs,
  };
}

function loadPriceData(symbols: string[], startDate: string, endDate: string): SymbolPrices {
  const warmupDate = (() => {
    const date = new Date(startDate);
    date.setDate(date.getDate() - 120);
    return date.toISOString().split('T')[0];
  })();

  const result: SymbolPrices = {};
  for (const symbol of symbols) {
    const rows = db.prepare(`
      SELECT date, open, high, low, close, volume
      FROM price_history
      WHERE symbol = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(symbol, warmupDate, endDate) as DayPrice[];
    if (rows.length >= 20) result[symbol] = rows;
  }
  return result;
}

function loadResearchEvents(startDate: string, endDate: string): ResearchEvent[] {
  const start = Date.parse(`${startDate}T00:00:00Z`) / 1000;
  const end = Date.parse(`${endDate}T23:59:59Z`) / 1000;
  return (db.prepare(`
    SELECT * FROM research_events
    WHERE event_timestamp >= ? AND event_timestamp <= ?
    ORDER BY event_timestamp ASC
  `).all(start, end) as any[]).map(row => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    symbol: row.symbol,
    title: row.title,
    summary: row.summary ?? null,
    sentiment: row.sentiment,
    eventType: row.event_type ?? null,
    importance: row.importance,
    url: row.url ?? null,
    payload: parseJson(row.payload, {}),
    eventTimestamp: row.event_timestamp * 1000,
    createdAt: row.created_at * 1000,
  }));
}

function getTradingDays(data: SymbolPrices, start: string, end: string): string[] {
  const dates = new Set<string>();
  for (const rows of Object.values(data)) {
    for (const row of rows) {
      if (row.date >= start && row.date <= end) dates.add(row.date);
    }
  }
  return [...dates].sort();
}

function buildDateIndex(symbols: string[], data: SymbolPrices) {
  const result: Record<string, Record<string, number>> = {};
  for (const symbol of symbols) {
    result[symbol] = {};
    (data[symbol] ?? []).forEach((row, index) => {
      result[symbol][row.date] = index;
    });
  }
  return result;
}

function getRecentEventsForDate(events: ResearchEvent[], date: string, hoursBack: number): ResearchEvent[] {
  const end = Date.parse(`${date}T23:59:59Z`);
  const start = end - hoursBack * 3600 * 1000;
  return events.filter(event => {
    const availableAt = getEventAvailabilityTimestamp(event);
    return availableAt >= start && availableAt <= end;
  });
}

export function getEventAvailabilityTimestamp(event: Pick<ResearchEvent, 'eventTimestamp' | 'createdAt'>): number {
  return Math.max(event.eventTimestamp, event.createdAt);
}

function groupBySymbol(events: ResearchEvent[]) {
  const result = new Map<string, ResearchEvent[]>();
  for (const event of events) {
    if (!result.has(event.symbol)) result.set(event.symbol, []);
    result.get(event.symbol)!.push(event);
  }
  return result;
}

function getHistoricalTechnicalFactors(
  prices: DayPrice[],
  idx: number,
  direction: 'BUY' | 'SELL' | 'HOLD',
  rsiOversold: number,
  rsiOverbought: number,
  minVolumeRatioForBreakout: number,
) {
  const slice = prices.slice(0, idx + 1);
  const closes = slice.map(row => row.close);
  const volumes = slice.map(row => row.volume);
  const n = closes.length - 1;

  const ema20 = calculateEMA(closes, 20)[n] ?? closes[n];
  const ema50 = calculateEMA(closes, 50)[n] ?? closes[n];
  const rsi = calculateRSI(closes, 14)[n] ?? 50;
  const avgVolume = volumes.slice(Math.max(0, n - 20), n).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(20, n));
  const volumeRatio = avgVolume > 0 ? volumes[n] / avgVolume : 1;

  const breakdown: Record<string, number> = {};
  const notes: string[] = [];
  const isBullish = closes[n] > ema20 && closes[n] > ema50;
  const isBearish = closes[n] < ema20 && closes[n] < ema50;

  if (isBullish) {
    breakdown.technical = 10;
    notes.push('Historical technical trend bullish');
  } else if (isBearish) {
    breakdown.technical = -10;
    notes.push('Historical technical trend bearish');
  }

  if (direction === 'BUY' && rsi < rsiOversold) {
    breakdown.oversold = 6;
    notes.push(`Historical RSI ${rsi.toFixed(0)} supports long entry`);
  }
  if (direction === 'SELL' && rsi > rsiOverbought) {
    breakdown.overbought = -6;
    notes.push(`Historical RSI ${rsi.toFixed(0)} supports sell`);
  }
  if (volumeRatio >= minVolumeRatioForBreakout) {
    breakdown.volume = direction === 'SELL' ? -4 : 4;
    notes.push(`Historical volume ${volumeRatio.toFixed(1)}x average`);
  }

  return { breakdown, notes };
}

function getPositionsValue(positions: Record<string, SimPosition>, data: SymbolPrices, date: string): number {
  return Object.entries(positions).reduce((sum, [symbol, position]) => {
    const row = getPriceAtDate(data[symbol], date);
    return sum + position.shares * (row?.close ?? position.avgPrice);
  }, 0);
}

function getPriceAtDate(rows: DayPrice[] | undefined, date: string): DayPrice | undefined {
  return rows?.filter(row => row.date <= date).pop();
}

function getExactPriceAtDate(rows: DayPrice[] | undefined, date: string): DayPrice | undefined {
  return rows?.find(row => row.date === date);
}

export function applyExecutionCosts(
  rawOpen: number,
  action: 'BUY' | 'SELL',
  config: Pick<BacktestConfig, 'spreadBps' | 'slippageBps'>,
): number {
  const costBps = (config.spreadBps ?? 0) / 2 + (config.slippageBps ?? 0);
  const multiplier = action === 'BUY' ? 1 + costBps / 10_000 : 1 - costBps / 10_000;
  return Number((rawOpen * multiplier).toFixed(4));
}

function computeMetrics(config: BacktestConfig, trades: BacktestTrade[], dailyValues: BacktestDayValue[]): BacktestMetrics {
  const finalValue = dailyValues[dailyValues.length - 1]?.value ?? config.startingCapital;
  const finalSpy = dailyValues[dailyValues.length - 1]?.spyValue ?? config.startingCapital;
  const totalReturn = ((finalValue - config.startingCapital) / config.startingCapital) * 100;
  const spyReturn = ((finalSpy - config.startingCapital) / config.startingCapital) * 100;

  const dailyReturns = dailyValues.map((day, index) =>
    index === 0 ? 0 : (day.value - dailyValues[index - 1].value) / dailyValues[index - 1].value
  ).slice(1);
  const averageReturn = dailyReturns.reduce((sum, value) => sum + value, 0) / (dailyReturns.length || 1);
  const variance = dailyReturns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / (dailyReturns.length || 1);
  const std = Math.sqrt(variance);
  const sharpe = dailyReturns.length >= 10 && std > 0
    ? round(((averageReturn - 0.05 / 252) / std) * Math.sqrt(252))
    : null;

  let peak = config.startingCapital;
  let maxDrawdown = 0;
  for (const row of dailyValues) {
    if (row.value > peak) peak = row.value;
    maxDrawdown = Math.max(maxDrawdown, ((peak - row.value) / peak) * 100);
  }

  const sells = trades.filter(trade => trade.action === 'SELL' && trade.returnPct !== undefined);
  const winners = sells.filter(trade => (trade.pnl ?? 0) > 0);
  const losers = sells.filter(trade => (trade.pnl ?? 0) <= 0);
  const grossWins = winners.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0));
  const sorted = [...sells].sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));

  return {
    totalReturn: round(totalReturn),
    spyReturn: round(spyReturn),
    alpha: round(totalReturn - spyReturn),
    sharpe,
    maxDrawdown: round(maxDrawdown),
    winRate: sells.length >= 3 ? round((winners.length / sells.length) * 100) : null,
    profitFactor: sells.length >= 3 && grossLoss > 0 ? round(grossWins / grossLoss) : null,
    totalTrades: trades.length,
    avgHoldDays: sells.length > 0 ? round(sells.reduce((sum, trade) => sum + (trade.holdDays ?? 0), 0) / sells.length) : null,
    bestTrade: sorted[0] ? { symbol: sorted[0].symbol, returnPct: round(sorted[0].returnPct ?? 0) } : null,
    worstTrade: sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, returnPct: round(sorted[sorted.length - 1].returnPct ?? 0) } : null,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function round(value: number): number {
  return parseFloat(value.toFixed(2));
}

export const DEFAULT_CONFIG: BacktestConfig = {
  startDate: (() => { const date = new Date(); date.setMonth(date.getMonth() - 5); return date.toISOString().split('T')[0]; })(),
  endDate: new Date().toISOString().split('T')[0],
  startingCapital: 100_000,
  positionSizePct: 0.10,
  stopLossPct: -0.08,
  maxPositions: 8,
  rsiOversold: 35,
  rsiOverbought: 70,
  minVolumeRatioForBreakout: 1.8,
  researchWindowHours: 72,
  minCandidateConfidence: 55,
  spreadBps: 10,
  slippageBps: 5,
};
