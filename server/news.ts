import { randomUUID } from 'crypto';
import db from './db.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';
import { ALL_SYMBOLS } from './universe.js';

// Securities-class-action law-firm solicitation press releases ("Rosen Law
// Firm Reminds Investors...", "Lead Plaintiff Deadline...") are wire noise —
// legally required PR, not market-moving information — that otherwise pile
// up as top "Market"-level stories and drown out real news.
const BOILERPLATE_TITLE_PATTERN = /class action|lead plaintiff|shareholder rights law firm|securities fraud|investor alert|encourages investors to (contact|secure)/i;

function isBoilerplatePressRelease(title: string): boolean {
  return BOILERPLATE_TITLE_PATTERN.test(title);
}

export interface SavedNewsArticle {
  id: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: number | null;
  processed: boolean;
  summary: string | null;
  sentiment: string | null;
  relevantSymbols: string[];
  createdAt: number;
}

/**
 * Fetch recent market news from Polygon.io.
 * Returns structured articles with pre-tagged tickers, direct URLs, and publisher metadata.
 * Falls back to Yahoo RSS if POLYGON_API_KEY is not set.
 */
export async function refreshPolygonNews(limit = 50): Promise<{ saved: number; total: number }> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return refreshYahooFinanceNews(limit);

  try {
    const url = `https://api.polygon.io/v2/reference/news?limit=${limit}&order=desc&sort=published_utc&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon news API ${res.status}`);
    const data = await res.json();
    if (data.status === 'ERROR') throw new Error(data.error ?? 'Polygon API error');

    const articles: any[] = data.results ?? [];

    const insert = db.prepare(`
      INSERT OR IGNORE INTO news_articles (id, title, url, source, published_at, relevant_symbols, polygon_insights, keywords)
      VALUES (@id, @title, @url, @source, @published_at, @relevant_symbols, @polygon_insights, @keywords)
    `);

    const saveMany = db.transaction((rows: any[]) => {
      let saved = 0;
      for (const article of rows) {
        if (isBoilerplatePressRelease(article.title ?? '')) continue;
        const tickers = (article.tickers ?? []).map((t: string) => t.toUpperCase());
        const relevantTickers = tickers.filter((t: string) => ALL_SYMBOLS.includes(t));
        // Polygon pre-computes per-ticker sentiment + reasoning ("insights") and topical
        // keywords on the same call — captured here for downstream use, not yet consumed
        // by the classification pipeline (which still derives its own sentiment via LLM).
        const result = insert.run({
          id:               article.id ?? article.article_url ?? randomUUID(),
          title:            article.title,
          url:              article.article_url,
          source:           article.publisher?.name ?? 'Polygon',
          published_at:     article.published_utc
            ? Math.floor(new Date(article.published_utc).getTime() / 1000)
            : null,
          relevant_symbols: relevantTickers.length > 0 ? JSON.stringify(relevantTickers) : null,
          polygon_insights: article.insights ? JSON.stringify(article.insights) : null,
          keywords:         article.keywords ? JSON.stringify(article.keywords) : null,
        });
        if (result.changes > 0) saved++;
      }
      return saved;
    });

    const saved = saveMany(articles);
    markDataSourceSuccess('news_feed', articles.length, { saved, source: 'polygon' });
    return { saved, total: articles.length };
  } catch (err: any) {
    markDataSourceFailure('news_feed', err?.message ?? 'Polygon news error');
    return refreshYahooFinanceNews(limit);
  }
}

export async function refreshYahooFinanceNews(limit = 30): Promise<{ saved: number; total: number }> {
  const rssUrl = 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Fnews%2Frssindex';
  try {
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`RSS2JSON ${res.status}`);
    const data = await res.json();
    const items = (data.items ?? []).slice(0, limit);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO news_articles (id, title, url, source, published_at)
      VALUES (@id, @title, @url, @source, @published_at)
    `);

    const saveMany = db.transaction((rows: any[]) => {
      let saved = 0;
      for (const item of rows) {
        if (isBoilerplatePressRelease(item.title ?? '')) continue;
        const result = insert.run({
          id: item.link || randomUUID(),
          title: item.title,
          url: item.link,
          source: item.author || 'Yahoo Finance',
          published_at: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : null,
        });
        if (result.changes > 0) saved++;
      }
      return saved;
    });

    const saved = saveMany(items);
    markDataSourceSuccess('news_feed', items.length, { saved });
    return { saved, total: items.length };
  } catch (err: any) {
    markDataSourceFailure('news_feed', err?.message ?? 'Unknown news fetch error');
    throw err;
  }
}

export function getStoredNews(limit = 100): SavedNewsArticle[] {
  const rows = db.prepare(`
    SELECT * FROM news_articles
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source ?? null,
    publishedAt: row.published_at ? row.published_at * 1000 : null,
    processed: row.processed === 1,
    summary: row.summary ?? null,
    sentiment: row.sentiment ?? null,
    relevantSymbols: parseSymbols(row.relevant_symbols),
    createdAt: row.created_at * 1000,
  }));
}

function parseSymbols(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
