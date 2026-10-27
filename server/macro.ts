import db from './db.js';
import { saveResearchEvents } from './research.js';

export type MacroRegime = 'bull' | 'bear' | 'neutral';

interface SeriesConfig {
  id: string;
  name: string;
}

interface MacroSnapshot {
  fedFunds: number | null;
  unemployment: number | null;
  cpiYoY: number | null;
  yieldCurve: number | null;
  vixLevel: number | null;
}

const FRED_SERIES: SeriesConfig[] = [
  { id: 'FEDFUNDS', name: 'Fed Funds Rate' },
  { id: 'UNRATE', name: 'Unemployment Rate' },
  { id: 'CPIAUCSL', name: 'Consumer Price Index' },
  { id: 'T10Y2Y', name: '10Y-2Y Treasury Spread' },
  { id: 'VIXCLS', name: 'CBOE Volatility Index' },
];

const FOMC_DATES = new Set([
  '2025-01-28', '2025-03-18', '2025-05-06', '2025-06-17', '2025-07-29', '2025-09-16', '2025-10-28', '2025-12-09',
  '2026-01-27', '2026-03-17', '2026-04-28', '2026-06-16', '2026-07-28', '2026-09-15', '2026-10-27', '2026-12-08',
  '2027-01-26', '2027-03-16', '2027-04-27', '2027-06-08', '2027-07-27', '2027-09-14', '2027-10-26', '2027-12-07',
]);

export async function refreshMacroData(now = new Date()): Promise<{ regime: MacroRegime; indicatorsSaved: number; eventsSaved: number }> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error('FRED_API_KEY is not configured');
  }

  let indicatorsSaved = 0;
  const seriesData = new Map<string, Array<{ date: string; value: number | null }>>();

  for (const series of FRED_SERIES) {
    const observations = await fetchSeriesObservations(series.id, apiKey);
    seriesData.set(series.id, observations);
    indicatorsSaved += persistIndicators(series, observations);
  }

  const snapshot = buildSnapshot(seriesData);
  const regime = classifyMacroRegime(snapshot);
  persistMacroRegime(regime, snapshot);
  const eventsSaved = emitMacroResearchEvents(seriesData, now);

  return { regime, indicatorsSaved, eventsSaved };
}

export function classifyMacroRegime(snapshot: MacroSnapshot): MacroRegime {
  if ((snapshot.vixLevel ?? 0) > 30 || (snapshot.yieldCurve ?? 0) < -0.5) {
    return 'bear';
  }
  if ((snapshot.vixLevel ?? Number.POSITIVE_INFINITY) < 18 && (snapshot.yieldCurve ?? Number.NEGATIVE_INFINITY) > 0) {
    return 'bull';
  }
  return 'neutral';
}

export function getLatestMacroRegime(): {
  regime: MacroRegime;
  vixLevel: number | null;
  yieldCurve: number | null;
  fedFunds: number | null;
  cpiYoY: number | null;
  reasoning: string | null;
  computedAt: number | null;
} {
  const row = db.prepare(`
    SELECT regime, vix_level, yield_curve, fed_funds, cpi_yoy, reasoning, computed_at
    FROM macro_regimes
    ORDER BY computed_at DESC
    LIMIT 1
  `).get() as any;

  if (!row) {
    return {
      regime: 'neutral',
      vixLevel: null,
      yieldCurve: null,
      fedFunds: null,
      cpiYoY: null,
      reasoning: null,
      computedAt: null,
    };
  }

  return {
    regime: row.regime,
    vixLevel: row.vix_level,
    yieldCurve: row.yield_curve,
    fedFunds: row.fed_funds,
    cpiYoY: row.cpi_yoy,
    reasoning: row.reasoning ?? null,
    computedAt: row.computed_at ? row.computed_at * 1000 : null,
  };
}

export function getMacroIndicators(limit = 30): Record<string, Array<{ observationDate: string; value: number | null; fetchedAt: number }>> {
  const rows = db.prepare(`
    SELECT series_id, observation_date, value, fetched_at
    FROM macro_indicators
    ORDER BY observation_date DESC, fetched_at DESC
  `).all() as any[];

  const grouped: Record<string, Array<{ observationDate: string; value: number | null; fetchedAt: number }>> = {};
  for (const series of FRED_SERIES) grouped[series.id] = [];

  for (const row of rows) {
    const bucket = grouped[row.series_id] ?? (grouped[row.series_id] = []);
    if (bucket.length >= limit) continue;
    bucket.push({
      observationDate: row.observation_date,
      value: row.value,
      fetchedAt: row.fetched_at * 1000,
    });
  }

  return grouped;
}

export function getMacroPromptContext(): string {
  const regime = getLatestMacroRegime();
  return [
    `Macro regime: ${regime.regime.toUpperCase()}`,
    `VIX: ${formatValue(regime.vixLevel)}`,
    `10Y-2Y spread: ${formatValue(regime.yieldCurve)}`,
    `Fed funds: ${formatValue(regime.fedFunds)}`,
    `CPI YoY: ${formatPercent(regime.cpiYoY)}`,
    regime.reasoning ? `Reasoning: ${regime.reasoning}` : null,
  ].filter(Boolean).join('\n');
}

async function fetchSeriesObservations(seriesId: string, apiKey: string): Promise<Array<{ date: string; value: number | null }>> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    limit: seriesId === 'CPIAUCSL' ? '36' : '30',
    sort_order: 'desc',
    file_type: 'json',
  });
  const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} fetch failed (${res.status})`);
  }
  const json = await res.json() as { observations?: Array<{ date: string; value: string }> };
  return (json.observations ?? []).map(row => ({
    date: row.date,
    value: row.value === '.' ? null : Number(row.value),
  }));
}

function persistIndicators(series: SeriesConfig, observations: Array<{ date: string; value: number | null }>): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO macro_indicators (series_id, series_name, observation_date, value)
    VALUES (@series_id, @series_name, @observation_date, @value)
  `);

  let saved = 0;
  const tx = db.transaction(() => {
    for (const observation of observations) {
      const result = insert.run({
        series_id: series.id,
        series_name: series.name,
        observation_date: observation.date,
        value: observation.value,
      });
      saved += Number(result.changes ?? 0);
    }
  });
  tx();
  return saved;
}

function buildSnapshot(seriesData: Map<string, Array<{ date: string; value: number | null }>>): MacroSnapshot {
  const latestValue = (seriesId: string) => (seriesData.get(seriesId) ?? []).find(row => row.value !== null)?.value ?? null;
  return {
    fedFunds: latestValue('FEDFUNDS'),
    unemployment: latestValue('UNRATE'),
    cpiYoY: computeCpiYoY(seriesData.get('CPIAUCSL') ?? []),
    yieldCurve: latestValue('T10Y2Y'),
    vixLevel: latestValue('VIXCLS'),
  };
}

function computeCpiYoY(observations: Array<{ date: string; value: number | null }>): number | null {
  const latest = observations.find(row => row.value !== null);
  if (!latest?.value) return null;

  const latestDate = new Date(`${latest.date}T00:00:00Z`);
  const priorYearDate = new Date(latestDate);
  priorYearDate.setUTCFullYear(priorYearDate.getUTCFullYear() - 1);
  const priorYearKey = priorYearDate.toISOString().slice(0, 10);
  const prior = observations.find(row => row.date === priorYearKey && row.value !== null);
  if (!prior?.value) return null;

  return Number((((latest.value - prior.value) / prior.value) * 100).toFixed(2));
}

function persistMacroRegime(regime: MacroRegime, snapshot: MacroSnapshot): void {
  const reasoning = [
    snapshot.vixLevel !== null ? `VIX ${snapshot.vixLevel.toFixed(2)}` : null,
    snapshot.yieldCurve !== null ? `T10Y2Y ${snapshot.yieldCurve.toFixed(2)}` : null,
    snapshot.fedFunds !== null ? `Fed funds ${snapshot.fedFunds.toFixed(2)}` : null,
    snapshot.cpiYoY !== null ? `CPI YoY ${snapshot.cpiYoY.toFixed(2)}%` : null,
  ].filter(Boolean).join(', ');

  db.prepare(`
    INSERT INTO macro_regimes (regime, vix_level, yield_curve, fed_funds, cpi_yoy, reasoning)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    regime,
    snapshot.vixLevel,
    snapshot.yieldCurve,
    snapshot.fedFunds,
    snapshot.cpiYoY,
    reasoning,
  );
}

export function emitMacroResearchEvents(seriesData: Map<string, Array<{ date: string; value: number | null }>>, now: Date): number {
  const events: Array<Parameters<typeof saveResearchEvents>[0][number]> = [];

  const vix = (seriesData.get('VIXCLS') ?? []).filter(row => row.value !== null);
  if (vix.length >= 2 && (vix[1].value ?? 0) < 25 && (vix[0].value ?? 0) >= 25) {
    events.push({
      sourceType: 'news',
      sourceId: `macro:vix:${vix[0].date}`,
      symbol: 'MARKET',
      title: `VIX closed at ${(vix[0].value ?? 0).toFixed(1)} after crossing above 25`,
      summary: 'Volatility has moved into a stressed regime.',
      sentiment: 'bearish',
      eventType: 'volatility_spike',
      importance: 0.85,
      payload: { prior: vix[1].value, current: vix[0].value },
      eventTimestamp: Date.parse(`${vix[0].date}T00:00:00Z`),
    });
  }

  const curve = (seriesData.get('T10Y2Y') ?? []).filter(row => row.value !== null);
  if (curve.length >= 2 && (curve[1].value ?? 0) > 0 && (curve[0].value ?? 0) < 0) {
    events.push({
      sourceType: 'news',
      sourceId: `macro:t10y2y:${curve[0].date}`,
      symbol: 'MARKET',
      title: `Yield curve inverted with T10Y2Y at ${(curve[0].value ?? 0).toFixed(2)}`,
      summary: 'The 10Y-2Y spread crossed below zero.',
      sentiment: 'bearish',
      eventType: 'yield_curve_inversion',
      importance: 0.75,
      payload: { prior: curve[1].value, current: curve[0].value },
      eventTimestamp: Date.parse(`${curve[0].date}T00:00:00Z`),
    });
  }

  const cpi = (seriesData.get('CPIAUCSL') ?? []).filter(row => row.value !== null);
  const currentCpiYoY = computeCpiYoY(cpi);
  const priorCpiYoY = computeCpiYoY(cpi.slice(1));
  if (currentCpiYoY !== null && priorCpiYoY !== null && Math.abs(currentCpiYoY - priorCpiYoY) >= 0.5) {
    const latestCpiDate = cpi[0]?.date;
    if (latestCpiDate) {
      events.push({
        sourceType: 'news',
        sourceId: `macro:cpi:${latestCpiDate}`,
        symbol: 'MARKET',
        title: `CPI YoY moved to ${currentCpiYoY.toFixed(2)}%`,
        summary: 'Inflation trend shifted materially versus the prior release.',
        sentiment: currentCpiYoY > priorCpiYoY ? 'bearish' : 'bullish',
        eventType: 'cpi_release',
        importance: 0.8,
        payload: { priorCpiYoY, currentCpiYoY },
        eventTimestamp: Date.parse(`${latestCpiDate}T00:00:00Z`),
      });
    }
  }

  const today = now.toISOString().slice(0, 10);
  if (FOMC_DATES.has(today)) {
    events.push({
      sourceType: 'news',
      sourceId: `macro:fomc:${today}`,
      symbol: 'MARKET',
      title: `FOMC decision day: ${today}`,
      summary: 'Federal Reserve policy decision is scheduled for today.',
      sentiment: 'neutral',
      eventType: 'fed_decision',
      importance: 0.9,
      payload: { date: today },
      eventTimestamp: Date.parse(`${today}T00:00:00Z`),
    });
  }

  if (events.length === 0) return 0;
  return saveResearchEvents(events).length;
}

function formatValue(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(2);
}

function formatPercent(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(2)}%`;
}
