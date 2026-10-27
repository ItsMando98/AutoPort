/**
 * Insider Trading Monitor — SEC Form 4
 *
 * Form 4 = "Statement of Changes in Beneficial Ownership"
 * Filed by company insiders (CEO, CFO, Directors, 10%+ shareholders) within
 * 2 business days of any transaction. Completely free via SEC EDGAR.
 *
 * Why this matters:
 *   CEO buys $5M of own stock  → strongest possible bullish signal
 *   CFO sells all shares       → serious red flag
 *   Multiple insiders buying   → high-conviction opportunity
 *
 * Data flow:
 *   EDGAR submissions API → find Form 4 accession numbers
 *   → fetch XML document → parse transaction details → store in DB
 *   → inject into Gemini prompt as Section 8
 */

import db from './db.js';
import { fetchRecentForm4sViaSECApi } from './filings.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

const EDGAR_HEADERS = {
  'User-Agent': 'AutonomesPortfolioManager contact@example.com',
  'Accept': 'application/json, application/xml, text/html',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsiderSignificance =
  | 'very_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'very_bearish';

export interface InsiderTrade {
  id:              string;       // accession number
  symbol:          string;
  cik:             string;
  filerName:       string;
  filerTitle:      string;
  transactionDate: string;       // YYYY-MM-DD
  transactionType: string;       // P, S, M, F, A
  shares:          number;
  pricePerShare:   number;
  totalValue:      number;
  acquiredDisposed: string;      // A or D
  significance:    InsiderSignificance;
  filingUrl:       string;
}

// ─── XML Parsing Helpers ──────────────────────────────────────────────────────

/** Extract a value from EDGAR Form 4 XML (handles both direct text and <value> child) */
function xmlVal(xml: string, tag: string): string | null {
  // Try <tag><value>X</value></tag> pattern first
  let m = xml.match(new RegExp(`<${tag}[^>]*>\\s*<value>([^<]+)</value>`, 'i'));
  if (m) return m[1].trim();
  // Fall back to <tag>X</tag>
  m = xml.match(new RegExp(`<${tag}[^>]*>\\s*([^<\\s][^<]*[^\\s<]|[^<\\s]*)\\s*</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Extract all text matches for a tag (for multiple transactions) */
function xmlAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi');
  return (xml.match(regex) ?? []);
}

/** Parse a Form 4 XML document into transaction records */
function parseForm4XML(
  xml: string,
  symbol: string,
  cik: string,
  accessionNumber: string
): Partial<InsiderTrade>[] {
  // Extract filer info
  const ownerBlock  = xml.match(/<reportingOwner[\s\S]*?<\/reportingOwner>/i)?.[0] ?? '';
  const filerName   = xmlVal(ownerBlock, 'rptOwnerName') ?? 'Unknown';
  const filerTitle  = xmlVal(ownerBlock, 'officerTitle')
    ?? (xmlVal(ownerBlock, 'isDirector') === '1' ? 'Director' : '')
    ?? (xmlVal(ownerBlock, 'isTenPercentOwner') === '1' ? '10%+ Owner' : 'Insider');

  const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, '')}/${accessionNumber}.xml`;

  const results: Partial<InsiderTrade>[] = [];

  // Parse non-derivative transactions (direct stock buys/sells)
  const nonDerivBlocks = xmlAll(xml, 'nonDerivativeTransaction');

  for (const block of nonDerivBlocks) {
    const txCode    = xmlVal(block, 'transactionCode');
    if (!txCode || !['P', 'S', 'M', 'F'].includes(txCode)) continue;

    const txDate    = xmlVal(block, 'transactionDate');
    const sharesStr = xmlVal(block, 'transactionShares');
    const priceStr  = xmlVal(block, 'transactionPricePerShare');
    const adCode    = xmlVal(block, 'transactionAcquiredDisposedCode');

    const shares    = sharesStr  ? parseFloat(sharesStr)  : 0;
    const price     = priceStr   ? parseFloat(priceStr)   : 0;
    const totalValue = shares * price;

    results.push({
      id:              accessionNumber + `-${results.length}`,
      symbol,
      cik,
      filerName:        filerName.toUpperCase(),
      filerTitle:       filerTitle,
      transactionDate:  txDate ?? '',
      transactionType:  txCode,
      shares,
      pricePerShare:    price,
      totalValue,
      acquiredDisposed: adCode ?? (txCode === 'P' ? 'A' : 'D'),
      significance:     classifySignificance(txCode, adCode ?? '', totalValue),
      filingUrl,
    });
  }

  return results;
}

function classifySignificance(
  txCode: string,
  adCode: string,
  totalValue: number
): InsiderSignificance {
  const isBuy  = txCode === 'P' || (txCode === 'M' && adCode === 'A');
  const isSell = txCode === 'S' || (txCode === 'F');

  if (isBuy) {
    if (totalValue >= 1_000_000) return 'very_bullish';
    if (totalValue >= 100_000)   return 'bullish';
    return 'neutral';
  }
  if (isSell) {
    if (totalValue >= 5_000_000) return 'very_bearish';
    if (totalValue >= 500_000)   return 'bearish';
    return 'neutral';
  }
  return 'neutral';
}

// ─── EDGAR Fetching ───────────────────────────────────────────────────────────

let cikCache: Record<string, number> | null = null;

async function loadCIKMap(): Promise<Record<string, number>> {
  if (cikCache) return cikCache;
  try {
    const res  = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: EDGAR_HEADERS });
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<string, number> = {};
    for (const e of Object.values(data) as any[]) map[e.ticker.toUpperCase()] = e.cik_str;
    cikCache = map;
    markDataSourceSuccess('insiders_cik', Object.keys(map).length);
    return map;
  } catch {
    markDataSourceFailure('insiders_cik', 'Failed to load CIK map');
    return {};
  }
}

async function fetchXmlFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: EDGAR_HEADERS });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

async function fetchForm4XML(cik: number, accessionNumber: string, primaryDoc: string): Promise<string | null> {
  const cikStr   = String(cik);
  const accClean = accessionNumber.replace(/-/g, '');
  return fetchXmlFromUrl(`https://www.sec.gov/Archives/edgar/data/${cikStr}/${accClean}/${primaryDoc}`);
}

// ─── Main Check ───────────────────────────────────────────────────────────────

export async function checkInsidersForSymbol(
  symbol: string,
  daysBack = 14
): Promise<InsiderTrade[]> {
  const cikMap = await loadCIKMap();
  const cik    = cikMap[symbol];
  if (!cik) return [];

  try {
    const padded = String(cik).padStart(10, '0');
    const res    = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: EDGAR_HEADERS });
    if (!res.ok) return [];

    const data   = await res.json();
    const recent = data.filings?.recent;
    if (!recent) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const forms: string[]  = recent.form           ?? [];
    const dates: string[]  = recent.filingDate      ?? [];
    const accns: string[]  = recent.accessionNumber ?? [];
    const docs:  string[]  = recent.primaryDocument ?? [];

    const newTrades: InsiderTrade[] = [];

    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== '4') continue;
      if (dates[i] < cutoffStr) break; // sorted newest-first, stop when too old

      const accn = accns[i];
      if (!accn || !docs[i]) continue;

      // Skip if already processed
      const exists = db.prepare('SELECT id FROM insider_trades WHERE id LIKE ?').get(accn + '%') as any;
      if (exists) continue;

      // Fetch and parse the Form 4 XML
      const primaryDoc = docs[i];
      if (!primaryDoc.endsWith('.xml') && !primaryDoc.includes('.xml')) continue;

      const xml = await fetchForm4XML(cik, accn, primaryDoc);
      if (!xml) continue;

      const parsed = parseForm4XML(xml, symbol, String(cik), accn);

      for (const trade of parsed) {
        if (!trade.id || !trade.shares || trade.shares <= 0) continue;
        if (!['very_bullish', 'bullish', 'bearish', 'very_bearish'].includes(trade.significance ?? '')) continue;

        const full = trade as InsiderTrade;
        saveTrade(full);
        newTrades.push(full);
        console.log(`[Insiders] ${symbol}: ${full.filerName} ${full.transactionType === 'P' ? 'BOUGHT' : 'SOLD'} ${full.shares.toLocaleString()} shares ($${(full.totalValue / 1000).toFixed(0)}k) — ${full.significance}`);
      }

      await new Promise(r => setTimeout(r, 300)); // rate limit
    }

    return newTrades;
  } catch (err: any) {
    console.error(`[Insiders] Error for ${symbol}: ${err?.message}`);
    return [];
  }
}

export async function runInsidersCheck(symbols: string[]): Promise<InsiderTrade[]> {
  console.log(`[Insiders] Checking Form 4 filings for ${symbols.length} symbols...`);

  // ── Path A: sec-api.io (batch, no CIK lookup needed) ─────────────────────
  if (process.env.SEC_API_KEY) {
    try {
      const form4s = await fetchRecentForm4sViaSECApi(symbols, 14);
      const allTrades: InsiderTrade[] = [];

      for (const entry of form4s) {
        // Skip if we've already processed any transaction from this accession
        const exists = db.prepare('SELECT id FROM insider_trades WHERE id LIKE ?').get(entry.accessionNo + '%') as any;
        if (exists) continue;

        const xml = await fetchXmlFromUrl(entry.xmlUrl);
        if (!xml) continue;

        const parsed = parseForm4XML(xml, entry.symbol, entry.cik, entry.accessionNo);
        for (const trade of parsed) {
          if (!trade.id || !trade.shares || trade.shares <= 0) continue;
          if (!['very_bullish', 'bullish', 'bearish', 'very_bearish'].includes(trade.significance ?? '')) continue;

          const full = trade as InsiderTrade;
          saveTrade(full);
          allTrades.push(full);
          const dir = full.transactionType === 'P' ? 'BOUGHT' : full.transactionType === 'S' ? 'SOLD' : full.transactionType;
          console.log(`[Insiders] ${entry.symbol}: ${full.filerName} ${dir} ${full.shares.toLocaleString()} shares ($${(full.totalValue / 1000).toFixed(0)}k) — ${full.significance}`);
        }

        await new Promise(r => setTimeout(r, 150));
      }

      console.log(`[Insiders] Found ${allTrades.length} significant new insider transactions`);
      markDataSourceSuccess('insiders', allTrades.length, { symbolsChecked: symbols.length, source: 'sec_api' });
      return allTrades;
    } catch (err: any) {
      console.warn('[Insiders] sec-api.io failed, falling back to EDGAR:', err?.message);
    }
  }

  // ── Path B: EDGAR fallback (per-symbol, rate-limited) ─────────────────────
  const allTrades: InsiderTrade[] = [];

  for (const sym of symbols) {
    const trades = await checkInsidersForSymbol(sym, 14);
    allTrades.push(...trades);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[Insiders] Found ${allTrades.length} significant new insider transactions`);
  markDataSourceSuccess('insiders', allTrades.length, { symbolsChecked: symbols.length });
  return allTrades;
}

// ─── DB Operations ────────────────────────────────────────────────────────────

function saveTrade(t: InsiderTrade): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO insider_trades
        (id, symbol, cik, filer_name, filer_title, transaction_date, transaction_type,
         shares, price_per_share, total_value, acquired_disposed, significance, filing_url)
      VALUES
        (@id, @symbol, @cik, @filer_name, @filer_title, @transaction_date, @transaction_type,
         @shares, @price_per_share, @total_value, @acquired_disposed, @significance, @filing_url)
    `).run({
      id:               t.id,
      symbol:           t.symbol,
      cik:              t.cik,
      filer_name:       t.filerName,
      filer_title:      t.filerTitle,
      transaction_date: t.transactionDate,
      transaction_type: t.transactionType,
      shares:           t.shares,
      price_per_share:  t.pricePerShare,
      total_value:      t.totalValue,
      acquired_disposed: t.acquiredDisposed,
      significance:     t.significance,
      filing_url:       t.filingUrl,
    });
  } catch { /* non-fatal */ }
}

export function getRecentInsiderTrades(
  symbols?: string[],
  daysBack = 30
): InsiderTrade[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const rows = symbols && symbols.length > 0
    ? db.prepare(`
        SELECT * FROM insider_trades
        WHERE symbol IN (${symbols.map(() => '?').join(',')})
          AND transaction_date >= ?
          AND significance != 'neutral'
        ORDER BY transaction_date DESC LIMIT 50
      `).all(...symbols, cutoffStr) as any[]
    : db.prepare(`
        SELECT * FROM insider_trades
        WHERE transaction_date >= ?
          AND significance != 'neutral'
        ORDER BY transaction_date DESC LIMIT 50
      `).all(cutoffStr) as any[];

  return rows.map(r => ({
    id:              r.id,
    symbol:          r.symbol,
    cik:             r.cik,
    filerName:       r.filer_name,
    filerTitle:      r.filer_title,
    transactionDate: r.transaction_date,
    transactionType: r.transaction_type,
    shares:          r.shares,
    pricePerShare:   r.price_per_share,
    totalValue:      r.total_value,
    acquiredDisposed: r.acquired_disposed,
    significance:    r.significance,
    filingUrl:       r.filing_url,
  }));
}

// ─── Prompt Formatting ────────────────────────────────────────────────────────

const SIG_LABEL: Record<InsiderSignificance, string> = {
  very_bullish: '🟢 VERY BULLISH',
  bullish:      '🟡 BULLISH',
  neutral:      '⬜ NEUTRAL',
  bearish:      '🟠 BEARISH',
  very_bearish: '🔴 VERY BEARISH',
};

export function formatInsidersForPrompt(trades: InsiderTrade[]): string {
  if (trades.length === 0) return 'No significant insider transactions in the last 14 days.';

  const lines = trades.slice(0, 8).map(t => {
    const action   = t.transactionType === 'P' ? 'BOUGHT' : t.transactionType === 'S' ? 'SOLD' : t.transactionType;
    const valStr   = t.totalValue >= 1_000_000
      ? `$${(t.totalValue / 1_000_000).toFixed(1)}M`
      : `$${(t.totalValue / 1_000).toFixed(0)}k`;
    const title    = t.filerTitle ? ` (${t.filerTitle})` : '';
    return `${t.symbol.padEnd(5)} | ${t.filerName}${title} ${action} ${t.shares.toLocaleString()} shares ${valStr} on ${t.transactionDate} → ${SIG_LABEL[t.significance]}`;
  });

  const calibration = [
    '• Large insider BUY (>$1M) + news BUY signal → increase confidence by 20-25%',
    '• Very bearish insider sell + news SELL signal → increase confidence by 15%',
    '• Large insider sell while you hold → strongly consider SELL',
    '• Multiple insiders buying same week → conviction signal, higher confidence',
  ].join('\n');

  return lines.join('\n') + '\n\nCALIBRATION:\n' + calibration;
}
