/**
 * Technical Analysis Module
 *
 * Responsibilities:
 * 1. Fetch OHLCV data from Alpaca or Polygon and store in SQLite
 * 2. Calculate technical indicators from stored price history
 * 3. Return compact snapshots consumed by the Gemini prompt
 */

import db from './db.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSnapshot {
  symbol: string;
  currentPrice: number;
  change1d: number;        // % change vs previous close
  rsi14: number;
  ema20: number;
  ema50: number;
  ema200: number | null;   // null if < 200 days of data
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  atr14: number;           // Average True Range (volatility)
  volumeRatio: number;     // Today's volume / 20-day avg
  trend: 'strongly_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strongly_bearish';
  signals: string[];       // Human-readable signal descriptions for the prompt
  dataPoints: number;      // Days of data available
  updatedAt: number;
}

// ─── Indicator Calculations ───────────────────────────────────────────────────

/**
 * Exponential Moving Average.
 * Returns array same length as prices; first (period-1) values are NaN.
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return prices.map(() => NaN);
  const k = 2 / (period + 1);
  const result: number[] = new Array(period - 1).fill(NaN);

  // Seed with SMA of first `period` values
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/**
 * Wilder's RSI. Returns array same length as prices; first `period` values are NaN.
 */
export function calculateRSI(prices: number[], period = 14): number[] {
  if (prices.length < period + 1) return prices.map(() => NaN);

  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  // Initial averages from first `period` changes
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

  // Wilder smoothing for remaining values
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/**
 * MACD (12, 26, 9). Returns parallel arrays same length as prices.
 */
export function calculateMACD(prices: number[]): {
  macd: number[];
  signal: number[];
  histogram: number[];
} {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  const macd = ema12.map((v, i) =>
    isNaN(v) || isNaN(ema26[i]) ? NaN : v - ema26[i]
  );

  // Only pass valid (non-NaN) MACD values to EMA-9 calculator
  const validMacd = macd.filter(v => !isNaN(v));
  const signalShort = calculateEMA(validMacd, 9);

  // Pad signal back to full length
  const nanPad = new Array(macd.length - signalShort.length).fill(NaN);
  const signal = [...nanPad, ...signalShort];

  const histogram = macd.map((v, i) =>
    isNaN(v) || isNaN(signal[i]) ? NaN : v - signal[i]
  );

  return { macd, signal, histogram };
}

/**
 * Bollinger Bands (20-period SMA ± 2 std dev).
 */
export function calculateBollingerBands(prices: number[], period = 20, stdDevMult = 2) {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN); middle.push(NaN); lower.push(NaN);
      continue;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - sma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(sma + stdDevMult * std);
    middle.push(sma);
    lower.push(sma - stdDevMult * std);
  }
  return { upper, middle, lower };
}

/**
 * Average True Range (volatility). Returns array same length as closes.
 * First `period` values are NaN.
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  if (highs.length < 2) return highs.map(() => NaN);

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  // Seed ATR with SMA of first `period` true ranges
  const result: number[] = new Array(period).fill(NaN);
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }
  return result;
}

// ─── Polygon.io OHLCV Fetcher ─────────────────────────────────────────────────

/**
 * Fetches OHLCV data from Polygon.io and stores to DB.
 * Uses INSERT OR REPLACE so re-runs are idempotent.
 * Requires POLYGON_API_KEY in environment.
 */
export async function fetchAndStoreOHLCV(symbol: string, monthsBack = 6): Promise<number> {
  try {
    const rows = await fetchAlpacaBars(symbol, monthsBack) ?? await fetchPolygonBars(symbol, monthsBack);
    if (rows.length === 0) {
      markDataSourceFailure('price_history', 'No OHLCV results from providers', { symbol });
      return 0;
    }

    const insert = db.prepare(`
      INSERT OR REPLACE INTO price_history (symbol, date, open, high, low, close, volume)
      VALUES (@symbol, @date, @open, @high, @low, @close, @volume)
    `);

    const insertMany = db.transaction((rows: any[]) => {
      for (const row of rows) insert.run(row);
    });

    insertMany(rows);
    markDataSourceSuccess('price_history', rows.length, { symbol, monthsBack });
    console.log(`[Technicals] ${symbol}: stored ${rows.length} days`);
    return rows.length;
  } catch (err: any) {
    console.error(`[Technicals] Failed to fetch ${symbol}: ${err?.message}`);
    markDataSourceFailure('price_history', err?.message ?? 'Unknown technical fetch error', { symbol });
    return 0;
  }
}

async function fetchAlpacaBars(symbol: string, monthsBack: number): Promise<Array<{
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> | null> {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) return null;

  const { from, to } = getDateRange(monthsBack);
  const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${from}T00:00:00Z&end=${to}T23:59:59Z&adjustment=all&feed=iex&limit=1000`;
  const res = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET,
    },
  });

  if (!res.ok) {
    console.warn(`[Technicals] Alpaca ${res.status} for ${symbol}`);
    return null;
  }

  const json = await res.json() as { bars?: any[] };
  const results = json.bars ?? [];
  if (results.length === 0) return null;

  return results.map((r: any) => ({
    symbol,
    date: new Date(r.t).toISOString().split('T')[0],
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v ?? 0,
  }));
}

async function fetchPolygonBars(symbol: string, monthsBack: number): Promise<Array<{
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return [];

  const { from, to } = getDateRange(monthsBack);
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[Technicals] Polygon.io ${res.status} for ${symbol}`);
    return [];
  }

  const json = await res.json();
  if (json.status !== 'OK' && json.status !== 'DELAYED') {
    console.error(`[Technicals] Polygon.io error for ${symbol}: ${json.status} — ${json.error ?? ''}`);
    return [];
  }

  const results: any[] = json.results ?? [];
  return results.map((r: any) => ({
    symbol,
    date: new Date(r.t).toISOString().split('T')[0],
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v ?? 0,
  }));
}

function getDateRange(monthsBack: number): { from: string; to: string } {
  const to = new Date().toISOString().split('T')[0];
  const from = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.toISOString().split('T')[0];
  })();
  return { from, to };
}

// ─── Snapshot Computation ─────────────────────────────────────────────────────

function getStoredPrices(symbol: string, limit = 250): PricePoint[] {
  return db.prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_history
    WHERE symbol = ?
    ORDER BY date ASC
    LIMIT ?
  `).all(symbol, limit) as PricePoint[];
}

/**
 * Computes a full technical snapshot for a symbol from stored price data.
 * Returns null if not enough data (< 30 days).
 */
export function computeTechnicalSnapshot(symbol: string): TechnicalSnapshot | null {
  const prices = getStoredPrices(symbol, 250);
  if (prices.length < 30) return null;

  const closes = prices.map(p => p.close);
  const highs   = prices.map(p => p.high);
  const lows    = prices.map(p => p.low);
  const volumes = prices.map(p => p.volume);
  const n = closes.length - 1;

  const currentPrice = closes[n];
  const prevPrice    = closes[n - 1];
  const change1d     = ((currentPrice - prevPrice) / prevPrice) * 100;

  // EMAs
  const ema20 = calculateEMA(closes, 20)[n];
  const ema50 = calculateEMA(closes, 50)[n];
  const ema200raw = closes.length >= 200 ? calculateEMA(closes, 200)[n] : null;
  const ema200 = ema200raw !== undefined && !isNaN(ema200raw as number) ? ema200raw : null;

  // RSI
  const rsiArr = calculateRSI(closes, 14);
  const rsi14  = isNaN(rsiArr[n]) ? 50 : rsiArr[n];

  // MACD
  const { macd, signal, histogram } = calculateMACD(closes);
  const macdLine      = isNaN(macd[n])      ? 0 : macd[n];
  const macdSignal    = isNaN(signal[n])    ? 0 : signal[n];
  const macdHistogram = isNaN(histogram[n]) ? 0 : histogram[n];

  // Bollinger Bands
  const { upper, middle, lower } = calculateBollingerBands(closes, 20);
  const bollingerUpper  = isNaN(upper[n])  ? currentPrice * 1.02 : upper[n];
  const bollingerMiddle = isNaN(middle[n]) ? currentPrice        : middle[n];
  const bollingerLower  = isNaN(lower[n])  ? currentPrice * 0.98 : lower[n];

  // ATR
  const atrArr = calculateATR(highs, lows, closes, 14);
  const atr14  = isNaN(atrArr[n]) ? 0 : atrArr[n];

  // Volume ratio: today vs 20-day average
  const slice20     = volumes.slice(Math.max(0, n - 20), n);
  const avgVolume   = slice20.reduce((a, b) => a + b, 0) / (slice20.length || 1);
  const volumeRatio = avgVolume > 0 ? volumes[n] / avgVolume : 1;

  // ── Human-readable signals ────────────────────────────────────────────────
  const signals: string[] = [];

  if (rsi14 >= 75)      signals.push(`RSI ${rsi14.toFixed(0)} — heavily overbought`);
  else if (rsi14 >= 70) signals.push(`RSI ${rsi14.toFixed(0)} — overbought`);
  else if (rsi14 <= 25) signals.push(`RSI ${rsi14.toFixed(0)} — heavily oversold`);
  else if (rsi14 <= 30) signals.push(`RSI ${rsi14.toFixed(0)} — oversold`);
  else                  signals.push(`RSI ${rsi14.toFixed(0)} — neutral`);

  if (ema200 !== null) {
    if (currentPrice > ema200) signals.push('Above EMA200 — long-term uptrend');
    else signals.push('Below EMA200 — long-term downtrend');
  }

  if (currentPrice > ema50) signals.push('Above EMA50 — medium-term bullish');
  else signals.push('Below EMA50 — medium-term bearish');

  if (macdHistogram > 0) {
    if (macdHistogram > Math.abs(macdLine) * 0.1)
      signals.push('MACD bullish crossover / positive momentum');
    else
      signals.push('MACD histogram positive — mild bullish');
  } else {
    signals.push('MACD histogram negative — bearish momentum');
  }

  if (volumeRatio >= 2.5) signals.push(`Volume ${volumeRatio.toFixed(1)}x avg — exceptional activity`);
  else if (volumeRatio >= 1.5) signals.push(`Volume ${volumeRatio.toFixed(1)}x avg — elevated`);

  const bbRange = bollingerUpper - bollingerLower;
  if (bbRange > 0) {
    const bbPct = (currentPrice - bollingerLower) / bbRange;
    if (bbPct >= 0.90) signals.push('Near Bollinger upper band — stretched upside');
    else if (bbPct <= 0.10) signals.push('Near Bollinger lower band — stretched downside');
  }

  // ── Trend score ──────────────────────────────────────────────────────────
  let score = 0;
  if (ema200 !== null && currentPrice > ema200) score += 2;
  if (currentPrice > ema50)       score += 2;
  if (currentPrice > ema20)       score += 1;
  if (macdHistogram > 0)          score += 1;
  if (rsi14 > 50 && rsi14 < 70)  score += 1;
  if (change1d > 0)               score += 1;

  const trend: TechnicalSnapshot['trend'] =
    score >= 7 ? 'strongly_bullish' :
    score >= 5 ? 'bullish' :
    score >= 3 ? 'neutral' :
    score >= 1 ? 'bearish' : 'strongly_bearish';

  return {
    symbol,
    currentPrice:    parseFloat(currentPrice.toFixed(2)),
    change1d:        parseFloat(change1d.toFixed(2)),
    rsi14:           parseFloat(rsi14.toFixed(1)),
    ema20:           parseFloat(ema20.toFixed(2)),
    ema50:           parseFloat(ema50.toFixed(2)),
    ema200:          ema200 !== null ? parseFloat(ema200.toFixed(2)) : null,
    macdLine:        parseFloat(macdLine.toFixed(4)),
    macdSignal:      parseFloat(macdSignal.toFixed(4)),
    macdHistogram:   parseFloat(macdHistogram.toFixed(4)),
    bollingerUpper:  parseFloat(bollingerUpper.toFixed(2)),
    bollingerMiddle: parseFloat(bollingerMiddle.toFixed(2)),
    bollingerLower:  parseFloat(bollingerLower.toFixed(2)),
    atr14:           parseFloat(atr14.toFixed(2)),
    volumeRatio:     parseFloat(volumeRatio.toFixed(2)),
    trend,
    signals,
    dataPoints: prices.length,
    updatedAt: Date.now(),
  };
}

// ─── Batch Operations ─────────────────────────────────────────────────────────

export const WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN',
  'TSLA', 'META', 'AMD', 'INTC', 'CRWD', 'PLTR',
];

/**
 * Fetches fresh OHLCV for all watchlist symbols.
 * Uses a small delay between requests to avoid Yahoo rate limiting.
 */
export async function refreshAllPriceHistory(): Promise<void> {
  console.log('[Technicals] Starting OHLCV refresh for all symbols...');
  let total = 0;
  for (const symbol of WATCHLIST) {
    const stored = await fetchAndStoreOHLCV(symbol, 6);
    total += stored;
    // Keep spacing conservative for free providers and avoid API bursts.
    await new Promise(r => setTimeout(r, 900));
  }
  console.log(`[Technicals] Refresh complete. Total rows stored: ${total}`);
}

/**
 * Returns technical snapshots for all watchlist symbols in one call.
 * Called by the frontend before each Gemini analysis cycle.
 */
export function getAllTechnicalSnapshots(): Record<string, TechnicalSnapshot | null> {
  const result: Record<string, TechnicalSnapshot | null> = {};
  for (const symbol of WATCHLIST) {
    result[symbol] = computeTechnicalSnapshot(symbol);
  }
  return result;
}

/**
 * Formats all snapshots into a compact string for injection into Gemini prompts.
 */
export function formatSnapshotsForPrompt(
  snapshots: Record<string, TechnicalSnapshot | null>
): string {
  const lines: string[] = [];

  for (const [symbol, snap] of Object.entries(snapshots)) {
    if (!snap) {
      lines.push(`${symbol.padEnd(5)} │ No technical data yet`);
      continue;
    }

    const changeStr = (snap.change1d >= 0 ? '+' : '') + snap.change1d.toFixed(2) + '%';
    const trendStr  = snap.trend.replace(/_/g, ' ').padEnd(17);
    const topSignals = snap.signals.slice(0, 3).join(' | ');

    lines.push(
      `${symbol.padEnd(5)} │ $${snap.currentPrice.toFixed(2).padStart(9)} │ ${changeStr.padStart(7)} │ RSI: ${snap.rsi14.toFixed(0).padStart(3)} │ ${trendStr} │ ${topSignals}`
    );
  }

  return lines.join('\n');
}
