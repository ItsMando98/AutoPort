import { randomUUID } from 'crypto';
import db from './db.js';
import { getFundamentals } from './fundamentals.js';
import { getAllWeeklySnapshots } from './multitimeframe.js';
import { calculateSectorPerformance, getSectorTrendForSymbol } from './sectorrotation.js';
import { getLastScreenerResults } from './screener.js';
import { composeSignalCandidate } from './strategy.js';
import { WATCHLIST, getAllTechnicalSnapshots } from './technicals.js';
import type { MacroRegime } from './macro.js';

export type ResearchSourceType = 'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest';
export type ResearchSentiment = 'bullish' | 'bearish' | 'neutral';

export interface ResearchEvent {
  id: string;
  sourceType: ResearchSourceType;
  sourceId: string;
  symbol: string;
  title: string;
  summary: string | null;
  sentiment: ResearchSentiment;
  eventType: string | null;
  importance: number;
  url: string | null;
  payload: Record<string, any>;
  eventTimestamp: number;
  createdAt: number;
}

export interface SignalCandidate {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  decisionAction?: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | null;
  decisionBatchId?: string | null;
  actionable?: boolean;
  score: number;
  confidence: number;
  status: 'new' | 'pending_approval' | 'in_flight' | 'executed' | 'blocked' | 'stale';
  reasoning: string;
  sourceEventIds: string[];
  factorBreakdown: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export function saveResearchEvents(events: Array<{
  sourceType: ResearchSourceType;
  sourceId: string;
  symbol: string;
  title: string;
  summary?: string | null;
  sentiment: ResearchSentiment;
  eventType?: string | null;
  importance?: number;
  url?: string | null;
  payload?: Record<string, any>;
  eventTimestamp?: number;
}>): string[] {
  const insert = db.prepare(`
    INSERT INTO research_events
      (id, source_type, source_id, symbol, title, summary, sentiment, event_type, importance, url, payload, event_timestamp)
    VALUES
      (@id, @source_type, @source_id, @symbol, @title, @summary, @sentiment, @event_type, @importance, @url, @payload, @event_timestamp)
    ON CONFLICT(source_type, source_id, symbol) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      sentiment = excluded.sentiment,
      event_type = excluded.event_type,
      importance = excluded.importance,
      url = excluded.url,
      payload = excluded.payload,
      event_timestamp = excluded.event_timestamp
  `);

  return events.map(event => {
    const existing = db.prepare(`
      SELECT id FROM research_events
      WHERE source_type = ? AND source_id = ? AND symbol = ?
    `).get(event.sourceType, event.sourceId, event.symbol) as any;

    const id = existing?.id ?? randomUUID();
    insert.run({
      id,
      source_type: event.sourceType,
      source_id: event.sourceId,
      symbol: event.symbol,
      title: event.title,
      summary: event.summary ?? null,
      sentiment: event.sentiment,
      event_type: event.eventType ?? null,
      importance: clamp(event.importance ?? 0.5, 0, 1),
      url: event.url ?? null,
      payload: JSON.stringify(event.payload ?? {}),
      event_timestamp: Math.floor((event.eventTimestamp ?? Date.now()) / 1000),
    });
    return id;
  });
}

export function getRecentResearchEvents(limit = 100, symbol?: string): ResearchEvent[] {
  const rows = symbol
    ? db.prepare(`
        SELECT * FROM research_events
        WHERE symbol = ?
        ORDER BY event_timestamp DESC, created_at DESC
        LIMIT ?
      `).all(symbol, limit)
    : db.prepare(`
        SELECT * FROM research_events
        ORDER BY event_timestamp DESC, created_at DESC
        LIMIT ?
      `).all(limit);

  return (rows as any[]).map(rowToResearchEvent);
}

export function buildSignalCandidates(hoursBack = 72, macroRegime: MacroRegime = 'neutral'): SignalCandidate[] {
  const cutoff = Math.floor(Date.now() / 1000) - hoursBack * 3600;
  const rows = db.prepare(`
    SELECT * FROM research_events
    WHERE event_timestamp >= ?
    ORDER BY event_timestamp DESC
  `).all(cutoff) as any[];

  const grouped = new Map<string, ResearchEvent[]>();
  for (const row of rows) {
    const event = rowToResearchEvent(row);
    if (!grouped.has(event.symbol)) grouped.set(event.symbol, []);
    grouped.get(event.symbol)!.push(event);
  }

  const technicals = getAllTechnicalSnapshots();
  const fundamentalsBySymbol = WATCHLIST.reduce((acc, symbol) => {
    const value = getFundamentals(symbol);
    if (value) acc[symbol] = value;
    return acc;
  }, {} as Record<string, ReturnType<typeof getFundamentals>>);
  const screener = new Set(getLastScreenerResults().slice(0, 15).map(item => item.symbol));
  const weekly = getAllWeeklySnapshots(WATCHLIST);
  const sectors = calculateSectorPerformance();

  const candidates: SignalCandidate[] = [];

  for (const [symbol, events] of grouped.entries()) {
    const base = scoreResearchEvents(events);
    if (base.absoluteScore < getSignalThreshold(macroRegime)) continue;

    const breakdown: Record<string, number> = { research: base.score };
    const notes: string[] = [base.reasoning];
    const tech = technicals[symbol];
    const fundamentals = fundamentalsBySymbol[symbol];
    const weeklySnap = weekly[symbol];
    const sectorTrend = getSectorTrendForSymbol(symbol, sectors);

    if (tech) {
      const techBias = tech.trend.includes('bullish') ? 10 : tech.trend.includes('bearish') ? -10 : 0;
      breakdown.technical = techBias;
      if (techBias !== 0) notes.push(`Technical trend ${tech.trend.replace(/_/g, ' ')}`);
      if (base.direction === 'BUY' && tech.rsi14 < 35) {
        breakdown.oversoldBonus = 6;
        notes.push(`RSI ${tech.rsi14.toFixed(0)} supports a bounce setup`);
      }
      if (base.direction === 'SELL' && tech.rsi14 > 70) {
        breakdown.overboughtBonus = 6;
        notes.push(`RSI ${tech.rsi14.toFixed(0)} supports downside follow-through`);
      }
    }

    if (fundamentals) {
      const fundBias = (fundamentals.revenueGrowth ?? 0) > 0.1 || (fundamentals.profitMargin ?? 0) > 0.15 ? 5 : 0;
      if (base.direction === 'BUY' && fundBias > 0) {
        breakdown.fundamentals = fundBias;
        notes.push('Fundamentals add positive quality bias');
      }
    }

    if (screener.has(symbol)) {
      breakdown.screener = 8;
      notes.push('Symbol is in the top screener cohort');
    }

    if (weeklySnap) {
      const weeklyBias = weeklySnap.multiframeTrend === 'confirmed_bull'
        ? 8
        : weeklySnap.multiframeTrend === 'confirmed_bear'
          ? -8
          : 0;
      breakdown.multitimeframe = weeklyBias;
      if (weeklyBias !== 0) notes.push(`Weekly context ${weeklySnap.multiframeTrend.replace(/_/g, ' ')}`);
    }

    if (sectorTrend === 'strong_inflow' || sectorTrend === 'inflow') {
      breakdown.sector = base.direction === 'BUY' ? 6 : -4;
    } else if (sectorTrend === 'strong_outflow' || sectorTrend === 'outflow') {
      breakdown.sector = base.direction === 'SELL' ? 6 : -8;
    }

    const composed = composeSignalCandidate({
      symbol,
      factors: breakdown,
      notes,
      sourceEventIds: events.map(event => event.id),
    });
    if (composed.action === 'HOLD' || composed.confidence < 55) continue;

    const id = upsertSignalCandidate({
      symbol,
      action: composed.action,
      score: composed.score,
      confidence: composed.confidence,
      reasoning: composed.reasoning,
      sourceEventIds: composed.sourceEventIds,
      factorBreakdown: composed.factorBreakdown,
    });

    candidates.push({
      id,
      symbol: composed.symbol,
      action: composed.action,
      score: composed.score,
      confidence: composed.confidence,
      status: 'new',
      reasoning: composed.reasoning,
      sourceEventIds: composed.sourceEventIds,
      factorBreakdown: composed.factorBreakdown,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

export function getSignalCandidates(limit = 50): SignalCandidate[] {
  const rows = db.prepare(`
    SELECT * FROM signal_candidates
    WHERE status != 'stale'
      AND COALESCE(decision_action, action) != 'HOLD'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    action: row.action,
    decisionAction: row.decision_action ?? null,
    decisionBatchId: row.decision_batch_id ?? null,
    actionable: row.status !== 'stale' && (row.decision_action ?? row.action) !== 'HOLD',
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    reasoning: row.reasoning,
    sourceEventIds: parseJson(row.source_event_ids, []),
    factorBreakdown: parseJson(row.factor_breakdown, {}),
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  }));
}

export function updateSignalCandidateStatus(id: string, status: SignalCandidate['status']): void {
  db.prepare(`
    UPDATE signal_candidates
    SET status = @status, updated_at = unixepoch()
    WHERE id = @id
  `).run({ id, status });
}

export function scoreResearchEvents(events: ResearchEvent[]): {
  score: number;
  absoluteScore: number;
  direction: 'BUY' | 'SELL' | 'HOLD';
  reasoning: string;
} {
  let score = 0;
  const drivers: string[] = [];

  for (const event of events.slice(0, 6)) {
    const direction = event.sentiment === 'bullish' ? 1 : event.sentiment === 'bearish' ? -1 : 0;
    const sourceWeight = getSourceWeight(event.sourceType);
    const stalenessMultiplier = getStalenessMultiplier(event);
    const eventScore = Math.round(direction * sourceWeight * event.importance * stalenessMultiplier);
    score += eventScore;
    if (eventScore !== 0) {
      drivers.push(`${event.sourceType} ${event.sentiment} (${event.eventType ?? 'general'})`);
    }
  }

  const direction: 'BUY' | 'SELL' | 'HOLD' =
    score > 0 ? 'BUY' :
    score < 0 ? 'SELL' :
    'HOLD';

  return {
    score,
    absoluteScore: Math.abs(score),
    direction,
    reasoning: drivers.length > 0
      ? `Research bias: ${drivers.join(', ')}`
      : 'Research bias is neutral',
  };
}

function getSourceWeight(sourceType: ResearchSourceType): number {
  switch (sourceType) {
    case 'filing':
      return 16;
    case 'insider':
      return 18;
    case 'hedge_fund':
      return 14;
    case 'options_flow':
      return 12;
    case 'short_interest':
      return 10;
    case 'news':
    default:
      return 10;
  }
}

function getStalenessMultiplier(event: ResearchEvent): number {
  if (event.sourceType !== 'hedge_fund') return 1;
  const ageMs = Date.now() - event.eventTimestamp;
  return ageMs > 60 * 24 * 60 * 60 * 1000 ? 0.5 : 1;
}

export function getSignalThreshold(macroRegime: MacroRegime): number {
  switch (macroRegime) {
    case 'bull':
      return 15;
    case 'bear':
      return 28;
    case 'neutral':
    default:
      return 20;
  }
}

function upsertSignalCandidate(input: {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  confidence: number;
  reasoning: string;
  sourceEventIds: string[];
  factorBreakdown: Record<string, number>;
}): string {
  const existing = db.prepare(`
    SELECT id FROM signal_candidates
    WHERE symbol = ? AND status IN ('new', 'blocked')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(input.symbol) as any;

  const id = existing?.id ?? randomUUID();
  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, updated_at)
    VALUES
      (@id, @symbol, @action, @score, @confidence, 'new', @reasoning, @source_event_ids, @factor_breakdown, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      action = excluded.action,
      score = excluded.score,
      confidence = excluded.confidence,
      status = 'new',
      reasoning = excluded.reasoning,
      source_event_ids = excluded.source_event_ids,
      factor_breakdown = excluded.factor_breakdown,
      updated_at = unixepoch()
  `).run({
    id,
    symbol: input.symbol,
    action: input.action,
    score: input.score,
    confidence: input.confidence,
    reasoning: input.reasoning,
    source_event_ids: JSON.stringify(input.sourceEventIds),
    factor_breakdown: JSON.stringify(input.factorBreakdown),
  });

  return id;
}

function rowToResearchEvent(row: any): ResearchEvent {
  return {
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
