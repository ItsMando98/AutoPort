/**
 * AI Knowledge Base — Compound Memory
 *
 * After every 10 analyses of a symbol, Gemini consolidates them into a persistent
 * investment profile: bull thesis, bear thesis, news sensitivity, patterns.
 *
 * This profile is injected into every future Gemini prompt for that symbol,
 * allowing the AI to build on its own experience rather than starting from scratch.
 *
 * Storage: company_knowledge table, knowledge_type = 'profile'
 * Format:  JSON in content field, sources_count = # analyses used
 */

import { generateJson } from './aiService.js';
import db from './db.js';
import { getFundamentals } from './fundamentals.js';

export interface KnowledgeProfile {
  symbol: string;
  bull_thesis: string;
  bear_thesis: string;
  news_sensitivity: string;
  pattern_notes: string;
  avg_confidence: number;
  analysis_count: number;
  updated_at: number;
}

// ─── DB Reads ─────────────────────────────────────────────────────────────────

export function getProfile(symbol: string): KnowledgeProfile | null {
  const row = db.prepare(`
    SELECT content, sources_count, updated_at
    FROM company_knowledge
    WHERE symbol = ? AND knowledge_type = 'profile'
    ORDER BY updated_at DESC LIMIT 1
  `).get(symbol) as any;

  if (!row) return null;
  try {
    const parsed = JSON.parse(row.content);
    return {
      symbol,
      ...parsed,
      analysis_count: row.sources_count,
      updated_at:     row.updated_at * 1000,
    };
  } catch {
    return null;
  }
}

export function getAllProfiles(): Record<string, KnowledgeProfile | null> {
  const rows = db.prepare(`
    SELECT ck.symbol, ck.content, ck.sources_count, ck.updated_at
    FROM company_knowledge ck
    INNER JOIN (
      SELECT symbol, MAX(updated_at) AS max_at
      FROM company_knowledge WHERE knowledge_type = 'profile'
      GROUP BY symbol
    ) latest ON ck.symbol = latest.symbol AND ck.updated_at = latest.max_at
    WHERE ck.knowledge_type = 'profile'
  `).all() as any[];

  const result: Record<string, KnowledgeProfile | null> = {};
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.content);
      result[row.symbol] = {
        symbol: row.symbol, ...parsed,
        analysis_count: row.sources_count,
        updated_at:     row.updated_at * 1000,
      };
    } catch { /* skip corrupt rows */ }
  }
  return result;
}

// ─── Consolidation Logic ──────────────────────────────────────────────────────

function getAnalysisCount(symbol: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as n FROM analyses WHERE symbol = ? AND symbol != 'MARKET'"
  ).get(symbol) as any;
  return row?.n ?? 0;
}

function getLastConsolidationCount(symbol: string): number {
  const row = db.prepare(
    "SELECT sources_count FROM company_knowledge WHERE symbol = ? AND knowledge_type = 'profile' ORDER BY updated_at DESC LIMIT 1"
  ).get(symbol) as any;
  return row?.sources_count ?? 0;
}

/**
 * Returns true if enough new analyses have accumulated since last consolidation.
 * Thresholds: first at 5 analyses, then every 10 additional.
 */
export function shouldConsolidate(symbol: string): boolean {
  const count = getAnalysisCount(symbol);
  if (count < 5) return false; // not enough data yet
  const lastCount = getLastConsolidationCount(symbol);
  return (count - lastCount) >= 10 || (lastCount === 0 && count >= 5);
}

/**
 * Consolidates all analyses for a symbol into a knowledge profile.
 * Calls Gemini — runs asynchronously, never blocks the trading cycle.
 */
export async function consolidate(symbol: string): Promise<void> {
  const totalCount = getAnalysisCount(symbol);
  console.log(`[Knowledge] Consolidating ${symbol} (${totalCount} analyses)...`);

  // Fetch up to 50 most recent analyses
  const analyses = db.prepare(`
    SELECT action, confidence, reasoning, price_at_analysis, created_at
    FROM analyses
    WHERE symbol = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(symbol) as any[];

  if (analyses.length < 5) return;

  // Include fundamentals for context
  const fund = getFundamentals(symbol);
  const fundContext = fund
    ? `P/E: ${fund.peRatio?.toFixed(1) ?? 'N/A'} | Revenue Growth: ${fund.revenueGrowth !== null ? (fund.revenueGrowth * 100).toFixed(1) + '%' : 'N/A'} | Profit Margin: ${fund.profitMargin !== null ? (fund.profitMargin * 100).toFixed(1) + '%' : 'N/A'}`
    : 'No fundamental data available';

  // Format analysis history
  const history = analyses
    .map((a, i) => {
      const date = new Date(a.created_at * 1000).toISOString().split('T')[0];
      const price = a.price_at_analysis ? ` @ $${Number(a.price_at_analysis).toFixed(2)}` : '';
      return `#${i + 1} [${date}] ${a.action} (confidence: ${a.confidence}%)${price}\n   ${a.reasoning}`;
    })
    .join('\n\n');

  const avgConf = analyses.reduce((s, a) => s + (a.confidence ?? 0), 0) / analyses.length;

  const prompt = `\
You are building a compound investment knowledge profile for ${symbol}.
This profile will be injected into future AI trading prompts to help the AI avoid repeating mistakes.

FUNDAMENTAL SNAPSHOT:
${fundContext}

RECENT AI ANALYSES (${analyses.length} of ${totalCount} total shown, newest first):
${history}

Based on this trading history, extract durable investment knowledge.
Be specific, data-driven, and concise. Avoid generic statements.

Return JSON with exactly these fields:
- bull_thesis: 2 sentences on WHY this stock goes up (specific catalysts, competitive moat)
- bear_thesis: 2 sentences on KEY RISKS and what could cause a sharp decline
- news_sensitivity: 1-2 sentences on WHICH SPECIFIC news types consistently drive strong signals (be precise: "GPU allocation announcements" not just "tech news")
- pattern_notes: 1-2 sentences on behavioral patterns observed (e.g. overbought tendency, reaction to earnings beats, volatility character)
- avg_confidence: ${avgConf.toFixed(1)} (use this exact value — it's the calculated average)`;

  try {
    const profile = await generateJson<any>({
      prompt,
      systemPrompt: 'You extract durable investment knowledge profiles from financial analysis history. Respond strictly with a valid JSON object.',
      purpose: 'knowledge_consolidation',
    });

    if (!profile?.bull_thesis) return;

    // Upsert into company_knowledge
    const existing = db.prepare(
      "SELECT id FROM company_knowledge WHERE symbol = ? AND knowledge_type = 'profile'"
    ).get(symbol) as any;

    const content = JSON.stringify(profile);

    if (existing) {
      db.prepare(`
        UPDATE company_knowledge
        SET content = @content, sources_count = @sources_count, updated_at = unixepoch()
        WHERE id = @id
      `).run({ id: existing.id, content, sources_count: totalCount });
    } else {
      db.prepare(`
        INSERT INTO company_knowledge (symbol, knowledge_type, content, confidence, sources_count)
        VALUES (@symbol, 'profile', @content, @confidence, @sources_count)
      `).run({ symbol, content, confidence: avgConf / 100, sources_count: totalCount });
    }

    console.log(`[Knowledge] ${symbol}: profile consolidated from ${totalCount} analyses ✓`);
  } catch (err: any) {
    console.error(`[Knowledge] Consolidation failed for ${symbol}: ${err?.message}`);
  }
}

/**
 * Background check: consolidate any symbol that needs it.
 * Called once after server startup and periodically.
 */
export async function consolidateAllIfNeeded(symbols: string[]): Promise<void> {
  for (const sym of symbols) {
    if (shouldConsolidate(sym)) {
      await consolidate(sym);
      // Small delay between Gemini calls
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ─── Prompt Formatting ────────────────────────────────────────────────────────

/**
 * Returns a compact multi-line knowledge section for the Gemini prompt.
 * Only includes symbols that have a profile (avoids empty entries).
 */
export function formatKnowledgeForPrompt(profiles: Record<string, KnowledgeProfile | null>): string {
  const lines: string[] = [];

  for (const [symbol, p] of Object.entries(profiles)) {
    if (!p) continue;
    lines.push(
      `${symbol.padEnd(5)} [${p.analysis_count} analyses]\n` +
      `  Bull: ${p.bull_thesis}\n` +
      `  Bear: ${p.bear_thesis}\n` +
      `  Sensitivity: ${p.news_sensitivity}`
    );
  }

  return lines.length > 0 ? lines.join('\n\n') : 'No accumulated knowledge yet — profiles build after 5+ analyses per symbol.';
}
