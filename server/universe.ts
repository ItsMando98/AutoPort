/**
 * Stock Universe — All tracked symbols organized by sector.
 *
 * CORE_WATCHLIST (11):  Full monitoring — OHLCV, technicals, fundamentals, knowledge profiles.
 * EXTENDED_UNIVERSE (65+): Daily screener — picked up when showing unusual activity.
 *
 * Total: ~75 liquid US stocks across 7 sectors.
 */

// ─── Company Metadata ─────────────────────────────────────────────────────────

export interface CompanyInfo {
  name: string;
  sector: string;
}

export const COMPANY_INFO: Record<string, CompanyInfo> = {
  // ── Core Watchlist (Phase 1) ───────────────────────────────────────────────
  AAPL:  { name: 'Apple Inc.',              sector: 'Technology' },
  MSFT:  { name: 'Microsoft Corp.',         sector: 'Technology' },
  NVDA:  { name: 'NVIDIA Corp.',            sector: 'Technology' },
  GOOGL: { name: 'Alphabet Inc.',           sector: 'Technology' },
  AMZN:  { name: 'Amazon.com Inc.',         sector: 'Consumer Discretionary' },
  TSLA:  { name: 'Tesla Inc.',              sector: 'Consumer Discretionary' },
  META:  { name: 'Meta Platforms Inc.',     sector: 'Technology' },
  AMD:   { name: 'Advanced Micro Devices',  sector: 'Technology' },
  INTC:  { name: 'Intel Corp.',             sector: 'Technology' },
  CRWD:  { name: 'CrowdStrike Holdings',    sector: 'Technology' },
  PLTR:  { name: 'Palantir Technologies',   sector: 'Technology' },

  // ── Extended: Technology ──────────────────────────────────────────────────
  NFLX:  { name: 'Netflix Inc.',            sector: 'Communication Services' },
  ORCL:  { name: 'Oracle Corp.',            sector: 'Technology' },
  QCOM:  { name: 'Qualcomm Inc.',           sector: 'Technology' },
  TXN:   { name: 'Texas Instruments',       sector: 'Technology' },
  MU:    { name: 'Micron Technology',       sector: 'Technology' },
  AVGO:  { name: 'Broadcom Inc.',           sector: 'Technology' },
  CRM:   { name: 'Salesforce Inc.',         sector: 'Technology' },
  ADBE:  { name: 'Adobe Inc.',              sector: 'Technology' },
  NOW:   { name: 'ServiceNow Inc.',         sector: 'Technology' },
  SNOW:  { name: 'Snowflake Inc.',          sector: 'Technology' },
  UBER:  { name: 'Uber Technologies',       sector: 'Technology' },
  SHOP:  { name: 'Shopify Inc.',            sector: 'Technology' },
  SQ:    { name: 'Block Inc.',              sector: 'Technology' },
  PYPL:  { name: 'PayPal Holdings',         sector: 'Technology' },
  COIN:  { name: 'Coinbase Global',         sector: 'Technology' },
  SMCI:  { name: 'Super Micro Computer',    sector: 'Technology' },
  ARM:   { name: 'Arm Holdings',            sector: 'Technology' },
  MRVL:  { name: 'Marvell Technology',      sector: 'Technology' },
  PANW:  { name: 'Palo Alto Networks',      sector: 'Technology' },
  ZS:    { name: 'Zscaler Inc.',            sector: 'Technology' },

  // ── Extended: Healthcare ──────────────────────────────────────────────────
  JNJ:   { name: 'Johnson & Johnson',       sector: 'Healthcare' },
  UNH:   { name: 'UnitedHealth Group',      sector: 'Healthcare' },
  LLY:   { name: 'Eli Lilly & Co.',         sector: 'Healthcare' },
  ABBV:  { name: 'AbbVie Inc.',             sector: 'Healthcare' },
  MRK:   { name: 'Merck & Co.',             sector: 'Healthcare' },
  TMO:   { name: 'Thermo Fisher Scientific',sector: 'Healthcare' },
  ISRG:  { name: 'Intuitive Surgical',      sector: 'Healthcare' },
  REGN:  { name: 'Regeneron Pharmaceuticals', sector: 'Healthcare' },
  GILD:  { name: 'Gilead Sciences',         sector: 'Healthcare' },
  AMGN:  { name: 'Amgen Inc.',              sector: 'Healthcare' },

  // ── Extended: Financials ─────────────────────────────────────────────────
  JPM:   { name: 'JPMorgan Chase',          sector: 'Financials' },
  BAC:   { name: 'Bank of America',         sector: 'Financials' },
  GS:    { name: 'Goldman Sachs Group',     sector: 'Financials' },
  WFC:   { name: 'Wells Fargo & Co.',       sector: 'Financials' },
  MS:    { name: 'Morgan Stanley',          sector: 'Financials' },
  V:     { name: 'Visa Inc.',               sector: 'Financials' },
  MA:    { name: 'Mastercard Inc.',         sector: 'Financials' },
  AXP:   { name: 'American Express',        sector: 'Financials' },
  BLK:   { name: 'BlackRock Inc.',          sector: 'Financials' },
  SCHW:  { name: 'Charles Schwab Corp.',    sector: 'Financials' },

  // ── Extended: Consumer ────────────────────────────────────────────────────
  COST:  { name: 'Costco Wholesale',        sector: 'Consumer Staples' },
  WMT:   { name: 'Walmart Inc.',            sector: 'Consumer Staples' },
  TGT:   { name: 'Target Corp.',            sector: 'Consumer Discretionary' },
  HD:    { name: 'Home Depot Inc.',         sector: 'Consumer Discretionary' },
  SBUX:  { name: 'Starbucks Corp.',         sector: 'Consumer Discretionary' },
  MCD:   { name: "McDonald's Corp.",        sector: 'Consumer Discretionary' },
  NKE:   { name: 'Nike Inc.',               sector: 'Consumer Discretionary' },
  LULU:  { name: 'Lululemon Athletica',     sector: 'Consumer Discretionary' },

  // ── Extended: Energy ─────────────────────────────────────────────────────
  XOM:   { name: 'ExxonMobil Corp.',        sector: 'Energy' },
  CVX:   { name: 'Chevron Corp.',           sector: 'Energy' },
  COP:   { name: 'ConocoPhillips',          sector: 'Energy' },
  SLB:   { name: 'SLB (Schlumberger)',      sector: 'Energy' },
  OXY:   { name: 'Occidental Petroleum',   sector: 'Energy' },

  // ── Extended: Industrials ────────────────────────────────────────────────
  CAT:   { name: 'Caterpillar Inc.',        sector: 'Industrials' },
  HON:   { name: 'Honeywell International', sector: 'Industrials' },
  GE:    { name: 'GE Aerospace',            sector: 'Industrials' },
  UPS:   { name: 'United Parcel Service',   sector: 'Industrials' },
  BA:    { name: 'Boeing Co.',              sector: 'Industrials' },
  LMT:   { name: 'Lockheed Martin',         sector: 'Industrials' },
};

// ─── Convenience Exports ──────────────────────────────────────────────────────

/** The 11 always-active stocks (full OHLCV + fundamentals + knowledge). */
export const CORE_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN',
  'TSLA', 'META', 'AMD',  'INTC',  'CRWD', 'PLTR',
];

/** All tracked symbols (~75). Screened daily for unusual activity. */
export const ALL_SYMBOLS = Object.keys(COMPANY_INFO);

/** Sector for any symbol. Falls back to 'Other'. */
export function getSector(symbol: string): string {
  return COMPANY_INFO[symbol]?.sector ?? 'Other';
}

/** Company name for any symbol. Falls back to symbol itself. */
export function getCompanyName(symbol: string): string {
  return COMPANY_INFO[symbol]?.name ?? symbol;
}
