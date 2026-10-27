import db from './db.js';
import { saveResearchEvents } from './research.js';
import { computeTechnicalSnapshot, WATCHLIST } from './technicals.js';

const OPTIONS_SYMBOLS = [...WATCHLIST];

export async function refreshSentimentData(now = new Date()): Promise<{
  optionsSaved: number;
  shortInterestSaved: number;
  eventsSaved: number;
}> {
  const optionsSaved = await refreshOptionsFlow();
  const { saved: shortInterestSaved, eventsSaved: shortInterestEvents } = await refreshShortInterest(now);
  const optionsEventsSaved = emitOptionsFlowEvents(getLatestOptionsFlow());

  return {
    optionsSaved,
    shortInterestSaved,
    eventsSaved: optionsEventsSaved + shortInterestEvents,
  };
}

export async function refreshOptionsFlow(symbols = OPTIONS_SYMBOLS): Promise<number> {
  const insert = db.prepare(`
    INSERT INTO options_flow
      (symbol, observation_date, total_call_volume, total_put_volume, put_call_volume_ratio, put_call_oi_ratio, sentiment)
    VALUES
      (@symbol, @observation_date, @total_call_volume, @total_put_volume, @put_call_volume_ratio, @put_call_oi_ratio, @sentiment)
    ON CONFLICT(symbol, observation_date) DO UPDATE SET
      total_call_volume = excluded.total_call_volume,
      total_put_volume = excluded.total_put_volume,
      put_call_volume_ratio = excluded.put_call_volume_ratio,
      put_call_oi_ratio = excluded.put_call_oi_ratio,
      sentiment = excluded.sentiment,
      fetched_at = unixepoch()
  `);

  let saved = 0;
  for (const symbol of symbols) {
    const snapshot = await fetchOptionsSnapshot(symbol);
    if (!snapshot) continue;
    const result = insert.run(snapshot);
    saved += Number(result.changes ?? 0);
  }
  return saved;
}

export async function refreshShortInterest(now = new Date()): Promise<{ saved: number; eventsSaved: number }> {
  const dataset = await fetchLatestRegshoDataset(now);
  if (!dataset) return { saved: 0, eventsSaved: 0 };

  const reportDate = `${dataset.yyyyMM.slice(0, 4)}-${dataset.yyyyMM.slice(4)}-01`;
  const insert = db.prepare(`
    INSERT INTO short_interest
      (symbol, report_date, short_volume, total_volume, short_volume_ratio, prior_ratio, trend, squeeze_risk)
    VALUES
      (@symbol, @report_date, @short_volume, @total_volume, @short_volume_ratio, @prior_ratio, @trend, @squeeze_risk)
    ON CONFLICT(symbol, report_date) DO UPDATE SET
      short_volume = excluded.short_volume,
      total_volume = excluded.total_volume,
      short_volume_ratio = excluded.short_volume_ratio,
      prior_ratio = excluded.prior_ratio,
      trend = excluded.trend,
      squeeze_risk = excluded.squeeze_risk,
      fetched_at = unixepoch()
  `);

  let saved = 0;
  for (const row of aggregateRegshoRows(dataset.text)) {
    if (!OPTIONS_SYMBOLS.includes(row.symbol)) continue;
    const priorRatio = getPreviousShortRatio(row.symbol, reportDate);
    const rsi = computeTechnicalSnapshot(row.symbol)?.rsi14 ?? 50;
    const trend = priorRatio === null
      ? 'stable'
      : row.shortVolumeRatio > priorRatio
        ? 'increasing'
        : row.shortVolumeRatio < priorRatio
          ? 'decreasing'
          : 'stable';
    const squeezeRisk = row.shortVolumeRatio > 0.45 && rsi < 35
      ? 'high'
      : row.shortVolumeRatio > 0.35
        ? 'moderate'
        : 'low';
    const result = insert.run({
      symbol: row.symbol,
      report_date: reportDate,
      short_volume: row.shortVolume,
      total_volume: row.totalVolume,
      short_volume_ratio: row.shortVolumeRatio,
      prior_ratio: priorRatio,
      trend,
      squeeze_risk: squeezeRisk,
    });
    saved += Number(result.changes ?? 0);
  }

  return {
    saved,
    eventsSaved: emitShortInterestEvents(reportDate),
  };
}

export function getOptionsFlow(symbol?: string): any[] {
  const rows = symbol
    ? db.prepare(`
        SELECT * FROM options_flow
        WHERE symbol = ?
        ORDER BY observation_date DESC
      `).all(symbol)
    : db.prepare(`
        SELECT * FROM options_flow
        ORDER BY observation_date DESC, symbol ASC
      `).all();
  return rows as any[];
}

export function getShortInterest(): any[] {
  const rows = db.prepare(`
    SELECT *
    FROM short_interest
    ORDER BY report_date DESC, symbol ASC
  `).all() as any[];
  return rows;
}

export function getSqueezeCandidates(): any[] {
  const rows = db.prepare(`
    SELECT *
    FROM short_interest
    WHERE squeeze_risk = 'high'
    ORDER BY report_date DESC, short_volume_ratio DESC
  `).all() as any[];
  return rows;
}

async function fetchOptionsSnapshot(symbol: string): Promise<{
  symbol: string;
  observation_date: string;
  total_call_volume: number;
  total_put_volume: number;
  put_call_volume_ratio: number;
  put_call_oi_ratio: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
} | null> {
  const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/${symbol}`);
  if (!res.ok) return null;

  const json = await res.json() as any;
  const optionChain = json?.optionChain?.result?.[0];
  const optionSet = optionChain?.options?.[0];
  if (!optionSet) return null;

  const calls = Array.isArray(optionSet.calls) ? optionSet.calls : [];
  const puts = Array.isArray(optionSet.puts) ? optionSet.puts : [];
  const totalCallVolume = calls.reduce((sum: number, item: any) => sum + Number(item.volume ?? 0), 0);
  const totalPutVolume = puts.reduce((sum: number, item: any) => sum + Number(item.volume ?? 0), 0);
  const totalCallOi = calls.reduce((sum: number, item: any) => sum + Number(item.openInterest ?? 0), 0);
  const totalPutOi = puts.reduce((sum: number, item: any) => sum + Number(item.openInterest ?? 0), 0);
  const pcr = totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0;
  const oiRatio = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;

  return {
    symbol,
    observation_date: new Date().toISOString().slice(0, 10),
    total_call_volume: totalCallVolume,
    total_put_volume: totalPutVolume,
    put_call_volume_ratio: Number(pcr.toFixed(4)),
    put_call_oi_ratio: Number(oiRatio.toFixed(4)),
    sentiment: pcr < 0.5 ? 'bullish' : pcr > 1.5 ? 'bearish' : 'neutral',
  };
}

async function fetchLatestRegshoDataset(now: Date): Promise<{ yyyyMM: string; text: string } | null> {
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const yyyyMM = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await fetch(`https://cdn.finra.org/equity/regsho/monthly/CNMSshvol${yyyyMM}.txt`);
    if (!res.ok) continue;
    return { yyyyMM, text: await res.text() };
  }
  return null;
}

export function aggregateRegshoRows(text: string): Array<{
  symbol: string;
  shortVolume: number;
  totalVolume: number;
  shortVolumeRatio: number;
}> {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.split('\t') ?? [];
  const idxSymbol = header.findIndex(value => value.toUpperCase() === 'SYMBOL');
  const idxShortVolume = header.findIndex(value => value.toUpperCase() === 'SHORTVOLUME');
  const idxTotalVolume = header.findIndex(value => value.toUpperCase() === 'TOTALVOLUME');
  if (idxSymbol === -1 || idxShortVolume === -1 || idxTotalVolume === -1) return [];

  const aggregated = new Map<string, { shortVolume: number; totalVolume: number }>();
  for (const line of lines) {
    const cols = line.split('\t');
    const symbol = cols[idxSymbol]?.trim().toUpperCase();
    if (!symbol) continue;
    const shortVolume = Number(cols[idxShortVolume] ?? 0);
    const totalVolume = Number(cols[idxTotalVolume] ?? 0);
    const entry = aggregated.get(symbol) ?? { shortVolume: 0, totalVolume: 0 };
    entry.shortVolume += shortVolume;
    entry.totalVolume += totalVolume;
    aggregated.set(symbol, entry);
  }

  return [...aggregated.entries()]
    .filter(([, row]) => row.totalVolume > 0)
    .map(([symbol, row]) => ({
      symbol,
      shortVolume: row.shortVolume,
      totalVolume: row.totalVolume,
      shortVolumeRatio: Number((row.shortVolume / row.totalVolume).toFixed(4)),
    }));
}

export function emitOptionsFlowEvents(rows: any[]): number {
  const latestBySymbol = new Map<string, any>();
  for (const row of rows) {
    if (!latestBySymbol.has(row.symbol)) latestBySymbol.set(row.symbol, row);
  }

  const events: Array<Parameters<typeof saveResearchEvents>[0][number]> = [];
  for (const row of latestBySymbol.values()) {
    if (row.put_call_volume_ratio < 0.5) {
      events.push({
        sourceType: 'options_flow',
        sourceId: `${row.symbol}:${row.observation_date}:heavy_call_buying`,
        symbol: row.symbol,
        title: `${row.symbol} options flow shows heavy call buying`,
        summary: `Put/call volume ratio is ${Number(row.put_call_volume_ratio).toFixed(2)}.`,
        sentiment: 'bullish',
        eventType: 'heavy_call_buying',
        importance: 0.7,
        payload: { putCallVolumeRatio: row.put_call_volume_ratio, putCallOiRatio: row.put_call_oi_ratio },
        eventTimestamp: Date.parse(`${row.observation_date}T00:00:00Z`),
      });
    } else if (row.put_call_volume_ratio > 1.5) {
      events.push({
        sourceType: 'options_flow',
        sourceId: `${row.symbol}:${row.observation_date}:heavy_put_buying`,
        symbol: row.symbol,
        title: `${row.symbol} options flow shows heavy put buying`,
        summary: `Put/call volume ratio is ${Number(row.put_call_volume_ratio).toFixed(2)}.`,
        sentiment: 'bearish',
        eventType: 'heavy_put_buying',
        importance: 0.75,
        payload: { putCallVolumeRatio: row.put_call_volume_ratio, putCallOiRatio: row.put_call_oi_ratio },
        eventTimestamp: Date.parse(`${row.observation_date}T00:00:00Z`),
      });
    }
  }

  return events.length > 0 ? saveResearchEvents(events).length : 0;
}

export function emitShortInterestEvents(reportDate: string): number {
  const rows = db.prepare(`
    SELECT *
    FROM short_interest
    WHERE report_date = ?
    ORDER BY symbol ASC
  `).all(reportDate) as any[];

  const events: Array<Parameters<typeof saveResearchEvents>[0][number]> = [];
  for (const row of rows) {
    if (row.short_volume_ratio > 0.45 && row.squeeze_risk === 'high') {
      events.push({
        sourceType: 'short_interest',
        sourceId: `${row.symbol}:${row.report_date}:short_squeeze_setup`,
        symbol: row.symbol,
        title: `${row.symbol} shows elevated short squeeze risk`,
        summary: `Short volume ratio is ${Number(row.short_volume_ratio).toFixed(2)} with oversold RSI support.`,
        sentiment: 'bullish',
        eventType: 'short_squeeze_setup',
        importance: 0.8,
        payload: { shortVolumeRatio: row.short_volume_ratio, trend: row.trend, squeezeRisk: row.squeeze_risk },
        eventTimestamp: Date.parse(`${row.report_date}T00:00:00Z`),
      });
    } else if (row.short_volume_ratio > 0.5 && row.trend === 'increasing') {
      events.push({
        sourceType: 'short_interest',
        sourceId: `${row.symbol}:${row.report_date}:short_buildup`,
        symbol: row.symbol,
        title: `${row.symbol} shows increasing short buildup`,
        summary: `Short volume ratio is ${Number(row.short_volume_ratio).toFixed(2)} and still rising.`,
        sentiment: 'bearish',
        eventType: 'short_buildup',
        importance: 0.65,
        payload: { shortVolumeRatio: row.short_volume_ratio, trend: row.trend, squeezeRisk: row.squeeze_risk },
        eventTimestamp: Date.parse(`${row.report_date}T00:00:00Z`),
      });
    }
  }

  return events.length > 0 ? saveResearchEvents(events).length : 0;
}

function getLatestOptionsFlow(): any[] {
  return db.prepare(`
    SELECT *
    FROM options_flow
    ORDER BY observation_date DESC, symbol ASC
  `).all() as any[];
}

function getPreviousShortRatio(symbol: string, reportDate: string): number | null {
  const row = db.prepare(`
    SELECT short_volume_ratio
    FROM short_interest
    WHERE symbol = ? AND report_date < ?
    ORDER BY report_date DESC
    LIMIT 1
  `).get(symbol, reportDate) as any;
  return row?.short_volume_ratio ?? null;
}
