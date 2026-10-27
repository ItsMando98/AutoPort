/**
 * Multi-Timeframe Analysis
 *
 * Aggregates daily OHLCV → weekly closes and computes higher-timeframe
 * indicators (RSI-14w, EMA-20w, MACD). This eliminates daily noise and
 * gives the agent true trend context:
 *
 * "Daily RSI 74 (overbought) but Weekly RSI 55 (neutral, still trending) →
 *  don't exit, but reduce position size or wait for better entry"
 *
 * No extra API calls — computed entirely from price_history table.
 */

import db from './db.js';
import { calculateEMA, calculateRSI, calculateMACD } from './technicals.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WeeklyTrend = 'up' | 'neutral' | 'down';
export type MultiframeTrend =
  | 'confirmed_bull'   // both daily & weekly bullish
  | 'bull_caution'     // daily bullish but weekly lagging
  | 'neutral'
  | 'bear_caution'     // daily bearish but weekly still ok
  | 'confirmed_bear';  // both timeframes bearish

export interface WeeklySnapshot {
  symbol:          string;
  weeklyRSI:       number | null;    // 14-week RSI
  weeklyEMA20:     number | null;    // 20-week EMA
  weeklyMACD:      number | null;    // MACD histogram on weekly
  weeklyAboveEMA: boolean | null;   // price above 20w EMA?
  weeklyTrend:     WeeklyTrend;
  monthlyAboveEMA: boolean | null;   // price above 10-week EMA (rough monthly)
  multiframeTrend: MultiframeTrend;
  confluence:      'high' | 'medium' | 'low';
  dataWeeks:       number;           // how many weeks of data available
}

// ─── Weekly Close Aggregation ─────────────────────────────────────────────────

/**
 * Returns weekly close prices by taking the last close of each ISO week.
 * Pure in-memory — no extra DB schema needed.
 */
function getWeeklyCloses(symbol: string): { weekStart: string; close: number }[] {
  const rows = db.prepare(`
    SELECT date, close FROM price_history
    WHERE symbol = ? ORDER BY date ASC
  `).all(symbol) as { date: string; close: number }[];

  if (rows.length === 0) return [];

  const weeks = new Map<string, { weekStart: string; close: number }>();

  for (const row of rows) {
    const wk = getISOWeekKey(row.date);
    // Overwrite each time — last entry per week = weekly close
    if (!weeks.has(wk)) {
      weeks.set(wk, { weekStart: row.date, close: row.close });
    } else {
      weeks.get(wk)!.close = row.close; // update to latest in week
    }
  }

  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // avoid timezone offset issues
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setUTCDate(jan4.getUTCDate() - jan4.getUTCDay() + 1);
  const diffMs = d.getTime() - startOfWeek1.getTime();
  const week = Math.floor(diffMs / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// ─── Snapshot Computation ─────────────────────────────────────────────────────

export function computeWeeklySnapshot(symbol: string): WeeklySnapshot | null {
  const weekly = getWeeklyCloses(symbol);
  if (weekly.length < 15) return null; // need at least 15 weeks

  const closes = weekly.map(w => w.close);
  const n = closes.length - 1;

  // Weekly RSI (14 periods)
  const rsiArr = calculateRSI(closes, 14);
  const weeklyRSI = isNaN(rsiArr[n]) ? null : parseFloat(rsiArr[n].toFixed(1));

  // Weekly EMA-20 (≈ 5-month moving average)
  const ema20Arr = calculateEMA(closes, 20);
  const weeklyEMA20 = isNaN(ema20Arr[n]) ? null : parseFloat(ema20Arr[n].toFixed(2));

  // Weekly EMA-10 (≈ 2.5-month — proxy for "monthly" trend)
  const ema10Arr = calculateEMA(closes, 10);
  const ema10 = isNaN(ema10Arr[n]) ? null : ema10Arr[n];

  // Weekly MACD
  const { histogram } = calculateMACD(closes);
  const weeklyMACD = isNaN(histogram[n]) ? null : parseFloat(histogram[n].toFixed(4));

  const currentPrice = closes[n];
  const weeklyAboveEMA = weeklyEMA20 !== null ? currentPrice > weeklyEMA20 : null;
  const monthlyAboveEMA = ema10 !== null ? currentPrice > ema10 : null;

  // Determine weekly trend
  let weeklyTrend: WeeklyTrend = 'neutral';
  if (weeklyRSI !== null && weeklyMACD !== null) {
    const bullishSignals = [
      weeklyRSI > 50,
      weeklyMACD > 0,
      weeklyAboveEMA === true,
    ].filter(Boolean).length;
    weeklyTrend = bullishSignals >= 2 ? 'up' : bullishSignals === 0 ? 'down' : 'neutral';
  }

  // Determine multi-timeframe trend (requires daily snapshot from technicals)
  const dailyRow = db.prepare(`
    SELECT close FROM price_history WHERE symbol = ? ORDER BY date DESC LIMIT 1
  `).get(symbol) as any;
  const dailyPrice = dailyRow?.close ?? currentPrice;

  // Simple daily trend proxy from price vs short EMAs
  const ema5daily = calculateEMA(
    (db.prepare('SELECT close FROM price_history WHERE symbol = ? ORDER BY date ASC LIMIT 20').all(symbol) as any[]).map(r => r.close),
    5
  );
  const dailyAbove = ema5daily.length > 0 && !isNaN(ema5daily[ema5daily.length - 1])
    ? dailyPrice > ema5daily[ema5daily.length - 1]
    : null;

  let multiframeTrend: MultiframeTrend = 'neutral';
  if (weeklyTrend === 'up' && dailyAbove === true)   multiframeTrend = 'confirmed_bull';
  else if (weeklyTrend === 'up' && dailyAbove === false) multiframeTrend = 'bull_caution';
  else if (weeklyTrend === 'down' && dailyAbove === false) multiframeTrend = 'confirmed_bear';
  else if (weeklyTrend === 'down' && dailyAbove === true)  multiframeTrend = 'bear_caution';

  const confluence: 'high' | 'medium' | 'low' =
    multiframeTrend === 'confirmed_bull' || multiframeTrend === 'confirmed_bear' ? 'high' :
    multiframeTrend === 'neutral' ? 'medium' : 'low';

  return {
    symbol,
    weeklyRSI,
    weeklyEMA20,
    weeklyMACD,
    weeklyAboveEMA,
    weeklyTrend,
    monthlyAboveEMA,
    multiframeTrend,
    confluence,
    dataWeeks: weekly.length,
  };
}

export function getAllWeeklySnapshots(symbols: string[]): Record<string, WeeklySnapshot | null> {
  const result: Record<string, WeeklySnapshot | null> = {};
  for (const sym of symbols) {
    result[sym] = computeWeeklySnapshot(sym);
  }
  return result;
}

// ─── Prompt Formatting ────────────────────────────────────────────────────────

const TREND_ARROW: Record<string, string> = {
  up: '↑', neutral: '→', down: '↓',
};
const MULTIFRAME_LABEL: Record<MultiframeTrend, string> = {
  confirmed_bull: 'D+W bullish (confirmed)',
  bull_caution:   'Weekly up, daily lagging',
  neutral:        'Mixed signals',
  bear_caution:   'Weekly down, daily bouncing',
  confirmed_bear: 'D+W bearish (confirmed)',
};

export function formatWeeklyForPrompt(
  snapshots: Record<string, WeeklySnapshot | null>,
  targetSymbols: string[]
): string {
  const lines: string[] = [];

  for (const sym of targetSymbols) {
    const s = snapshots[sym];
    if (!s) {
      lines.push(`${sym.padEnd(5)} | Insufficient weekly data`);
      continue;
    }
    const rsiStr  = s.weeklyRSI !== null
      ? `W-RSI:${s.weeklyRSI.toFixed(0).padStart(3)}`
      : 'W-RSI: N/A';
    const trendStr = `W-Trend:${TREND_ARROW[s.weeklyTrend]}`;
    const ema      = s.weeklyAboveEMA === true ? 'above W-EMA20' : s.weeklyAboveEMA === false ? 'below W-EMA20' : '';
    const mfLabel  = MULTIFRAME_LABEL[s.multiframeTrend];

    lines.push(`${sym.padEnd(5)} | ${rsiStr} | ${trendStr} | ${mfLabel}${ema ? ' | ' + ema : ''}`);
  }

  const calibration = [
    '• Daily bullish + weekly up → full confidence (confirmed)',
    '• Daily bullish + weekly down → reduce position 50% (divergence)',
    '• Daily overbought (RSI>70) + weekly RSI < 60 → wait for pullback, not emergency exit',
    '• Confirmed bear (both timeframes) → no BUY, consider SELL',
  ].join('\n');

  return lines.join('\n') + '\n\nCALIBRATION:\n' + calibration;
}
