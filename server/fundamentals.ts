/**
 * Fundamental Data Module — powered by SEC EDGAR (free, official US government API)
 *
 * Data sources:
 * - SEC EDGAR company facts API: EPS, Revenue, Net Income, Shares Outstanding
 * - Yahoo Finance v8 chart meta: 52-week High/Low (reuses existing OHLCV channel)
 *
 * Derived metrics:
 * - P/E = currentPrice / trailingEPS
 * - Market Cap = currentPrice × sharesOutstanding
 * - Profit Margin = NetIncome / Revenue
 * - Revenue Growth = (currentRevenue - priorRevenue) / priorRevenue
 */

import db from './db.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

// EDGAR requires User-Agent with contact info
const EDGAR_HEADERS = {
  'User-Agent': 'AutonomesPortfolioManager contact@example.com',
  'Accept': 'application/json',
};

export interface FundamentalData {
  symbol: string;
  peRatio: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  marketCap: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  freeCashFlow: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: number;
}

export interface EarningsEvent {
  symbol: string;
  earningsDate: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  daysUntil: number;
}

// ─── CIK Mapping (loaded once, cached in memory) ─────────────────────────────

let cikMap: Record<string, number> | null = null;

async function loadCIKMap(): Promise<Record<string, number>> {
  if (cikMap) return cikMap;
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: EDGAR_HEADERS,
    });
    if (!res.ok) throw new Error(`EDGAR tickers ${res.status}`);
    const data = await res.json();
    const map: Record<string, number> = {};
    for (const entry of Object.values(data) as any[]) {
      map[entry.ticker.toUpperCase()] = entry.cik_str;
    }
    cikMap = map;
    markDataSourceSuccess('fundamentals_cik', Object.keys(map).length);
    console.log(`[Fundamentals] Loaded ${Object.keys(map).length} ticker→CIK mappings`);
    return map;
  } catch (err: any) {
    console.error('[Fundamentals] Failed to load CIK map:', err?.message);
    markDataSourceFailure('fundamentals_cik', err?.message ?? 'Failed to load CIK map');
    return {};
  }
}

// ─── EDGAR Company Facts ──────────────────────────────────────────────────────

interface EDGARFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

async function getCompanyFacts(cik: number): Promise<Record<string, any> | null> {
  try {
    const cikPadded = String(cik).padStart(10, '0');
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded}.json`;
    const res = await fetch(url, { headers: EDGAR_HEADERS });
    if (!res.ok) throw new Error(`EDGAR facts ${res.status} for CIK ${cik}`);
    const data = await res.json();
    return data?.facts ?? null;
  } catch (err: any) {
    console.error('[Fundamentals] EDGAR company facts error:', err?.message);
    return null;
  }
}

/**
 * Extracts the latest annual (10-K) value for a GAAP concept.
 * Falls back to the latest quarterly (10-Q) if no 10-K available.
 */
function getLatestAnnualValue(
  facts: Record<string, any>,
  namespace: 'us-gaap' | 'dei',
  concept: string,
  unit: string
): EDGARFact | null {
  const data = facts?.[namespace]?.[concept]?.units?.[unit] as EDGARFact[] | undefined;
  if (!data?.length) return null;

  // Prefer full-year (FY) 10-K filings
  const annual = data.filter(f => f.form === '10-K' && f.fp === 'FY');
  if (annual.length > 0) {
    return annual.sort((a, b) => b.end.localeCompare(a.end))[0];
  }

  // Fall back to any 10-K
  const anyAnnual = data.filter(f => f.form === '10-K');
  if (anyAnnual.length > 0) {
    return anyAnnual.sort((a, b) => b.end.localeCompare(a.end))[0];
  }

  // Fall back to latest 10-Q
  const quarterly = data.filter(f => f.form === '10-Q');
  if (quarterly.length > 0) {
    return quarterly.sort((a, b) => b.end.localeCompare(a.end))[0];
  }

  return null;
}

/** Computes TTM (trailing 12 months) revenue by summing the last 4 quarterly values. */
function getTTMRevenue(facts: Record<string, any>): number | null {
  const revConcepts = [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ];

  for (const concept of revConcepts) {
    const data = facts?.['us-gaap']?.[concept]?.units?.['USD'] as EDGARFact[] | undefined;
    if (!data?.length) continue;

    // Get the last 4 distinct quarterly (10-Q) periods
    const quarterly = data
      .filter(f => f.form === '10-Q' && f.fp && f.fp.startsWith('Q'))
      .sort((a, b) => b.end.localeCompare(a.end));

    if (quarterly.length >= 4) {
      const ttm = quarterly.slice(0, 4).reduce((sum, q) => sum + q.val, 0);
      return ttm;
    }

    // Fall back to latest annual value
    const annual = getLatestAnnualValue(facts, 'us-gaap', concept, 'USD');
    if (annual) return annual.val;
  }
  return null;
}

/** Estimates next earnings date from recent 10-Q/10-K filing dates + ~90 days. */
function estimateNextEarningsDate(facts: Record<string, any>): Date | null {
  const allForms: { filed: string; form: string }[] = [];

  // Collect filing dates from any concept
  const gaap = facts?.['us-gaap'] ?? {};
  for (const concept of Object.values(gaap) as any[]) {
    const units = concept?.units ?? {};
    for (const entries of Object.values(units) as EDGARFact[][]) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if ((e.form === '10-Q' || e.form === '10-K') && e.filed) {
          allForms.push({ filed: e.filed, form: e.form });
        }
      }
    }
    break; // Only need dates from one concept
  }

  if (allForms.length === 0) return null;

  // Sort by filed date, get most recent
  const sorted = allForms
    .filter((v, i, arr) => arr.findIndex(x => x.filed === v.filed) === i) // unique
    .sort((a, b) => b.filed.localeCompare(a.filed));

  const latestFiling = sorted[0];
  if (!latestFiling) return null;

  // Next earnings ≈ latest filing date + 90 days (quarterly cadence)
  const lastFiled = new Date(latestFiling.filed);
  const nextEarnings = new Date(lastFiled.getTime() + 90 * 24 * 60 * 60 * 1000);

  // If projected date is in the past, project another 90 days
  const now = new Date();
  if (nextEarnings <= now) {
    return new Date(nextEarnings.getTime() + 90 * 24 * 60 * 60 * 1000);
  }
  return nextEarnings;
}

// ─── 52-Week Data from stored price history ───────────────────────────────────

/**
 * Reads 52-week high/low directly from our own price_history table.
 * No external API needed — uses data already fetched by Polygon.io.
 */
function get52WeekData(symbol: string): { high: number | null; low: number | null } {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoff = oneYearAgo.toISOString().split('T')[0];

  const row = db.prepare(`
    SELECT MAX(high) AS week52_high, MIN(low) AS week52_low
    FROM price_history
    WHERE symbol = ? AND date >= ?
  `).get(symbol, cutoff) as any;

  return {
    high: row?.week52_high ?? null,
    low:  row?.week52_low  ?? null,
  };
}

// ─── Current Price from DB ────────────────────────────────────────────────────

function getCurrentPrice(symbol: string): number | null {
  const row = db.prepare(
    'SELECT close FROM price_history WHERE symbol = ? ORDER BY date DESC LIMIT 1'
  ).get(symbol) as any;
  return row?.close ?? null;
}

// ─── Main Fetcher ─────────────────────────────────────────────────────────────

export async function fetchFundamentals(symbol: string): Promise<FundamentalData | null> {
  console.log(`[Fundamentals] Fetching ${symbol} from SEC EDGAR...`);

  const map = await loadCIKMap();
  const cik = map[symbol.toUpperCase()];
  if (!cik) {
    console.error(`[Fundamentals] No CIK found for ${symbol}`);
    markDataSourceFailure('fundamentals', `No CIK found for ${symbol}`, { symbol });
    return null;
  }

  const facts = await getCompanyFacts(cik);
  const weekData = get52WeekData(symbol);

  if (!facts) {
    markDataSourceFailure('fundamentals', `No EDGAR facts for ${symbol}`, { symbol });
    return null;
  }

  // ── Extract metrics ────────────────────────────────────────────────────────
  const currentPrice = getCurrentPrice(symbol);

  // Trailing EPS (diluted)
  const epsEntry = getLatestAnnualValue(facts, 'us-gaap', 'EarningsPerShareDiluted', 'USD/shares');
  const epsTrailing = epsEntry?.val ?? null;

  // TTM Revenue for growth calculation
  const revEntry = getLatestAnnualValue(
    facts, 'us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'USD'
  ) ?? getLatestAnnualValue(facts, 'us-gaap', 'Revenues', 'USD')
    ?? getLatestAnnualValue(facts, 'us-gaap', 'SalesRevenueNet', 'USD');

  const currentRevenue = revEntry?.val ?? getTTMRevenue(facts);

  // Prior year revenue (for growth calculation)
  const revenueGrowth = (() => {
    const revConcepts = [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
    ];
    for (const concept of revConcepts) {
      const data = facts?.['us-gaap']?.[concept]?.units?.['USD'] as EDGARFact[] | undefined;
      if (!data?.length) continue;
      const annuals = data
        .filter(f => f.form === '10-K' && f.fp === 'FY')
        .sort((a, b) => b.end.localeCompare(a.end));
      if (annuals.length >= 2) {
        const curr = annuals[0].val;
        const prev = annuals[1].val;
        if (prev > 0) return (curr - prev) / prev;
      }
    }
    return null;
  })();

  // Net Income
  const niEntry = getLatestAnnualValue(facts, 'us-gaap', 'NetIncomeLoss', 'USD');
  const netIncome = niEntry?.val ?? null;

  // Profit Margin
  const profitMargin = currentRevenue && netIncome !== null && currentRevenue > 0
    ? netIncome / currentRevenue
    : null;

  // Shares Outstanding
  const sharesEntry = getLatestAnnualValue(facts, 'dei', 'EntityCommonStockSharesOutstanding', 'shares');
  const shares = sharesEntry?.val ?? null;

  // Balance sheet ratios — same EDGAR company-facts call, previously discarded.
  const totalLiabilities = getLatestAnnualValue(facts, 'us-gaap', 'Liabilities', 'USD')?.val ?? null;
  const stockholdersEquity = getLatestAnnualValue(facts, 'us-gaap', 'StockholdersEquity', 'USD')?.val
    ?? getLatestAnnualValue(facts, 'us-gaap', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'USD')?.val
    ?? null;
  const debtToEquity = totalLiabilities !== null && stockholdersEquity !== null && stockholdersEquity !== 0
    ? totalLiabilities / stockholdersEquity
    : null;

  const currentAssets = getLatestAnnualValue(facts, 'us-gaap', 'AssetsCurrent', 'USD')?.val ?? null;
  const currentLiabilities = getLatestAnnualValue(facts, 'us-gaap', 'LiabilitiesCurrent', 'USD')?.val ?? null;
  const currentRatio = currentAssets !== null && currentLiabilities !== null && currentLiabilities !== 0
    ? currentAssets / currentLiabilities
    : null;

  // Free cash flow — operating cash flow minus capex, both standard XBRL tags.
  const operatingCashFlow = getLatestAnnualValue(facts, 'us-gaap', 'NetCashProvidedByUsedInOperatingActivities', 'USD')?.val ?? null;
  const capex = getLatestAnnualValue(facts, 'us-gaap', 'PaymentsToAcquirePropertyPlantAndEquipment', 'USD')?.val ?? null;
  const freeCashFlow = operatingCashFlow !== null
    ? operatingCashFlow - (capex ?? 0)
    : null;

  // Derived: P/E and Market Cap
  const peRatio = currentPrice && epsTrailing ? currentPrice / epsTrailing : null;
  const marketCap = currentPrice && shares ? currentPrice * shares : null;

  const data: FundamentalData = {
    symbol,
    peRatio:        peRatio   !== null  ? parseFloat(peRatio.toFixed(2))   : null,
    forwardPE:      null,  // requires analyst estimates (not in EDGAR)
    pegRatio:       null,  // requires growth + P/E (skipped for now)
    epsTrailing:    epsTrailing !== null ? parseFloat(epsTrailing.toFixed(2)) : null,
    epsForward:     null,  // requires analyst estimates
    marketCap:      marketCap !== null  ? Math.round(marketCap)             : null,
    revenueGrowth:  revenueGrowth !== null ? parseFloat(revenueGrowth.toFixed(4)) : null,
    earningsGrowth: null,  // requires multi-period EPS comparison
    profitMargin:   profitMargin !== null ? parseFloat(profitMargin.toFixed(4)) : null,
    debtToEquity:   debtToEquity !== null ? parseFloat(debtToEquity.toFixed(4)) : null,
    currentRatio:   currentRatio !== null ? parseFloat(currentRatio.toFixed(4)) : null,
    freeCashFlow:   freeCashFlow !== null ? Math.round(freeCashFlow) : null,
    beta:           null,  // requires market data correlation — not sourced from EDGAR
    week52High:     weekData.high,
    week52Low:      weekData.low,
    updatedAt:      Date.now(),
  };

  // Persist to DB
  db.prepare(`
    INSERT INTO fundamentals
      (symbol, pe_ratio, forward_pe, peg_ratio, eps_trailing, eps_forward,
       market_cap, revenue_growth, earnings_growth, profit_margin,
       debt_to_equity, current_ratio, free_cash_flow, beta, week52_high, week52_low, updated_at)
    VALUES
      (@symbol, @pe_ratio, @forward_pe, @peg_ratio, @eps_trailing, @eps_forward,
       @market_cap, @revenue_growth, @earnings_growth, @profit_margin,
       @debt_to_equity, @current_ratio, @free_cash_flow, @beta, @week52_high, @week52_low, unixepoch())
    ON CONFLICT(symbol) DO UPDATE SET
      pe_ratio        = excluded.pe_ratio,
      forward_pe      = excluded.forward_pe,
      eps_trailing    = excluded.eps_trailing,
      market_cap      = excluded.market_cap,
      revenue_growth  = excluded.revenue_growth,
      profit_margin   = excluded.profit_margin,
      debt_to_equity  = excluded.debt_to_equity,
      current_ratio   = excluded.current_ratio,
      free_cash_flow  = excluded.free_cash_flow,
      week52_high     = excluded.week52_high,
      week52_low      = excluded.week52_low,
      updated_at      = unixepoch()
  `).run({
    symbol,
    pe_ratio:        data.peRatio,
    forward_pe:      null,
    peg_ratio:       null,
    eps_trailing:    data.epsTrailing,
    eps_forward:     null,
    market_cap:      data.marketCap,
    revenue_growth:  data.revenueGrowth,
    earnings_growth: null,
    profit_margin:   data.profitMargin,
    debt_to_equity:  data.debtToEquity,
    current_ratio:   data.currentRatio,
    free_cash_flow:  data.freeCashFlow,
    beta:            null,
    week52_high:     data.week52High,
    week52_low:      data.week52Low,
  });

  // Store estimated next earnings date
  const nextEarnings = estimateNextEarningsDate(facts);
  if (nextEarnings && nextEarnings > new Date()) {
    const ts = Math.floor(nextEarnings.getTime() / 1000);
    db.prepare(`
      INSERT OR IGNORE INTO earnings_calendar (symbol, earnings_date, eps_estimate, revenue_estimate)
      VALUES (@symbol, @earnings_date, @eps_estimate, @revenue_estimate)
    `).run({
      symbol,
      earnings_date:     ts,
      eps_estimate:      epsTrailing,   // use trailing as rough estimate
      revenue_estimate:  currentRevenue ? Math.round(currentRevenue / 4) : null, // quarterly estimate
    });
    console.log(`[Fundamentals] ${symbol}: P/E=${data.peRatio?.toFixed(1) ?? 'N/A'}, Rev Growth=${data.revenueGrowth !== null ? (data.revenueGrowth * 100).toFixed(1) + '%' : 'N/A'}, Next Earnings ≈ ${nextEarnings.toDateString()}`);
  } else {
    console.log(`[Fundamentals] ${symbol}: P/E=${data.peRatio?.toFixed(1) ?? 'N/A'}, Rev Growth=${data.revenueGrowth !== null ? (data.revenueGrowth * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  markDataSourceSuccess('fundamentals', 1, { symbol });
  return data;
}

// ─── DB Reads ─────────────────────────────────────────────────────────────────

export function getFundamentals(symbol: string): FundamentalData | null {
  const row = db.prepare('SELECT * FROM fundamentals WHERE symbol = ?').get(symbol) as any;
  if (!row) return null;
  return rowToFundamental(row);
}

export function getAllFundamentals(): Record<string, FundamentalData> {
  const rows = db.prepare('SELECT * FROM fundamentals').all() as any[];
  const result: Record<string, FundamentalData> = {};
  for (const row of rows) result[row.symbol] = rowToFundamental(row);
  return result;
}

function rowToFundamental(row: any): FundamentalData {
  return {
    symbol:         row.symbol,
    peRatio:        row.pe_ratio,
    forwardPE:      row.forward_pe,
    pegRatio:       row.peg_ratio,
    epsTrailing:    row.eps_trailing,
    epsForward:     row.eps_forward,
    marketCap:      row.market_cap,
    revenueGrowth:  row.revenue_growth,
    earningsGrowth: row.earnings_growth,
    profitMargin:   row.profit_margin,
    debtToEquity:   row.debt_to_equity,
    currentRatio:   row.current_ratio,
    freeCashFlow:   row.free_cash_flow,
    beta:           row.beta,
    week52High:     row.week52_high,
    week52Low:      row.week52_low,
    updatedAt:      row.updated_at * 1000,
  };
}

// ─── Earnings Calendar ────────────────────────────────────────────────────────

export function getUpcomingEarnings(daysAhead = 14): EarningsEvent[] {
  const now    = Math.floor(Date.now() / 1000);
  const cutoff = now + daysAhead * 86400;
  const rows = db.prepare(`
    SELECT * FROM earnings_calendar
    WHERE earnings_date >= @now AND earnings_date <= @cutoff
    ORDER BY earnings_date ASC
  `).all({ now, cutoff }) as any[];
  return rows.map(r => ({
    symbol:          r.symbol,
    earningsDate:    r.earnings_date * 1000,
    epsEstimate:     r.eps_estimate,
    revenueEstimate: r.revenue_estimate,
    daysUntil:       Math.round((r.earnings_date - now) / 86400),
  }));
}

export function getEarningsForSymbol(symbol: string, daysAhead = 30): EarningsEvent | null {
  const now    = Math.floor(Date.now() / 1000);
  const cutoff = now + daysAhead * 86400;
  const row = db.prepare(`
    SELECT * FROM earnings_calendar
    WHERE symbol = ? AND earnings_date >= ? AND earnings_date <= ?
    ORDER BY earnings_date ASC LIMIT 1
  `).get(symbol, now, cutoff) as any;
  if (!row) return null;
  return {
    symbol:          row.symbol,
    earningsDate:    row.earnings_date * 1000,
    epsEstimate:     row.eps_estimate,
    revenueEstimate: row.revenue_estimate,
    daysUntil:       Math.round((row.earnings_date - now) / 86400),
  };
}

// ─── Prompt Formatting ────────────────────────────────────────────────────────

export function formatFundamentalsRow(symbol: string): string {
  const f = getFundamentals(symbol);
  const earn = getEarningsForSymbol(symbol, 30);

  if (!f) return `${symbol.padEnd(5)} | No SEC data yet`;

  const pe  = f.peRatio !== null ? f.peRatio.toFixed(0).padStart(5) : '  N/A';
  const rev = f.revenueGrowth !== null
    ? ((f.revenueGrowth >= 0 ? '+' : '') + (f.revenueGrowth * 100).toFixed(0) + '%').padStart(6)
    : '   N/A';
  const eps = f.epsTrailing !== null ? ('$' + f.epsTrailing.toFixed(2)).padStart(7) : '    N/A';
  const margin = f.profitMargin !== null
    ? (f.profitMargin * 100).toFixed(0) + '%'
    : 'N/A';
  const earnStr = earn
    ? `⚠ Earnings in ${earn.daysUntil}d`
    : '';

  return `${symbol.padEnd(5)} | P/E:${pe} | Rev:${rev} | EPS:${eps} | Margin:${margin.padStart(4)}${earnStr ? ' | ' + earnStr : ''}`;
}

// ─── Batch Refresh ────────────────────────────────────────────────────────────

export async function refreshAllFundamentals(symbols: string[]): Promise<void> {
  console.log('[Fundamentals] Starting EDGAR refresh...');
  for (const symbol of symbols) {
    await fetchFundamentals(symbol);
    // 500ms between requests to respect EDGAR rate limits (10 req/s)
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[Fundamentals] EDGAR refresh complete');
}

export function needsRefresh(symbol: string): boolean {
  const row = db.prepare(
    'SELECT updated_at FROM fundamentals WHERE symbol = ?'
  ).get(symbol) as any;
  if (!row) return true;
  const ageSeconds = Math.floor(Date.now() / 1000) - row.updated_at;
  return ageSeconds > 7 * 86400; // refresh weekly
}
