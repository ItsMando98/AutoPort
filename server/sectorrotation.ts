/**
 * Sector Rotation Analysis
 *
 * Computes relative strength between the 7 market sectors tracked in the
 * universe. Uses stored price_history to calculate 1-week, 1-month, and
 * 3-month returns for each sector.
 *
 * The agent uses this to:
 * - Avoid buying into sectors with persistent outflow
 * - Increase confidence when news aligns with sector inflow
 * - Suggest portfolio rebalancing when rotation is significant
 */

import db from './db.js';
import { COMPANY_INFO, getSector, ALL_SYMBOLS } from './universe.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectorTrend = 'strong_inflow' | 'inflow' | 'neutral' | 'outflow' | 'strong_outflow';

export interface SectorPerformance {
  sector:       string;
  symbols:      string[];
  return1w:     number;   // % (last 5 trading days)
  return1m:     number;   // % (last 20 trading days)
  return3m:     number;   // % (last 60 trading days)
  relStrength:  number;   // vs market average (1w)
  trend:        SectorTrend;
  best:         { symbol: string; return1w: number } | null;
  worst:        { symbol: string; return1w: number } | null;
  symbolCount:  number;   // how many symbols have data
}

// ─── Price Return Calculation ─────────────────────────────────────────────────

function getReturn(symbol: string, days: number): number | null {
  const rows = db.prepare(`
    SELECT close FROM price_history
    WHERE symbol = ?
    ORDER BY date DESC LIMIT ?
  `).all(symbol, days + 1) as any[];

  if (rows.length < 2) return null;
  const current = rows[0].close;
  const past    = rows[rows.length - 1].close;
  if (past <= 0) return null;
  return ((current - past) / past) * 100;
}

// ─── Sector Computation ───────────────────────────────────────────────────────

export function calculateSectorPerformance(): SectorPerformance[] {
  // Group all symbols by sector
  const sectorMap: Record<string, string[]> = {};
  for (const sym of ALL_SYMBOLS) {
    const sector = getSector(sym);
    if (!sectorMap[sector]) sectorMap[sector] = [];
    sectorMap[sector].push(sym);
  }

  const results: SectorPerformance[] = [];

  for (const [sector, symbols] of Object.entries(sectorMap)) {
    const symbolData: Array<{
      symbol: string;
      r1w: number | null;
      r1m: number | null;
      r3m: number | null;
    }> = [];

    for (const sym of symbols) {
      symbolData.push({
        symbol: sym,
        r1w: getReturn(sym, 5),
        r1m: getReturn(sym, 20),
        r3m: getReturn(sym, 60),
      });
    }

    const withData = symbolData.filter(d => d.r1w !== null);
    if (withData.length === 0) continue;

    // Average returns across symbols in sector
    const avg1w = withData.reduce((s, d) => s + (d.r1w ?? 0), 0) / withData.length;
    const avg1m = withData.filter(d => d.r1m !== null).reduce((s, d) => s + (d.r1m ?? 0), 0) /
                  (withData.filter(d => d.r1m !== null).length || 1);
    const avg3m = withData.filter(d => d.r3m !== null).reduce((s, d) => s + (d.r3m ?? 0), 0) /
                  (withData.filter(d => d.r3m !== null).length || 1);

    // Best and worst 1-week performers in sector
    const sorted = [...withData].sort((a, b) => (b.r1w ?? 0) - (a.r1w ?? 0));
    const best  = sorted[0]
      ? { symbol: sorted[0].symbol, return1w: parseFloat((sorted[0].r1w ?? 0).toFixed(1)) }
      : null;
    const worst = sorted[sorted.length - 1]
      ? { symbol: sorted[sorted.length - 1].symbol, return1w: parseFloat((sorted[sorted.length - 1].r1w ?? 0).toFixed(1)) }
      : null;

    results.push({
      sector,
      symbols,
      return1w:    parseFloat(avg1w.toFixed(2)),
      return1m:    parseFloat(avg1m.toFixed(2)),
      return3m:    parseFloat(avg3m.toFixed(2)),
      relStrength: 0, // filled after computing market average
      trend:       'neutral',
      best,
      worst,
      symbolCount: withData.length,
    });
  }

  // Compute relative strength vs market average
  const marketAvg1w = results.reduce((s, r) => s + r.return1w, 0) / (results.length || 1);
  for (const r of results) {
    r.relStrength = parseFloat((r.return1w - marketAvg1w).toFixed(2));
    r.trend = classifyTrend(r.return1w, r.return1m, r.relStrength);
  }

  return results.sort((a, b) => b.return1w - a.return1w);
}

function classifyTrend(r1w: number, r1m: number, relStrength: number): SectorTrend {
  // Strong inflow: sector outperforms market AND positive both timeframes
  if (relStrength > 1.5 && r1w > 0 && r1m > 0)  return 'strong_inflow';
  if (relStrength > 0.5 && r1w > 0)              return 'inflow';
  if (relStrength < -1.5 && r1w < 0 && r1m < 0) return 'strong_outflow';
  if (relStrength < -0.5 && r1w < 0)             return 'outflow';
  return 'neutral';
}

// ─── Rotation Signal ──────────────────────────────────────────────────────────

/**
 * Returns a compact description of current rotation for logging / UI.
 */
export function getRotationSummary(sectors: SectorPerformance[]): string {
  const inflow  = sectors.filter(s => s.trend === 'strong_inflow' || s.trend === 'inflow');
  const outflow = sectors.filter(s => s.trend === 'strong_outflow' || s.trend === 'outflow');

  const parts: string[] = [];
  if (inflow.length > 0) {
    parts.push(`Inflow: ${inflow.map(s => s.sector.replace(' ', '')).join(', ')}`);
  }
  if (outflow.length > 0) {
    parts.push(`Outflow: ${outflow.map(s => s.sector.replace(' ', '')).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'No significant rotation';
}

// ─── Prompt Formatting ────────────────────────────────────────────────────────

const TREND_EMOJI: Record<SectorTrend, string> = {
  strong_inflow:   '↑↑',
  inflow:          '↑',
  neutral:         '→',
  outflow:         '↓',
  strong_outflow:  '↓↓',
};

export function formatSectorForPrompt(sectors: SectorPerformance[]): string {
  if (sectors.length === 0) return 'No sector data available.';

  const lines = sectors.map(s => {
    const r1w = (s.return1w >= 0 ? '+' : '') + s.return1w.toFixed(1) + '%';
    const r1m = (s.return1m >= 0 ? '+' : '') + s.return1m.toFixed(1) + '%';
    const rel = (s.relStrength >= 0 ? '+' : '') + s.relStrength.toFixed(1) + '%';
    return `${s.sector.padEnd(24)} | ${r1w.padStart(7)} / ${r1m.padStart(7)} | vs mkt: ${rel.padStart(6)} | ${TREND_EMOJI[s.trend]}`;
  });

  const calibration = [
    '• Stock in OUTFLOW sector → reduce BUY confidence by 20%',
    '• Stock in INFLOW sector + oversold RSI → increase confidence by 15%',
    '• STRONG_OUTFLOW sector → avoid new BUYs entirely',
  ].join('\n');

  return lines.join('\n') + '\n\nCALIBRATION:\n' + calibration;
}

/**
 * Returns the trend for a specific symbol's sector.
 * Used by the agent to adjust per-symbol confidence.
 */
export function getSectorTrendForSymbol(symbol: string, sectors: SectorPerformance[]): SectorTrend {
  const sector = getSector(symbol);
  return sectors.find(s => s.sector === sector)?.trend ?? 'neutral';
}
