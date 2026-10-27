import { generateJson, AIBudgetExceededError } from '../aiService.js';
import { saveAgentObservations, saveSymbolTheses } from '../autonomy.js';
import db from '../db.js';
import { runFilingsCheck, getUnprocessedFilings, markFilingProcessed, type FilingRecord } from '../filings.js';
import { runInsidersCheck } from '../insiders.js';
import { getCachedPrices } from '../marketdata.js';
import { refreshPolygonNews } from '../news.js';
import { getStrategyFeedbackForPrompt } from '../performance.js';
import { saveResearchEvents, type ResearchSentiment } from '../research.js';
import { getLastScreenerResults } from '../screener.js';
import { WATCHLIST } from '../technicals.js';
import { BaseAgent } from './base.js';

interface PendingResearchItem {
  sourceType: 'news' | 'filing' | 'insider';
  sourceId: string;
  title: string;
  url: string | null;
  publishedAt: number;
  rawPayload: Record<string, any>;
}

interface ClassifiedResearchItem {
  symbols: string[];
  sentiment: ResearchSentiment;
  eventType: string;
  importance: number;
  summary: string;
}

// Daily Gemini call cap to prevent API overuse
let dailyCallDate = '';
let dailyCallCount = 0;
const DAILY_GEMINI_CAP = 80;

function checkAndIncrementDailyCallCount(): boolean {
  const today = new Date().toISOString().split('T')[0];
  if (today !== dailyCallDate) {
    dailyCallDate = today;
    dailyCallCount = 0;
  }
  if (dailyCallCount >= DAILY_GEMINI_CAP) return false;
  dailyCallCount += 1;
  return true;
}

export class ResearchIngestionAgent extends BaseAgent {
  readonly name = 'research_ingestion';
  readonly intervalMs = 60_000;
  readonly sourceKey = 'research_ingestion';

  private lastScheduledFilingsAt = 0;

  async run(): Promise<void> {
    const newsResult = await refreshPolygonNews(50);
    await this.runScheduledFilingsAndInsiders();

    const items = getNextPendingResearchItems(5);
    if (items.length === 0) {
      this.markSuccess(newsResult.saved, { processedItem: false });
      return;
    }

    let processed = 0;
    for (const item of items) {
      if (!checkAndIncrementDailyCallCount() && item.sourceType !== 'insider') break;
      const classified = await classifyResearchItem(item);
      const persisted = persistResearchItem(item, classified, getCachedPrices());
      publishResearchOutputs(item, classified, persisted.symbols, persisted.eventIds);
      processed += 1;
    }

    this.markSuccess(newsResult.saved + processed, {
      processedItem: processed > 0,
      itemsProcessed: processed,
    });
  }

  private async runScheduledFilingsAndInsiders(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScheduledFilingsAt < 4 * 60 * 60 * 1000) return;

    const screenerSymbols = getLastScreenerResults().slice(0, 15).map(candidate => candidate.symbol);
    const filingSymbols = screenerSymbols.length > 0 ? screenerSymbols : WATCHLIST;
    await runFilingsCheck(filingSymbols);

    const insiderSymbols = [...new Set([...WATCHLIST, ...screenerSymbols.slice(0, 10)])];
    await runInsidersCheck(insiderSymbols);
    this.lastScheduledFilingsAt = now;
  }
}

function getNextPendingResearchItems(limit = 5): PendingResearchItem[] {
  const items: PendingResearchItem[] = [];

  // Insiders first (highest priority — pre-classified, no Gemini needed)
  const insiders = db.prepare(`
    SELECT * FROM insider_trades
    WHERE processed = 0
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT ?
  `).all(limit) as any[];
  for (const insider of insiders) {
    items.push({
      sourceType: 'insider',
      sourceId: insider.id,
      title: `${insider.filer_name} ${insider.transaction_type === 'P' ? 'bought' : 'sold'} ${insider.symbol}`,
      url: insider.filing_url ?? null,
      publishedAt: toMs(insider.created_at),
      rawPayload: insider,
    });
    if (items.length >= limit) return items;
  }

  // Then filings
  for (const filing of getUnprocessedFilings()) {
    items.push(filingToPendingItem(filing));
    if (items.length >= limit) return items;
  }

  // Then news
  const remaining = limit - items.length;
  const newsRows = db.prepare(`
    SELECT * FROM news_articles
    WHERE processed = 0
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT ?
  `).all(remaining) as any[];
  for (const news of newsRows) {
    items.push({
      sourceType: 'news',
      sourceId: news.id,
      title: news.title,
      url: news.url,
      publishedAt: news.published_at ? news.published_at * 1000 : news.created_at * 1000,
      rawPayload: news,
    });
  }

  return items;
}

// Human-readable labels for high-signal 8-K items
const ITEM_LABELS: Record<string, string> = {
  '1.01': 'Material Agreement',
  '1.02': 'Agreement Terminated',
  '2.02': 'Earnings Results',
  '4.01': 'Auditor Change',
  '4.02': 'Financial Restatement Risk',
  '5.02': 'Executive/Director Change',
  '8.01': 'Material Press Release',
  '9.01': 'Exhibits',
};

function filingToPendingItem(filing: FilingRecord): PendingResearchItem {
  const isBeneficialOwnership = filing.form.startsWith('SC 13');
  const itemNums = filing.items ? filing.items.split(',').filter(Boolean) : [];
  const itemLabels = itemNums
    .map(n => ITEM_LABELS[n] ? `${n} (${ITEM_LABELS[n]})` : n)
    .join(', ');

  let title: string;
  if (isBeneficialOwnership) {
    title = `[13D/13G] ${filing.symbol} filed ${filing.form}: ${filing.description}`;
  } else if (itemLabels) {
    title = `[${filing.form}] ${filing.symbol}: ${filing.description} — Items: ${itemLabels}`;
  } else {
    title = `[${filing.form}] ${filing.symbol}: ${filing.description}`;
  }

  return {
    sourceType: 'filing',
    sourceId: filing.id,
    title,
    url: filing.url,
    publishedAt: Date.parse(`${filing.filed}T00:00:00Z`),
    rawPayload: { ...filing, isBeneficialOwnership, itemLabels },
  };
}

async function classifyResearchItem(item: PendingResearchItem): Promise<ClassifiedResearchItem> {
  if (item.sourceType === 'insider') {
    const significance = String(item.rawPayload.significance ?? 'neutral');
    const sentiment: ResearchSentiment = significance.includes('bullish')
      ? 'bullish'
      : significance.includes('bearish')
        ? 'bearish'
        : 'neutral';

    return {
      symbols: [String(item.rawPayload.symbol).toUpperCase()],
      sentiment,
      eventType: 'insider_transaction',
      importance: significance.startsWith('very_') ? 0.95 : 0.75,
      summary: `${item.rawPayload.filer_name} ${item.rawPayload.transaction_type === 'P' ? 'bought' : 'sold'} ${Number(item.rawPayload.shares).toLocaleString()} shares at $${Number(item.rawPayload.price_per_share ?? 0).toFixed(2)}.`,
    };
  }

  const universe = [...WATCHLIST, ...db.prepare('SELECT symbol FROM screener_results ORDER BY score DESC LIMIT 15').all().map((row: any) => row.symbol)];
  const strategyFeedback = await getStrategyFeedbackForPrompt();

  // Build filing-specific context to guide importance calibration
  let filingContext = '';
  if (item.sourceType === 'filing') {
    if (item.rawPayload.isBeneficialOwnership) {
      filingContext = `\nFILING CONTEXT: This is a 13D/13G beneficial ownership disclosure — an institution has crossed the >5% ownership threshold. This is high-signal institutional activity. Set importance >= 0.82.\n`;
    } else if (item.rawPayload.itemLabels) {
      const hasEarnings   = String(item.rawPayload.items ?? '').includes('2.02');
      const hasLeadership = String(item.rawPayload.items ?? '').includes('5.02');
      const hasRestatement = String(item.rawPayload.items ?? '').includes('4.02');
      const importanceHint = hasEarnings || hasRestatement ? 'Set importance >= 0.85.'
        : hasLeadership ? 'Set importance >= 0.75.'
        : 'Set importance >= 0.65.';
      filingContext = `\nFILING ITEMS: ${item.rawPayload.itemLabels}\n${importanceHint}\n`;
    }
  }

  const prompt = `
You classify external market research into structured events.
Read the URL if available and use the title/source for context.

SOURCE TYPE: ${item.sourceType}
TITLE: ${item.title}
URL: ${item.url ?? 'N/A'}
TRACKED SYMBOLS: ${[...new Set(universe)].join(', ')}
${filingContext}
STRATEGY PERFORMANCE FEEDBACK:
${strategyFeedback}
Use this to avoid repeating confirmed mistakes and to up-weight signals consistent with past wins.

Return JSON:
- symbols: impacted tracked symbols only (e.g. ["AAPL"])
- sentiment: "bullish", "bearish", or "neutral"
- eventType: concise snake_case label (e.g. "earnings_report", "sec_filing", "product_launch")
- importance: number between 0 and 1
- summary: 2 concise sentences
  `;

  const parsed = await generateJson<any>({
    prompt,
    systemPrompt: 'You classify external market research into structured events. Reply strictly with valid JSON.',
    purpose: 'research_ingestion',
  });

  return {
    symbols: Array.isArray(parsed?.symbols)
      ? parsed.symbols.map((symbol: string) => String(symbol).toUpperCase()).filter((symbol: string) => WATCHLIST.includes(symbol) || universe.includes(symbol))
      : [],
    sentiment: normalizeSentiment(parsed?.sentiment),
    eventType: parsed?.eventType || 'general',
    importance: clamp(Number(parsed?.importance) || 0.5, 0, 1),
    summary: parsed?.summary || item.title,
  };
}

function persistResearchItem(
  item: PendingResearchItem,
  classified: ClassifiedResearchItem,
  prices: Record<string, number>,
): { eventIds: string[]; symbols: string[] } {
  const symbols = classified.symbols.length > 0 ? classified.symbols : ['MARKET'];
  const eventIds = saveResearchEvents(symbols.map(symbol => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    symbol,
    title: item.title,
    summary: classified.summary,
    sentiment: classified.sentiment,
    eventType: classified.eventType,
    importance: classified.importance,
    url: item.url,
    payload: item.rawPayload,
    eventTimestamp: item.publishedAt,
  })));

  for (const symbol of symbols) {
    if (symbol === 'MARKET') continue;
    saveAnalysisLikeRecord(symbol, item.sourceId, classified, prices[symbol] ?? null);
  }

  if (item.sourceType === 'news') {
    db.prepare(`
      UPDATE news_articles
      SET processed = 1,
          summary = @summary,
          sentiment = @sentiment,
          relevant_symbols = @relevant_symbols
      WHERE id = @id
    `).run({
      id: item.sourceId,
      summary: classified.summary,
      sentiment: classified.sentiment,
      relevant_symbols: JSON.stringify(classified.symbols),
    });
  } else if (item.sourceType === 'filing') {
    markFilingProcessed(item.sourceId, classified.summary);
  } else {
    db.prepare('UPDATE insider_trades SET processed = 1 WHERE id = ?').run(item.sourceId);
  }

  db.prepare(`
    INSERT INTO engine_logs (id, timestamp, log_type, asset, content, action, status)
    VALUES (hex(randomblob(16)), ?, 'MONITOR', 'research_events', ?, ?, 'COMPLETED')
  `).run(Date.now(), `Persisted ${eventIds.length} research events`, item.sourceType);

  return { eventIds, symbols };
}

function saveAnalysisLikeRecord(
  symbol: string,
  sourceId: string,
  classified: ClassifiedResearchItem,
  priceAtAnalysis: number | null,
): void {
  const action = classified.sentiment === 'bullish' ? 'BUY' : classified.sentiment === 'bearish' ? 'SELL' : 'HOLD';
  db.prepare(`
    INSERT INTO analyses (symbol, article_id, action, confidence, reasoning, price_at_analysis, technical_context)
    VALUES (@symbol, @article_id, @action, @confidence, @reasoning, @price_at_analysis, @technical_context)
  `).run({
    symbol,
    article_id: sourceId,
    action,
    confidence: Math.round(classified.importance * 100),
    reasoning: classified.summary,
    price_at_analysis: priceAtAnalysis,
    technical_context: JSON.stringify({ eventType: classified.eventType, sentiment: classified.sentiment }),
  });
}

function normalizeSentiment(input: string): ResearchSentiment {
  const normalized = String(input ?? '').toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') return normalized;
  return 'neutral';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function publishResearchOutputs(
  item: PendingResearchItem,
  classified: ClassifiedResearchItem,
  symbols: string[],
  eventIds: string[],
): void {
  const expiryMs = item.publishedAt + (item.sourceType === 'news' ? 48 : 72) * 60 * 60 * 1000;
  const observationIds = saveAgentObservations(symbols.map(symbol => ({
    agentName: 'research_ingestion',
    sourceKey: 'research_ingestion',
    symbol,
    topic: item.sourceType,
    observationType: classified.eventType,
    confidence: classified.importance,
    details: {
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      summary: classified.summary,
      sentiment: classified.sentiment,
      researchEventIds: eventIds,
    },
    observedAt: item.publishedAt,
    expiresAt: expiryMs,
  })));

  if (classified.importance < 0.55) return;

  const stance = classified.sentiment === 'bullish'
    ? 'BUY'
    : classified.sentiment === 'bearish'
      ? 'SELL'
      : 'HOLD';

  saveSymbolTheses(symbols
    .filter(symbol => symbol !== 'MARKET')
    .map(symbol => ({
      agentName: 'research_ingestion',
      sourceKey: 'research_ingestion',
      symbol,
      stance,
      confidence: classified.importance,
      horizon: item.sourceType === 'filing' ? '2w' : '1w',
      catalyst: classified.eventType,
      invalidation: 'Fresh contradictory filings, news, or insider activity.',
      thesis: classified.summary,
      supportingObservationIds: observationIds,
      freshnessScore: item.sourceType === 'news' ? 0.75 : 0.85,
      createdAt: item.publishedAt,
      expiresAt: expiryMs,
    })));
}

function toMs(epochSeconds: number | null | undefined): number {
  return (epochSeconds ?? Math.floor(Date.now() / 1000)) * 1000;
}
