/**
 * Phase 18 — 13F Hedge Fund Holdings Tracker
 *
 * Fetches quarterly SEC 13F-HR filings from 15 top hedge funds.
 * Detects position changes (new, added, reduced, exited) and generates
 * research_events that feed the existing signal pipeline.
 */

import { randomUUID } from 'crypto';
import db from './db.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';
import { saveResearchEvents } from './research.js';

const EDGAR_HEADERS = {
  'User-Agent': 'AutonomesPortfolioManager contact@example.com',
  'Accept': 'application/json, application/xml, text/html',
};

// ─── Static CUSIP → Ticker Map ────────────────────────────────────────────────

const CUSIP_MAP: Record<string, string> = {
  '037833100': 'AAPL',
  '594918104': 'MSFT',
  '67066G104': 'NVDA',
  '02079K305': 'GOOGL',
  '02079K107': 'GOOGL',
  '023135106': 'AMZN',
  '30303M102': 'META',
  '88160R101': 'TSLA',
  '007903107': 'AMD',
  '458140100': 'INTC',
  '22788C105': 'CRWD',
  '69608A108': 'PLTR',
  '17275R102': 'CSCO',
  '91822K102': 'UBER',
  '09857L108': 'BKNG',
  '46090E103': 'INTU',
  '742718109': 'PYPL',
  '256135203': 'ADBE',
  '345370860': 'FB',
  '11135F101': 'BIDU',
  '38141G104': 'GS',
  '70450Y103': 'PINS',
  '78378X107': 'S',
  '00724F101': 'ADSK',
  '025816109': 'AXP',
  '037604105': 'APPS',
  '09062X103': 'BILI',
  '09075V102': 'BIO',
  '14040H105': 'CARR',
  '21946C102': 'CRM',
  '22160K105': 'COST',
  '265504100': 'DHR',
  '29355A107': 'ENPH',
  '30212P303': 'FDX',
  '36467W109': 'GME',
  '44919P508': 'HOOD',
  '45168D104': 'IDXX',
  '47233W109': 'JD',
  '501044101': 'KO',
  '585055106': 'MCD',
  '60935Y109': 'MNST',
  '617446448': 'MRVL',
  '637640103': 'NET',
  '68389X105': 'ORCL',
  '717081103': 'PFE',
  '79466L302': 'SHOP',
  '78409V104': 'SQ',
  '824348106': 'SNOW',
  '855244109': 'SPOT',
  '87612E106': 'TEAM',
  '896429109': 'TMUS',
  '98138H101': 'WMT',
  '98980L101': 'ZM',
  '99287R104': 'ZS',
};

export function resolveTicker(cusip: string, issuerName: string): string | null {
  // Direct CUSIP lookup first
  if (CUSIP_MAP[cusip]) return CUSIP_MAP[cusip];

  // Normalize issuer name and try to match against companies table
  const normalized = issuerName
    .toUpperCase()
    .replace(/\b(INC|CORP|LTD|LLC|PLC|CO|GROUP|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|INTERNATIONAL|GLOBAL)\b\.?/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();

  const row = db.prepare(
    `SELECT symbol FROM companies WHERE UPPER(REPLACE(REPLACE(REPLACE(name, ' Inc.', ''), ' Corp.', ''), ' Ltd.', '')) LIKE ? LIMIT 1`
  ).get(`%${normalized.substring(0, 10)}%`) as any;

  return row?.symbol ?? null;
}

// ─── XML Parsing (reuse insiders.ts pattern) ─────────────────────────────────

function xmlVal(xml: string, tag: string): string | null {
  const openTag = `<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>`;
  const closeTag = `<\\/(?:[A-Za-z0-9_]+:)?${tag}>`;
  let m = xml.match(new RegExp(`${openTag}\\s*<(?:[A-Za-z0-9_]+:)?value>([^<]+)<\\/(?:[A-Za-z0-9_]+:)?value>`, 'i'));
  if (m) return m[1].trim();
  m = xml.match(new RegExp(`${openTag}\\s*([^<\\s][^<]*[^\\s<]|[^<\\s]*)\\s*${closeTag}`, 'i'));
  return m ? m[1].trim() : null;
}

function xmlAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[\\s\\S]*?<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, 'gi');
  return xml.match(regex) ?? [];
}

interface InfoTableEntry {
  cusip: string;
  issuerName: string;
  shares: number;
  valueThousands: number;
}

export function parseInfoTable(xml: string): InfoTableEntry[] {
  const entries: InfoTableEntry[] = [];
  const blocks = xmlAll(xml, 'infoTable');
  for (const block of blocks) {
    const cusip      = xmlVal(block, 'cusip')         ?? '';
    const issuerName = xmlVal(block, 'nameOfIssuer')  ?? '';
    const sharesStr  = xmlVal(block, 'sshPrnamt')     ?? '0';
    const valueStr   = xmlVal(block, 'value')         ?? '0';
    const shares     = parseInt(sharesStr.replace(/,/g, ''), 10) || 0;
    const value      = parseInt(valueStr.replace(/,/g, ''), 10)  || 0;
    if (!cusip || shares <= 0) continue;
    entries.push({ cusip, issuerName, shares, valueThousands: value });
  }
  return entries;
}

// ─── EDGAR Fetch ──────────────────────────────────────────────────────────────

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface ManagerRow {
  id: string;
  name: string;
  cik: string;
}

function getEdgarFilingIndexUrls(cik: string, accessionNumber: string): string[] {
  const accnClean = accessionNumber.replace(/-/g, '');
  return [
    `https://data.sec.gov/Archives/edgar/data/${cik}/${accnClean}/${accessionNumber}-index.json`,
    `https://data.sec.gov/Archives/edgar/data/${cik}/${accnClean}/index.json`,
  ];
}

function getEdgarFilingHtmlIndexUrls(cik: string, accessionNumber: string): string[] {
  const accnClean = accessionNumber.replace(/-/g, '');
  return [
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/${accessionNumber}-index.htm`,
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/${accessionNumber}-index.html`,
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/index.htm`,
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/index.html`,
  ];
}

function findInfoTableDocument(indexData: any): string | null {
  const docs = [
    ...(Array.isArray(indexData?.documents) ? indexData.documents : []),
    ...(Array.isArray(indexData?.directory?.item) ? indexData.directory.item : []),
  ];

  const names = docs
    .map((doc: any) => doc?.name ?? doc?.documentUrl ?? null)
    .filter((name: string | null): name is string => Boolean(name))
    .map((name: string) => {
      if (name.startsWith('http://') || name.startsWith('https://')) {
        const parts = name.split('/');
        return parts[parts.length - 1] ?? name;
      }
      return name;
    });

  return names.find((name: string) =>
    (name.toLowerCase().includes('infotable') || name.toLowerCase().includes('informationtable')) &&
    name.toLowerCase().endsWith('.xml')
  ) ?? names.find((name: string) => name.toLowerCase().endsWith('.xml')) ?? null;
}

export function findInfoTableDocumentFromHtmlIndex(indexHtml: string): string | null {
  const rowMatches = [...indexHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match => match[0]);
  const preferredNames: string[] = [];
  const fallbackNames: string[] = [];

  for (const row of rowMatches) {
    if (!/INFORMATION TABLE/i.test(row)) continue;
    const hrefMatches = [...row.matchAll(/href=["']([^"']+\.xml)["']/gi)].map(match => match[1]);
    for (const href of hrefMatches) {
      const parts = href.split('/');
      const name = parts[parts.length - 1] ?? href;
      if (/\/xsl/i.test(href)) {
        fallbackNames.push(name);
      } else {
        preferredNames.push(name);
      }
    }
  }

  if (preferredNames.length > 0) return preferredNames[0] ?? null;
  if (fallbackNames.length > 0) return fallbackNames[0] ?? null;

  const hrefs = [...indexHtml.matchAll(/href=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter((href): href is string => Boolean(href));

  const names = hrefs.map((href: string) => {
    const parts = href.split('/');
    return parts[parts.length - 1] ?? href;
  });

  return names.find((name: string) =>
    (name.toLowerCase().includes('infotable') || name.toLowerCase().includes('informationtable')) &&
    name.toLowerCase().endsWith('.xml')
  ) ?? names.find((name: string) => name.toLowerCase().endsWith('.xml')) ?? null;
}

async function fetch13FForManager(manager: ManagerRow): Promise<number> {
  const cik = manager.cik.replace(/^0+/, ''); // strip leading zeros for URL path
  const padded = manager.cik.padStart(10, '0');

  let submissionsData: any;
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: EDGAR_HEADERS });
    if (!res.ok) {
      console.warn(`[HedgeFund] ${manager.name}: submissions fetch failed (${res.status})`);
      return 0;
    }
    submissionsData = await res.json();
  } catch (err: any) {
    console.warn(`[HedgeFund] ${manager.name}: ${err?.message}`);
    return 0;
  }

  const recent = submissionsData.filings?.recent;
  if (!recent) return 0;

  const forms: string[] = recent.form           ?? [];
  const dates: string[] = recent.filingDate      ?? [];
  const accns: string[] = recent.accessionNumber ?? [];
  const rpDts: string[] = recent.reportDate      ?? [];

  // Only look back 18 months — current + prior 5 quarters are all that matter for positioning
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Find the latest 13F-HR not already in DB
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '13F-HR') continue;

    // EDGAR returns newest-first — stop as soon as we hit filings older than 18 months
    if (dates[i] && dates[i] < cutoffStr) break;

    const accn = accns[i];
    if (!accn) continue;

    // Check if we've already processed this filing
    const existing = db.prepare(
      `SELECT id FROM hedge_fund_holdings WHERE manager_id = ? AND accession_number = ? LIMIT 1`
    ).get(manager.id, accn) as any;
    if (existing) break; // already ingested, don't reprocess older ones

    const periodOfReport = rpDts[i] ?? dates[i] ?? '';
    const filedDate      = dates[i] ?? '';

    console.log(`[HedgeFund] ${manager.name}: fetching 13F ${accn} (period: ${periodOfReport})`);
    await delay(300);

    // Fetch the index page to find the primary document.
    // Use break (not continue) on failure — we've already identified the target filing,
    // falling through to older filings on error would pull historical data unnecessarily.
    let indexData: any;
    let indexHtml: string | null = null;
    let lastIndexStatus: number | null = null;
    let indexFetched = false;
    for (const indexUrl of getEdgarFilingIndexUrls(cik, accn)) {
      try {
        const indexRes = await fetch(indexUrl, { headers: EDGAR_HEADERS });
        if (!indexRes.ok) {
          lastIndexStatus = indexRes.status;
          continue;
        }
        indexData = await indexRes.json();
        indexFetched = true;
        break;
      } catch (err: any) {
        console.warn(`[HedgeFund] ${manager.name}: index fetch error for ${accn}: ${err?.message}`);
      }
    }

    if (!indexFetched) {
      for (const indexUrl of getEdgarFilingHtmlIndexUrls(cik, accn)) {
        try {
          const indexRes = await fetch(indexUrl, { headers: EDGAR_HEADERS });
          if (!indexRes.ok) {
            lastIndexStatus = indexRes.status;
            continue;
          }
          indexHtml = await indexRes.text();
          indexFetched = true;
          break;
        } catch (err: any) {
          console.warn(`[HedgeFund] ${manager.name}: HTML index fetch error for ${accn}: ${err?.message}`);
        }
      }
    }

    if (!indexFetched) {
      if (lastIndexStatus !== null) {
        console.warn(`[HedgeFund] ${manager.name}: index fetch failed (${lastIndexStatus}) for ${accn}`);
      } else {
        console.warn(`[HedgeFund] ${manager.name}: index fetch failed for ${accn}`);
      }
      break;
    }

    // Find the XML info table document
    const xmlDocName = indexData
      ? findInfoTableDocument(indexData)
      : (indexHtml ? findInfoTableDocumentFromHtmlIndex(indexHtml) : null);
    if (!xmlDocName) {
      console.warn(`[HedgeFund] ${manager.name}: no XML doc found for ${accn}`);
      break;
    }

    await delay(300);

    let xmlContent: string;
    try {
      const accnClean = accn.replace(/-/g, '');
      const xmlRes = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${cik}/${accnClean}/${xmlDocName}`,
        { headers: EDGAR_HEADERS }
      );
      if (!xmlRes.ok) {
        console.warn(`[HedgeFund] ${manager.name}: XML fetch failed (${xmlRes.status}) for ${accn}`);
        break;
      }
      xmlContent = await xmlRes.text();
    } catch (err: any) {
      console.warn(`[HedgeFund] ${manager.name}: XML fetch error for ${accn}: ${err?.message}`);
      break;
    }

    const entries = parseInfoTable(xmlContent);
    if (entries.length === 0) {
      console.warn(`[HedgeFund] ${manager.name}: no holdings parsed from ${accn}`);
      break;
    }

    // Persist holdings
    const insertHolding = db.prepare(`
      INSERT INTO hedge_fund_holdings
        (id, manager_id, period_of_report, accession_number, filed_date, cusip, ticker, issuer_name, shares, value_thousands)
      VALUES
        (@id, @manager_id, @period_of_report, @accession_number, @filed_date, @cusip, @ticker, @issuer_name, @shares, @value_thousands)
      ON CONFLICT(manager_id, period_of_report, cusip) DO UPDATE SET
        shares = excluded.shares,
        value_thousands = excluded.value_thousands,
        ticker = excluded.ticker
    `);

    const insertTx = db.transaction((rows: InfoTableEntry[]) => {
      for (const e of rows) {
        const ticker = resolveTicker(e.cusip, e.issuerName);
        insertHolding.run({
          id: randomUUID(),
          manager_id: manager.id,
          period_of_report: periodOfReport,
          accession_number: accn,
          filed_date: filedDate,
          cusip: e.cusip,
          ticker: ticker ?? null,
          issuer_name: e.issuerName,
          shares: e.shares,
          value_thousands: e.valueThousands,
        });
      }
    });
    insertTx(entries);

    // Run change detection
    const changes = detectChanges(manager.id, periodOfReport, entries);
    persistChanges(manager.id, periodOfReport, accn, changes);

    // Generate research events for significant changes on tracked tickers
    generateResearchEvents(manager, periodOfReport, changes);

    console.log(`[HedgeFund] ${manager.name}: ingested ${entries.length} holdings, ${changes.filter(c => c.isSignificant).length} significant changes`);
    return changes.filter(c => c.isSignificant).length;
  }

  return 0;
}

// ─── Change Detection ─────────────────────────────────────────────────────────

interface HoldingChange {
  cusip: string;
  ticker: string | null;
  issuerName: string;
  changeType: 'new' | 'added' | 'reduced' | 'exited';
  priorShares: number | null;
  currentShares: number;
  pctChange: number | null;
  currentValueThousands: number;
  isSignificant: boolean;
}

export function detectChanges(managerId: string, periodOfReport: string, current: InfoTableEntry[]): HoldingChange[] {
  // Find the prior period (most recent period before this one)
  const priorPeriod = db.prepare(`
    SELECT DISTINCT period_of_report FROM hedge_fund_holdings
    WHERE manager_id = ? AND period_of_report < ?
    ORDER BY period_of_report DESC LIMIT 1
  `).get(managerId, periodOfReport) as any;

  const priorMap = new Map<string, number>();
  if (priorPeriod) {
    const priorRows = db.prepare(`
      SELECT cusip, shares FROM hedge_fund_holdings
      WHERE manager_id = ? AND period_of_report = ?
    `).all(managerId, priorPeriod.period_of_report) as any[];
    for (const row of priorRows) {
      priorMap.set(row.cusip, row.shares);
    }
  }

  const currentCusips = new Set(current.map(e => e.cusip));

  const changes: HoldingChange[] = [];

  // Detect new, added, reduced
  for (const entry of current) {
    const ticker = resolveTicker(entry.cusip, entry.issuerName);
    const priorShares = priorMap.get(entry.cusip) ?? null;

    let changeType: HoldingChange['changeType'];
    let pctChange: number | null = null;
    let isSignificant = false;

    if (priorShares === null) {
      changeType = 'new';
      isSignificant = true;
    } else {
      pctChange = (entry.shares - priorShares) / priorShares;
      if (pctChange >= 0.10) {
        changeType = 'added';
        isSignificant = true;
      } else if (pctChange <= -0.10) {
        changeType = 'reduced';
        isSignificant = true;
      } else {
        changeType = pctChange >= 0 ? 'added' : 'reduced';
        isSignificant = false;
      }
    }

    changes.push({
      cusip: entry.cusip,
      ticker,
      issuerName: entry.issuerName,
      changeType,
      priorShares,
      currentShares: entry.shares,
      pctChange,
      currentValueThousands: entry.valueThousands,
      isSignificant,
    });
  }

  // Detect exited positions (in prior but not in current)
  for (const [cusip, priorShares] of priorMap.entries()) {
    if (!currentCusips.has(cusip)) {
      const row = db.prepare(
        `SELECT ticker, issuer_name FROM hedge_fund_holdings WHERE manager_id = ? AND cusip = ? LIMIT 1`
      ).get(managerId, cusip) as any;
      changes.push({
        cusip,
        ticker: row?.ticker ?? null,
        issuerName: row?.issuer_name ?? '',
        changeType: 'exited',
        priorShares,
        currentShares: 0,
        pctChange: -1,
        currentValueThousands: 0,
        isSignificant: true,
      });
    }
  }

  return changes;
}

function persistChanges(
  managerId: string,
  periodOfReport: string,
  _accn: string,
  changes: HoldingChange[]
): void {
  const insert = db.prepare(`
    INSERT INTO hedge_fund_changes
      (id, manager_id, period_of_report, cusip, ticker, issuer_name, change_type,
       prior_shares, current_shares, pct_change, current_value_thousands, is_significant)
    VALUES
      (@id, @manager_id, @period_of_report, @cusip, @ticker, @issuer_name, @change_type,
       @prior_shares, @current_shares, @pct_change, @current_value_thousands, @is_significant)
    ON CONFLICT(manager_id, period_of_report, cusip) DO UPDATE SET
      change_type = excluded.change_type,
      prior_shares = excluded.prior_shares,
      current_shares = excluded.current_shares,
      pct_change = excluded.pct_change,
      current_value_thousands = excluded.current_value_thousands,
      is_significant = excluded.is_significant
  `);

  const tx = db.transaction(() => {
    for (const c of changes) {
      insert.run({
        id: randomUUID(),
        manager_id: managerId,
        period_of_report: periodOfReport,
        cusip: c.cusip,
        ticker: c.ticker ?? null,
        issuer_name: c.issuerName,
        change_type: c.changeType,
        prior_shares: c.priorShares ?? null,
        current_shares: c.currentShares,
        pct_change: c.pctChange ?? null,
        current_value_thousands: c.currentValueThousands,
        is_significant: c.isSignificant ? 1 : 0,
      });
    }
  });
  tx();
}

function generateResearchEvents(
  manager: ManagerRow,
  periodOfReport: string,
  changes: HoldingChange[]
): void {
  const significant = changes.filter(c => c.isSignificant && c.ticker !== null);
  if (significant.length === 0) return;

  // Check for conviction: multiple funds making the same move
  const convictionBuys  = getConvictionMoves(periodOfReport, 'new',     3);
  const convictionAdded = getConvictionMoves(periodOfReport, 'added',   3);
  const convictionExits = getConvictionMoves(periodOfReport, 'exited',  3);

  const events = significant.map(c => {
    const sentiment: 'bullish' | 'bearish' =
      (c.changeType === 'new' || c.changeType === 'added') ? 'bullish' : 'bearish';

    const pctStr = c.pctChange !== null ? `${c.pctChange >= 0 ? '+' : ''}${(c.pctChange * 100).toFixed(0)}%` : '';
    const sharesStr = (c.currentShares / 1_000_000).toFixed(1) + 'M';
    const quarter   = formatQuarter(periodOfReport);

    const title = `${manager.name} ${c.changeType.toUpperCase()} ${c.ticker} ${pctStr ? pctStr + ' ' : ''}(${sharesStr} shares) — ${quarter} 13F`;

    const isConviction = c.ticker
      ? (c.changeType === 'new'  ? convictionBuys.has(c.ticker)
       : c.changeType === 'added' ? convictionAdded.has(c.ticker)
       : c.changeType === 'exited' ? convictionExits.has(c.ticker)
       : false)
      : false;

    let importance: number;
    if (c.changeType === 'new') importance = isConviction ? 0.90 : 0.78;
    else if (c.changeType === 'exited') importance = isConviction ? 0.90 : 0.80;
    else if (c.changeType === 'added') importance = isConviction ? 0.90 : 0.72;
    else importance = isConviction ? 0.90 : 0.65;

    return {
      sourceType: 'hedge_fund' as const,
      sourceId: `${manager.id}:${periodOfReport}:${c.cusip}`,
      symbol: c.ticker!,
      title,
      summary: `${manager.name} (${getManagerStyle(manager.id)}) ${c.changeType === 'new' ? 'initiated new position in' : c.changeType === 'exited' ? 'fully exited' : c.changeType + ' position in'} ${c.ticker} in ${quarter}.${isConviction ? ' Multiple funds making similar move — conviction signal.' : ''}`,
      sentiment,
      eventType: c.changeType === 'new' ? 'institutional_buy' : c.changeType === 'exited' ? 'institutional_exit' : c.changeType === 'added' ? 'institutional_added' : 'institutional_reduced',
      importance,
      url: null,
      payload: {
        managerId: manager.id,
        managerName: manager.name,
        changeType: c.changeType,
        priorShares: c.priorShares,
        currentShares: c.currentShares,
        pctChange: c.pctChange,
        valueThousands: c.currentValueThousands,
        periodOfReport,
        isConviction,
      },
      eventTimestamp: Date.parse(`${periodOfReport}T00:00:00Z`) || Date.now(),
    };
  });

  if (events.length > 0) {
    saveResearchEvents(events);
  }
}

function getConvictionMoves(periodOfReport: string, changeType: string, minFunds: number): Set<string> {
  const rows = db.prepare(`
    SELECT ticker, COUNT(DISTINCT manager_id) as fund_count
    FROM hedge_fund_changes
    WHERE period_of_report = ? AND change_type = ? AND is_significant = 1 AND ticker IS NOT NULL
    GROUP BY ticker
    HAVING fund_count >= ?
  `).all(periodOfReport, changeType, minFunds) as any[];
  return new Set(rows.map(r => r.ticker));
}

function getManagerStyle(managerId: string): string {
  const row = db.prepare('SELECT style FROM hedge_fund_managers WHERE id = ?').get(managerId) as any;
  return row?.style ?? 'unknown';
}

function formatQuarter(periodOfReport: string): string {
  const [year, month] = periodOfReport.split('-').map(Number);
  const q = Math.ceil(month / 3);
  return `Q${q} ${year}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function refreshAllHedgeFundHoldings(): Promise<{ processed: number; errors: number }> {
  const managers = db.prepare('SELECT id, name, cik FROM hedge_fund_managers WHERE active = 1').all() as ManagerRow[];

  let processed = 0;
  let errors = 0;

  for (const manager of managers) {
    try {
      const count = await fetch13FForManager(manager);
      processed += count;
    } catch (err: any) {
      console.error(`[HedgeFund] Error processing ${manager.name}: ${err?.message}`);
      errors++;
    }
    await delay(500); // 500ms between managers
  }

  if (errors === 0) {
    markDataSourceSuccess('hedge_fund_13f', processed, { managersChecked: managers.length });
  } else {
    markDataSourceFailure('hedge_fund_13f', `${errors} managers failed`, { managersChecked: managers.length, processed });
  }

  return { processed, errors };
}

export function getSignificantChanges(symbol?: string, limit = 50): any[] {
  const rows = symbol
    ? db.prepare(`
        SELECT c.*, m.name as manager_name, m.style as manager_style
        FROM hedge_fund_changes c
        JOIN hedge_fund_managers m ON c.manager_id = m.id
        WHERE c.is_significant = 1 AND c.ticker = ?
        ORDER BY c.created_at DESC LIMIT ?
      `).all(symbol, limit)
    : db.prepare(`
        SELECT c.*, m.name as manager_name, m.style as manager_style
        FROM hedge_fund_changes c
        JOIN hedge_fund_managers m ON c.manager_id = m.id
        WHERE c.is_significant = 1
        ORDER BY c.created_at DESC LIMIT ?
      `).all(limit);

  return rows as any[];
}

export function getHoldingsForSymbol(ticker: string): any[] {
  const rows = db.prepare(`
    SELECT h.*, m.name as manager_name, m.style as manager_style
    FROM hedge_fund_holdings h
    JOIN hedge_fund_managers m ON h.manager_id = m.id
    WHERE h.ticker = ?
    ORDER BY h.period_of_report DESC, h.value_thousands DESC
  `).all(ticker) as any[];
  return rows;
}

export function getOverlapSymbols(minFunds = 3): any[] {
  const rows = db.prepare(`
    SELECT ticker, COUNT(DISTINCT manager_id) as fund_count, SUM(value_thousands) as total_value_thousands,
           MAX(period_of_report) as latest_period
    FROM hedge_fund_holdings
    WHERE ticker IS NOT NULL
    GROUP BY ticker
    HAVING fund_count >= ?
    ORDER BY fund_count DESC, total_value_thousands DESC
  `).all(minFunds) as any[];
  return rows;
}

export function getSmartMoneySummary(): { topBuys: any[]; topSells: any[] } {
  const latestPeriod = db.prepare(
    `SELECT MAX(period_of_report) as period FROM hedge_fund_holdings`
  ).get() as any;

  if (!latestPeriod?.period) return { topBuys: [], topSells: [] };

  const topBuys = db.prepare(`
    SELECT ticker, issuer_name, COUNT(DISTINCT manager_id) as fund_count,
           SUM(current_value_thousands) as total_value_thousands
    FROM hedge_fund_changes
    WHERE period_of_report = ? AND change_type IN ('new', 'added') AND is_significant = 1 AND ticker IS NOT NULL
    GROUP BY ticker
    ORDER BY fund_count DESC, total_value_thousands DESC
    LIMIT 10
  `).all(latestPeriod.period) as any[];

  const topSells = db.prepare(`
    SELECT ticker, issuer_name, COUNT(DISTINCT manager_id) as fund_count,
           SUM(prior_shares) as prior_total_shares
    FROM hedge_fund_changes
    WHERE period_of_report = ? AND change_type IN ('reduced', 'exited') AND is_significant = 1 AND ticker IS NOT NULL
    GROUP BY ticker
    ORDER BY fund_count DESC, prior_total_shares DESC
    LIMIT 10
  `).all(latestPeriod.period) as any[];

  return { topBuys, topSells };
}

export function getAllManagers(): any[] {
  return db.prepare('SELECT * FROM hedge_fund_managers ORDER BY name ASC').all() as any[];
}
