/**
 * Daily Stock Screener
 *
 * Scans the full universe (~75 stocks) every morning using batch snapshot data.
 * Priority:
 * 1. Alpaca snapshots (free with paper/live account)
 * 2. Polygon grouped daily (fallback)
 * Scores each stock on volume, price action, and technical indicators.
 * Returns the top 25 candidates for the agent to focus on that day.
 *
 * The agent uses screener results to:
 * - Boost confidence when screened stocks appear in news
 * - Prioritize analysis of high-scoring symbols
 */

import db from './db.js';
import { ALL_SYMBOLS, CORE_WATCHLIST, getSector, getCompanyName } from './universe.js';
import { computeTechnicalSnapshot, fetchAndStoreOHLCV } from './technicals.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

export interface ScreenerCandidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  volumeRatio: number;
  rsi14: number | null;
  score: number;
  signals: string[];
  isCore: boolean;
  screenedAt: number;
}

function scoreStock(
  symbol: string,
  changePercent: number,
  volumeRatio: number,
  rsi14: number | null
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];

  if (volumeRatio >= 3.0) {
    score += 35;
    signals.push(`Volume ${volumeRatio.toFixed(1)}x avg — exceptional`);
  } else if (volumeRatio >= 2.0) {
    score += 25;
    signals.push(`Volume ${volumeRatio.toFixed(1)}x avg — elevated`);
  } else if (volumeRatio >= 1.5) {
    score += 12;
    signals.push(`Volume ${volumeRatio.toFixed(1)}x avg`);
  }

  const absPct = Math.abs(changePercent);
  if (absPct >= 5) {
    score += 35;
    signals.push(`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% — strong move`);
  } else if (absPct >= 3) {
    score += 25;
    signals.push(`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% move`);
  } else if (absPct >= 1.5) {
    score += 12;
    signals.push(`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% move`);
  }

  if (volumeRatio >= 1.5 && absPct >= 2) {
    score += 15;
    signals.push(changePercent > 0 ? 'Bullish breakout confirmed by volume' : 'Bearish breakdown confirmed by volume');
  }

  if (rsi14 !== null) {
    if (rsi14 <= 25) {
      score += 15;
      signals.push(`RSI ${rsi14.toFixed(0)} — heavily oversold, bounce potential`);
    } else if (rsi14 <= 35) {
      score += 10;
      signals.push(`RSI ${rsi14.toFixed(0)} — oversold`);
    } else if (rsi14 >= 75) {
      score += 12;
      signals.push(`RSI ${rsi14.toFixed(0)} — heavily overbought`);
    } else if (rsi14 >= 68) {
      score += 8;
      signals.push(`RSI ${rsi14.toFixed(0)} — overbought`);
    }
  }

  return { score, signals };
}

export async function runScreener(): Promise<ScreenerCandidate[]> {
  console.log(`[Screener] Scanning ${ALL_SYMBOLS.length} symbols...`);

  try {
    const snapshotData = await fetchAlpacaSnapshots(ALL_SYMBOLS) ?? await fetchPolygonGroupedFallback();
    if (!snapshotData || Object.keys(snapshotData.current).length === 0) {
      console.warn('[Screener] No batch snapshot data available');
      markDataSourceFailure('screener', 'No batch snapshot data available');
      return getLastScreenerResults();
    }

    const candidates: ScreenerCandidate[] = [];

    for (const symbol of ALL_SYMBOLS) {
      const current = snapshotData.current[symbol];
      const previous = snapshotData.previous[symbol];
      if (!current) continue;

      const price = ('price' in current ? current.price : current.close) ?? current.close ?? 0;
      if (!price) continue;

      const prevClose = previous?.close ?? price;
      const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      const todayVol = current.volume ?? 0;
      const prevVol = previous?.volume ?? 0;
      const volumeRatio = prevVol > 0 ? todayVol / prevVol : 1;
      const snap = computeTechnicalSnapshot(symbol);
      const rsi14 = snap?.rsi14 ?? null;
      const { score, signals } = scoreStock(symbol, changePercent, volumeRatio, rsi14);

      if (score < 10) continue;

      candidates.push({
        symbol,
        name: getCompanyName(symbol),
        sector: getSector(symbol),
        price,
        changePercent,
        volumeRatio,
        rsi14,
        score,
        signals,
        isCore: CORE_WATCHLIST.includes(symbol),
        screenedAt: Date.now(),
      });
    }

    const top = candidates.sort((a, b) => b.score - a.score).slice(0, 25);
    saveScreenerResults(top);
    markDataSourceSuccess('screener', top.length, { provider: snapshotData.provider });

    const newSymbols = top
      .filter(candidate => !candidate.isCore && !computeTechnicalSnapshot(candidate.symbol))
      .map(candidate => candidate.symbol)
      .slice(0, 10);

    if (newSymbols.length > 0) {
      console.log(`[Screener] Fetching OHLCV for ${newSymbols.length} new candidates...`);
      fetchOHLCVBatch(newSymbols).catch(err =>
        console.error('[Screener] OHLCV batch failed:', err?.message)
      );
    }

    console.log(`[Screener] Top candidates: ${top.slice(0, 5).map(candidate => `${candidate.symbol}(${candidate.score})`).join(', ')}`);
    return top;
  } catch (err: any) {
    console.error('[Screener] Failed:', err?.message);
    markDataSourceFailure('screener', err?.message ?? 'Unknown screener error');
    return getLastScreenerResults();
  }
}

async function fetchOHLCVBatch(symbols: string[]): Promise<void> {
  for (const symbol of symbols) {
    await fetchAndStoreOHLCV(symbol, 6);
    await new Promise(resolve => setTimeout(resolve, 900));
  }
}

async function fetchAlpacaSnapshots(symbols: string[]): Promise<{
  provider: 'alpaca';
  current: Record<string, { price: number; close: number; volume: number }>;
  previous: Record<string, { close: number; volume: number }>;
} | null> {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) return null;

  const current: Record<string, { price: number; close: number; volume: number }> = {};
  const previous: Record<string, { close: number; volume: number }> = {};

  for (const group of chunk(symbols, 40)) {
    const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(group.join(','))}&feed=iex`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
      },
    });

    if (!res.ok) {
      console.warn(`[Screener] Alpaca snapshots ${res.status}`);
      return null;
    }

    const json = await res.json() as { snapshots?: Record<string, any> };
    for (const [symbol, snapshot] of Object.entries(json.snapshots ?? {})) {
      current[symbol] = {
        price: snapshot?.latestTrade?.p ?? snapshot?.dailyBar?.c ?? snapshot?.prevDailyBar?.c ?? 0,
        close: snapshot?.dailyBar?.c ?? snapshot?.prevDailyBar?.c ?? 0,
        volume: snapshot?.dailyBar?.v ?? 0,
      };
      previous[symbol] = {
        close: snapshot?.prevDailyBar?.c ?? current[symbol].close,
        volume: snapshot?.prevDailyBar?.v ?? 0,
      };
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return { provider: 'alpaca', current, previous };
}

async function fetchPolygonGroupedFallback(): Promise<{
  provider: 'polygon';
  current: Record<string, { close: number; volume: number }>;
  previous: Record<string, { close: number; volume: number }>;
} | null> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return null;

  let tradingDate = new Date().toISOString().split('T')[0];
  let currentRows: any[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    currentRows = await fetchPolygonGroupedDaily(tradingDate, apiKey);
    if (currentRows.length > 0) break;
    tradingDate = prevTradingDay(tradingDate);
  }

  if (currentRows.length === 0) return null;

  const previousRows = await fetchPolygonGroupedDaily(prevTradingDay(tradingDate), apiKey);
  const current = currentRows.reduce((acc, row) => {
    if (row.T) acc[row.T] = { close: row.c ?? 0, volume: row.v ?? 0 };
    return acc;
  }, {} as Record<string, { close: number; volume: number }>);
  const previous = previousRows.reduce((acc, row) => {
    if (row.T) acc[row.T] = { close: row.c ?? 0, volume: row.v ?? 0 };
    return acc;
  }, {} as Record<string, { close: number; volume: number }>);

  return { provider: 'polygon', current, previous };
}

async function fetchPolygonGroupedDaily(date: string, apiKey: string): Promise<any[]> {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return json.results ?? [];
}

function prevTradingDay(dateStr: string): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - 1);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function saveScreenerResults(candidates: ScreenerCandidate[]): void {
  try {
    db.prepare("DELETE FROM screener_results WHERE date < date('now')").run();

    const insert = db.prepare(`
      INSERT OR REPLACE INTO screener_results
        (symbol, name, sector, price, change_percent, volume_ratio, rsi14, score, signals, is_core, screened_at)
      VALUES
        (@symbol, @name, @sector, @price, @change_percent, @volume_ratio, @rsi14, @score, @signals, @is_core, @screened_at)
    `);

    const saveMany = db.transaction((rows: any[]) => {
      for (const row of rows) insert.run(row);
    });

    saveMany(candidates.map(candidate => ({
      symbol: candidate.symbol,
      name: candidate.name,
      sector: candidate.sector,
      price: candidate.price,
      change_percent: candidate.changePercent,
      volume_ratio: candidate.volumeRatio,
      rsi14: candidate.rsi14,
      score: candidate.score,
      signals: JSON.stringify(candidate.signals),
      is_core: candidate.isCore ? 1 : 0,
      screened_at: Math.floor(candidate.screenedAt / 1000),
    })));
  } catch (err: any) {
    console.error('[Screener] Failed to save results:', err?.message);
  }
}

export function getLastScreenerResults(): ScreenerCandidate[] {
  try {
    const rows = db.prepare(`
      SELECT * FROM screener_results ORDER BY score DESC LIMIT 25
    `).all() as any[];

    return rows.map(row => ({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      price: row.price,
      changePercent: row.change_percent,
      volumeRatio: row.volume_ratio,
      rsi14: row.rsi14,
      score: row.score,
      signals: JSON.parse(row.signals ?? '[]'),
      isCore: row.is_core === 1,
      screenedAt: row.screened_at * 1000,
    }));
  } catch {
    return [];
  }
}

export function getScreenerSymbols(limit = 25): string[] {
  return getLastScreenerResults().slice(0, limit).map(candidate => candidate.symbol);
}

export function formatScreenerForPrompt(candidates: ScreenerCandidate[]): string {
  if (candidates.length === 0) {
    return 'No screener results yet (runs at market open daily).';
  }

  return candidates.slice(0, 10).map(candidate => {
    const change = `${candidate.changePercent >= 0 ? '+' : ''}${candidate.changePercent.toFixed(1)}%`;
    const volume = candidate.volumeRatio >= 1.5 ? ` Vol:${candidate.volumeRatio.toFixed(1)}x` : '';
    const rsi = candidate.rsi14 !== null ? ` RSI:${candidate.rsi14.toFixed(0)}` : '';
    const core = candidate.isCore ? ' [core]' : '';
    return `${candidate.symbol.padEnd(5)} score:${candidate.score.toFixed(0).padStart(3)} | ${change.padStart(7)}${volume}${rsi}${core} — ${candidate.signals[0] ?? ''}`;
  }).join('\n');
}
