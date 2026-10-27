/**
 * Live market price fetching for the backend agent.
 * Priority:
 * 1. Alpaca Market Data (free with paper/live account)
 * 2. Polygon snapshot (optional fallback)
 * 3. Latest stored EOD closes from price_history
 * Cached for 15 seconds — called every 30s by the agent cycle.
 */

import db from './db.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

export type MarketPriceSource = 'alpaca' | 'polygon' | 'stored_eod_fallback' | null;

let priceCache: { data: Record<string, number>; fetchedAt: number; source: MarketPriceSource } = {
  data: {},
  fetchedAt: 0,
  source: null,
};
let lastError: string | null = null;

export async function fetchCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
  // Return cached data if fresh (< 15s)
  if (Date.now() - priceCache.fetchedAt < 15_000 && Object.keys(priceCache.data).length > 0) {
    return priceCache.data;
  }

  try {
    const alpacaPrices = await fetchAlpacaPrices(symbols);
    if (Object.keys(alpacaPrices).length > 0) {
      return commitPrices(alpacaPrices, symbols.length, 'alpaca');
    }

    const polygonPrices = await fetchPolygonPrices(symbols);
    if (Object.keys(polygonPrices).length > 0) {
      return commitPrices(polygonPrices, symbols.length, 'polygon');
    }

    const storedPrices = getLatestStoredPrices(symbols);
    if (Object.keys(storedPrices).length > 0) {
      return commitPrices(storedPrices, symbols.length, 'stored_eod_fallback');
    }

    throw new Error('No market data provider returned prices');
  } catch (err: any) {
    console.error('[MarketData] Failed:', err?.message);
    lastError = err?.message ?? 'Unknown market data error';
    markDataSourceFailure('live_prices', lastError, {
      symbolsRequested: symbols.length,
      cacheAgeMs: Date.now() - priceCache.fetchedAt,
    });
    return priceCache.data; // Return stale cache on error
  }
}

function commitPrices(prices: Record<string, number>, symbolsRequested: number, source: Exclude<MarketPriceSource, null>): Record<string, number> {
  priceCache = { data: prices, fetchedAt: Date.now(), source };
  lastError = null;
  markDataSourceSuccess('live_prices', Object.keys(prices).length, {
    symbolsRequested,
    cacheAgeMs: 0,
    source,
  });
  console.log(`[MarketData] Prices fetched for ${Object.keys(prices).length} symbols (${source})`);
  return prices;
}

async function fetchAlpacaPrices(symbols: string[]): Promise<Record<string, number>> {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) return {};

  try {
    const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(','))}&feed=iex`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
      },
    });

    if (!res.ok) throw new Error(`Alpaca snapshots ${res.status}`);

    const json = await res.json() as { snapshots?: Record<string, any> };
    const prices: Record<string, number> = {};
    for (const [symbol, snapshot] of Object.entries(json.snapshots ?? {})) {
      const price = snapshot?.latestTrade?.p ?? snapshot?.dailyBar?.c ?? snapshot?.prevDailyBar?.c;
      if (price && price > 0) prices[symbol] = price;
    }

    return prices;
  } catch (err: any) {
    // Swallow — let the caller fall through to the next price source instead
    // of aborting the whole fallback chain.
    console.error('[MarketData] Alpaca snapshot failed:', err?.message);
    return {};
  }
}

async function fetchPolygonPrices(symbols: string[]): Promise<Record<string, number>> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return {};

  try {
    const tickers = symbols.join(',');
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon snapshot ${res.status}`);

    const json = await res.json() as { tickers?: any[] };
    const prices: Record<string, number> = {};
    for (const item of (json.tickers ?? [])) {
      const price = item.day?.c ?? item.prevDay?.c ?? item.lastTrade?.p;
      if (price && price > 0) prices[item.ticker] = price;
    }

    return prices;
  } catch (err: any) {
    // Swallow — let the caller fall through to the stored-EOD fallback instead
    // of aborting the whole fallback chain.
    console.error('[MarketData] Polygon snapshot failed:', err?.message);
    return {};
  }
}

function getLatestStoredPrices(symbols: string[]): Record<string, number> {
  const latestClose = db.prepare(`
    SELECT close
    FROM price_history
    WHERE symbol = ?
    ORDER BY date DESC
    LIMIT 1
  `);

  return symbols.reduce((acc, symbol) => {
    const row = latestClose.get(symbol) as { close: number } | undefined;
    if (row?.close) acc[symbol] = row.close;
    return acc;
  }, {} as Record<string, number>);
}

export function getCachedPrices(): Record<string, number> {
  return priceCache.data;
}

export function evaluateQuoteEligibility(input: {
  source: MarketPriceSource;
  staleMs: number | null;
  lastError: string | null;
  mode: 'analysis' | 'paper' | 'live';
}): { executionEligible: boolean; reason: string } {
  if (input.lastError) return { executionEligible: false, reason: input.lastError };
  if (input.source === 'stored_eod_fallback' || input.source === null) {
    return { executionEligible: false, reason: 'Price source is valuation-only.' };
  }
  if (input.staleMs === null || input.staleMs > 60_000) {
    return { executionEligible: false, reason: 'Execution quote is stale.' };
  }
  return { executionEligible: true, reason: `Fresh ${input.source} execution quote.` };
}

export function getMarketDataStatus(mode: 'analysis' | 'paper' | 'live' = 'paper') {
  const staleMs = priceCache.fetchedAt ? Date.now() - priceCache.fetchedAt : null;
  const eligibility = evaluateQuoteEligibility({ source: priceCache.source, staleMs, lastError, mode });
  return {
    symbolsCached: Object.keys(priceCache.data).length,
    fetchedAt: priceCache.fetchedAt || null,
    staleMs,
    lastError,
    source: priceCache.source,
    ...eligibility,
  };
}

export function resetMarketDataCacheForTests(): void {
  priceCache = { data: {}, fetchedAt: 0, source: null };
  lastError = null;
}
