/**
 * SEC Filing Monitor — 8-K Material Events + 13D/13G Beneficial Ownership
 *
 * Primary path: sec-api.io Query API (when SEC_API_KEY is set)
 *   - Single batch request for all symbols at once (no per-symbol CIK lookup)
 *   - Returns direct document URLs, parsed item numbers, precise timestamps
 *   - Can filter by specific 8-K item types
 *
 * Fallback: EDGAR submissions API (free, no key required)
 *   - Per-symbol CIK lookup + submissions JSON + index fetch for primary doc
 *
 * High-signal 8-K items tracked:
 *   2.02 — Results of Operations (earnings)
 *   5.02 — Leadership changes (CEO/CFO/board)
 *   1.01 — Material agreements (M&A, partnerships)
 *   1.02 — Business terminations
 *   8.01 — Other material events / press releases
 *
 * 13D/13G: Beneficial ownership disclosures (>5% stake changes)
 *   Filed within 10 days of threshold crossing — high-signal institutional activity
 */

import db from './db.js';
import { CORE_WATCHLIST } from './universe.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';

const EDGAR_HEADERS = {
  'User-Agent': 'AutonomesPortfolioManager contact@example.com',
  'Accept': 'application/json',
};

// 8-K items worth processing — ignore boilerplate items (9.01 = exhibits, 7.01 = reg FD)
const HIGH_SIGNAL_ITEMS = new Set(['2.02', '5.02', '1.01', '1.02', '8.01', '4.01', '4.02']);

export interface FilingRecord {
  id: string;           // accession number (unique)
  symbol: string;
  cik: string;
  form: string;         // '8-K', '8-K/A', 'SC 13D', 'SC 13G', etc.
  filed: string;        // YYYY-MM-DD
  description: string;  // primary document description
  url: string;          // direct link to .htm filing document
  processed: boolean;
  items?: string;       // comma-separated 8-K item numbers e.g. "2.02,9.01"
}

// ─── sec-api.io Query API ─────────────────────────────────────────────────────

function getSecApiKey(): string | null {
  return process.env.SEC_API_KEY ?? null;
}

const SEC_API_BASE = 'https://api.sec-api.io';

async function secApiQuery(payload: Record<string, any>): Promise<any[]> {
  const key = getSecApiKey();
  if (!key) return [];
  const res = await fetch(`${SEC_API_BASE}?token=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`sec-api.io ${res.status}`);
  const data = await res.json();
  return data?.filings ?? [];
}

/**
 * Clean the `ix?doc=` iXBRL viewer wrapper from SEC document URLs.
 * https://www.sec.gov/ix?doc=/Archives/edgar/... → https://www.sec.gov/Archives/edgar/...
 */
function cleanDocUrl(url: string): string {
  return url.replace('https://www.sec.gov/ix?doc=', 'https://www.sec.gov')
            .replace('http://www.sec.gov/ix?doc=', 'https://www.sec.gov');
}

/**
 * Extract the best document URL from a sec-api.io filing record.
 * Prefers the first .htm/.html file that isn't a graphic.
 */
function extractDocUrl(filing: any): string {
  const docs: any[] = filing.documentFormatFiles ?? [];
  // First, try the primary form type match
  for (const doc of docs) {
    const url = doc.documentUrl ?? '';
    const type = (doc.type ?? '').trim();
    const desc = (doc.description ?? '').toLowerCase();
    if (
      (type === filing.formType || type === '8-K' || type === '4') &&
      (url.endsWith('.htm') || url.endsWith('.html')) &&
      !desc.includes('graphic') && !desc.includes('logo')
    ) {
      return cleanDocUrl(url);
    }
  }
  // Fall back to first .htm/.html
  for (const doc of docs) {
    const url = doc.documentUrl ?? '';
    if ((url.endsWith('.htm') || url.endsWith('.html')) && !url.includes('/ix?')) {
      return cleanDocUrl(url);
    }
  }
  // Fall back to linkToFilingDetails
  return filing.linkToFilingDetails ?? '';
}

/**
 * Extract item numbers from an 8-K filing record.
 * Returns e.g. "2.02,9.01"
 */
function extractItemNumbers(filing: any): string {
  const items: string[] = (filing.items ?? []).map((item: string) => {
    const match = item.match(/Item\s+(\d+\.\d+)/i);
    return match ? match[1] : null;
  }).filter(Boolean);
  return items.join(',');
}

/**
 * Check whether an 8-K filing contains at least one high-signal item.
 */
function hasHighSignalItem(filing: any): boolean {
  const items: string[] = (filing.items ?? []);
  return items.some(item => {
    const match = item.match(/Item\s+(\d+\.\d+)/i);
    return match ? HIGH_SIGNAL_ITEMS.has(match[1]) : false;
  });
}

// ─── SEC-API.IO: Batch 8-K Fetch ─────────────────────────────────────────────

async function fetchRecentFilingsViaSECApi(
  symbols: string[],
  daysBack = 3,
): Promise<FilingRecord[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const startdt = cutoff.toISOString().split('T')[0];
  const enddt = new Date().toISOString().split('T')[0];

  const tickerQuery = symbols.map(s => `"${s}"`).join(' OR ');
  const filings = await secApiQuery({
    query: {
      query_string: {
        query: `ticker:(${tickerQuery}) AND (formType:"8-K" OR formType:"8-K/A")`,
      },
    },
    dateRange: { startdt, enddt },
    from: '0',
    size: '100',
    sort: [{ filedAt: { order: 'desc' } }],
  });

  const results: FilingRecord[] = [];
  for (const f of filings) {
    // Only store high-signal 8-Ks — skip pure exhibit filings (9.01 only)
    if (!hasHighSignalItem(f)) continue;

    const filed = (f.filedAt ?? '').split('T')[0];
    const docUrl = extractDocUrl(f);
    const itemStr = extractItemNumbers(f);

    results.push({
      id:          f.accessionNo,
      symbol:      f.ticker,
      cik:         f.cik ?? '',
      form:        f.formType,
      filed,
      description: f.description ?? `${f.formType} — Material Event`,
      url:         docUrl || f.linkToHtml || '',
      processed:   false,
      items:       itemStr,
    });
  }

  return results;
}

// ─── SEC-API.IO: 13D/13G Beneficial Ownership ────────────────────────────────

export async function fetchRecentBeneficialOwnership(
  symbols: string[],
  daysBack = 30,
): Promise<FilingRecord[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const startdt = cutoff.toISOString().split('T')[0];
  const enddt = new Date().toISOString().split('T')[0];

  const tickerQuery = symbols.map(s => `"${s}"`).join(' OR ');
  let filings: any[] = [];
  try {
    filings = await secApiQuery({
      query: {
        query_string: {
          query: `ticker:(${tickerQuery}) AND (formType:"SC 13D" OR formType:"SC 13D/A" OR formType:"SC 13G" OR formType:"SC 13G/A")`,
        },
      },
      dateRange: { startdt, enddt },
      from: '0',
      size: '50',
      sort: [{ filedAt: { order: 'desc' } }],
    });
  } catch {
    return [];
  }

  const results: FilingRecord[] = [];
  for (const f of filings) {
    const filed = (f.filedAt ?? '').split('T')[0];
    const docUrl = extractDocUrl(f);

    results.push({
      id:          f.accessionNo,
      symbol:      f.ticker,
      cik:         f.cik ?? '',
      form:        f.formType,
      filed,
      description: f.description ?? `${f.formType} — Beneficial Ownership Disclosure`,
      url:         docUrl || f.linkToHtml || '',
      processed:   false,
    });
  }

  return results;
}

// ─── SEC-API.IO: Form 4 Filing Index ─────────────────────────────────────────

/**
 * Returns raw Form 4 index records from sec-api.io — used by insiders.ts
 * to skip the CIK lookup + submissions JSON step. The caller still fetches
 * and parses the XML for transaction details.
 */
export async function fetchRecentForm4sViaSECApi(
  symbols: string[],
  daysBack = 14,
): Promise<Array<{ symbol: string; accessionNo: string; cik: string; xmlUrl: string; filedAt: string }>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const startdt = cutoff.toISOString().split('T')[0];
  const enddt = new Date().toISOString().split('T')[0];

  const tickerQuery = symbols.map(s => `"${s}"`).join(' OR ');
  let filings: any[] = [];
  try {
    filings = await secApiQuery({
      query: {
        query_string: {
          query: `ticker:(${tickerQuery}) AND formType:"4"`,
        },
      },
      dateRange: { startdt, enddt },
      from: '0',
      size: '200',
      sort: [{ filedAt: { order: 'desc' } }],
    });
  } catch {
    return [];
  }

  return filings.map(f => {
    // Pick the raw XML (second documentFormatFile is the non-styled version)
    const docs: any[] = f.documentFormatFiles ?? [];
    const rawXml = docs.find(d =>
      (d.documentUrl ?? '').endsWith('.xml') &&
      !(d.documentUrl ?? '').includes('xslF345X05')
    ) ?? docs[1] ?? docs[0];

    return {
      symbol:      f.ticker,
      accessionNo: f.accessionNo,
      cik:         f.cik ?? '',
      xmlUrl:      rawXml?.documentUrl ?? '',
      filedAt:     f.filedAt ?? '',
    };
  }).filter(entry => entry.xmlUrl);
}

// ─── EDGAR Fallback: CIK Resolution ──────────────────────────────────────────

let cikCache: Record<string, number> | null = null;

async function getCIKMap(): Promise<Record<string, number>> {
  if (cikCache) return cikCache;
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: EDGAR_HEADERS,
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<string, number> = {};
    for (const entry of Object.values(data) as any[]) {
      map[entry.ticker.toUpperCase()] = entry.cik_str;
    }
    cikCache = map;
    markDataSourceSuccess('filings_cik', Object.keys(map).length);
    return map;
  } catch {
    markDataSourceFailure('filings_cik', 'Failed to load CIK map');
    return {};
  }
}

// ─── EDGAR Fallback: Per-symbol 8-K Fetch ────────────────────────────────────

async function fetchPrimaryDocumentUrl(cik: number, accn: string): Promise<string | null> {
  try {
    const accnClean = accn.replace(/-/g, '');
    const indexUrl = `https://data.sec.gov/Archives/edgar/data/${cik}/${accnClean}/${accn}-index.json`;
    const res = await fetch(indexUrl, { headers: EDGAR_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const docs: Array<{ documentUrl?: string }> = data?.documents ?? [];
    for (const doc of docs) {
      if (doc.documentUrl && (doc.documentUrl.endsWith('.htm') || doc.documentUrl.endsWith('.html'))) {
        return doc.documentUrl.startsWith('http')
          ? doc.documentUrl
          : `https://www.sec.gov${doc.documentUrl}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function checkFilingsForSymbolEDGAR(
  symbol: string,
  cik: number,
  daysBack = 3,
): Promise<FilingRecord | null> {
  try {
    const padded = String(cik).padStart(10, '0');
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: EDGAR_HEADERS });
    if (!res.ok) return null;

    const data = await res.json();
    const recent = data.filings?.recent;
    if (!recent) return null;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const forms: string[] = recent.form ?? [];
    const dates: string[] = recent.filingDate ?? [];
    const accns: string[] = recent.accessionNumber ?? [];
    const descs: string[] = recent.primaryDocDescription ?? [];

    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== '8-K' && forms[i] !== '8-K/A') continue;
      if (dates[i] < cutoffStr) break;

      const accn = accns[i];
      if (!accn) continue;

      const accnClean = accn.replace(/-/g, '');
      const primaryDocUrl = await fetchPrimaryDocumentUrl(cik, accn);
      const filingUrl = primaryDocUrl ?? `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/`;

      return {
        id:          accn,
        symbol,
        cik:         String(cik),
        form:        forms[i],
        filed:       dates[i],
        description: descs[i] || `${forms[i]} — Material Event`,
        url:         filingUrl,
        processed:   false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Main Monitor ─────────────────────────────────────────────────────────────

export async function checkRecent8Ks(symbols: string[]): Promise<FilingRecord[]> {
  // ── Path A: sec-api.io (batch, high quality) ──────────────────────────────
  if (getSecApiKey()) {
    try {
      const fromApi = await fetchRecentFilingsViaSECApi(symbols, 3);
      const newFilings: FilingRecord[] = [];

      for (const filing of fromApi) {
        const alreadyStored = db.prepare('SELECT id FROM filings WHERE id = ?').get(filing.id) as any;
        if (alreadyStored) continue;
        saveFiling(filing);
        newFilings.push(filing);
        console.log(`[Filings] 🔔 ${filing.symbol}: ${filing.form} filed ${filing.filed} — ${filing.description} (${filing.items ?? 'n/a'})`);
      }

      // Also check for 13D/13G beneficial ownership changes
      const ownership = await fetchRecentBeneficialOwnership(symbols, 14).catch(() => []);
      for (const filing of ownership) {
        const alreadyStored = db.prepare('SELECT id FROM filings WHERE id = ?').get(filing.id) as any;
        if (alreadyStored) continue;
        saveFiling(filing);
        newFilings.push(filing);
        console.log(`[Filings] 🏦 ${filing.symbol}: ${filing.form} filed ${filing.filed} — beneficial ownership change`);
      }

      markDataSourceSuccess('filings', newFilings.length, {
        symbolsChecked: symbols.length,
        source: 'sec_api',
      });
      return newFilings;
    } catch (err: any) {
      console.warn('[Filings] sec-api.io failed, falling back to EDGAR:', err?.message);
      markDataSourceFailure('filings', `sec-api.io failed: ${err?.message}`);
      // Fall through to EDGAR
    }
  }

  // ── Path B: EDGAR fallback (per-symbol, rate-limited) ────────────────────
  const cikMap = await getCIKMap();
  const newFilings: FilingRecord[] = [];

  for (const symbol of symbols) {
    const cik = cikMap[symbol];
    if (!cik) continue;

    const existing = db.prepare(`
      SELECT id FROM filings
      WHERE symbol = ? AND processed = 0 AND filed >= date('now', '-3 days')
    `).get(symbol) as any;
    if (existing) continue;

    const filing = await checkFilingsForSymbolEDGAR(symbol, cik, 3);
    if (filing) {
      const alreadyStored = db.prepare('SELECT id FROM filings WHERE id = ?').get(filing.id) as any;
      if (!alreadyStored) {
        saveFiling(filing);
        newFilings.push(filing);
        console.log(`[Filings] 🔔 ${symbol}: ${filing.form} filed ${filing.filed} — ${filing.description}`);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  markDataSourceSuccess('filings', newFilings.length, {
    symbolsChecked: symbols.length,
    source: 'edgar',
  });
  return newFilings;
}

// ─── DB Operations ────────────────────────────────────────────────────────────

function saveFiling(f: FilingRecord): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO filings (id, symbol, cik, form, filed, description, url, processed, items)
      VALUES (@id, @symbol, @cik, @form, @filed, @description, @url, 0, @items)
    `).run({
      id:          f.id,
      symbol:      f.symbol,
      cik:         f.cik,
      form:        f.form,
      filed:       f.filed,
      description: f.description,
      url:         f.url,
      items:       f.items ?? null,
    });
  } catch { /* non-fatal */ }
}

export function getUnprocessedFilings(): FilingRecord[] {
  try {
    const rows = db.prepare(`
      SELECT * FROM filings
      WHERE processed = 0
      ORDER BY filed DESC, created_at DESC
      LIMIT 20
    `).all() as any[];

    return rows.map(r => ({
      id:          r.id,
      symbol:      r.symbol,
      cik:         r.cik,
      form:        r.form,
      filed:       r.filed,
      description: r.description,
      url:         r.url,
      processed:   r.processed === 1,
      items:       r.items ?? undefined,
    }));
  } catch {
    return [];
  }
}

export function markFilingProcessed(id: string, summary?: string): void {
  try {
    db.prepare(
      'UPDATE filings SET processed = 1, summary = @summary WHERE id = @id'
    ).run({ id, summary: summary ?? null });
  } catch { /* non-fatal */ }
}

export function getRecentFilings(daysBack = 7): FilingRecord[] {
  try {
    const rows = db.prepare(`
      SELECT * FROM filings
      WHERE filed >= date('now', '-' || ? || ' days')
      ORDER BY filed DESC, created_at DESC
      LIMIT 50
    `).all(daysBack) as any[];

    return rows.map(r => ({
      id:          r.id,
      symbol:      r.symbol,
      cik:         r.cik,
      form:        r.form,
      filed:       r.filed,
      description: r.description,
      url:         r.url,
      processed:   r.processed === 1,
      items:       r.items ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Run a full check for all core + screener symbols.
 * Called every 4 hours by the ResearchIngestionAgent.
 */
export async function runFilingsCheck(extraSymbols: string[] = []): Promise<FilingRecord[]> {
  const symbols = [...new Set([...CORE_WATCHLIST, ...extraSymbols])];
  const source = getSecApiKey() ? 'sec-api.io' : 'EDGAR';
  console.log(`[Filings] Checking ${symbols.length} symbols via ${source}...`);
  const found = await checkRecent8Ks(symbols);
  if (found.length > 0) {
    console.log(`[Filings] Found ${found.length} new filing(s)`);
  } else {
    console.log('[Filings] No new filings found');
  }
  return found;
}
