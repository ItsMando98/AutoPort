import db from './db.js';

export interface DataSourceStatus {
  source: string;
  status: 'ok' | 'stale' | 'error' | 'idle';
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  itemCount: number | null;
  details: Record<string, any>;
  updatedAt: number;
}

export function upsertDataSourceStatus(params: {
  source: string;
  status: DataSourceStatus['status'];
  lastSuccessAt?: number | null;
  lastAttemptAt?: number | null;
  lastError?: string | null;
  itemCount?: number | null;
  details?: Record<string, any>;
}): void {
  db.prepare(`
    INSERT INTO data_source_status
      (source, status, last_success_at, last_attempt_at, last_error, item_count, details, updated_at)
    VALUES
      (@source, @status, @last_success_at, @last_attempt_at, @last_error, @item_count, @details, unixepoch())
    ON CONFLICT(source) DO UPDATE SET
      status = excluded.status,
      last_success_at = COALESCE(excluded.last_success_at, data_source_status.last_success_at),
      last_attempt_at = COALESCE(excluded.last_attempt_at, data_source_status.last_attempt_at),
      last_error = excluded.last_error,
      item_count = excluded.item_count,
      details = excluded.details,
      updated_at = unixepoch()
  `).run({
    source: params.source,
    status: params.status,
    last_success_at: params.lastSuccessAt ?? null,
    last_attempt_at: params.lastAttemptAt ?? Math.floor(Date.now() / 1000),
    last_error: params.lastError ?? null,
    item_count: params.itemCount ?? null,
    details: JSON.stringify(params.details ?? {}),
  });
}

export function markDataSourceSuccess(
  source: string,
  itemCount?: number,
  details?: Record<string, any>
): void {
  const now = Math.floor(Date.now() / 1000);
  upsertDataSourceStatus({
    source,
    status: 'ok',
    lastSuccessAt: now,
    lastAttemptAt: now,
    lastError: null,
    itemCount: itemCount ?? null,
    details,
  });
}

export function markDataSourceFailure(source: string, error: string, details?: Record<string, any>): void {
  upsertDataSourceStatus({
    source,
    status: 'error',
    lastAttemptAt: Math.floor(Date.now() / 1000),
    lastError: error,
    details,
  });
}

export function getDataSourceStatuses(): DataSourceStatus[] {
  const rows = db.prepare('SELECT * FROM data_source_status ORDER BY source ASC').all() as any[];
  return rows.map(row => ({
    source: row.source,
    status: row.status,
    lastSuccessAt: row.last_success_at ? row.last_success_at * 1000 : null,
    lastAttemptAt: row.last_attempt_at ? row.last_attempt_at * 1000 : null,
    lastError: row.last_error ?? null,
    itemCount: row.item_count ?? null,
    details: safeJson(row.details),
    updatedAt: row.updated_at * 1000,
  }));
}

export function getFreshnessSummary() {
  const now = Date.now();
  const statuses = getDataSourceStatuses();
  const latestPrice = getLatestTimestamp(
    `SELECT MAX(date) as latest FROM price_history`
  );
  const latestFundamentals = getLatestTimestamp(
    `SELECT MAX(updated_at) as latest FROM fundamentals`,
    true
  );
  const latestNews = getLatestTimestamp(
    `SELECT MAX(created_at) as latest FROM news_articles`,
    true
  );
  const latestResearch = getLatestTimestamp(
    `SELECT MAX(event_timestamp) as latest FROM research_events`,
    true
  );

  return {
    generatedAt: now,
    datasets: {
      priceHistory: latestPrice,
      fundamentals: latestFundamentals,
      news: latestNews,
      researchEvents: latestResearch,
    },
    sources: statuses,
  };
}

function getLatestTimestamp(sql: string, alreadyEpochSeconds = false): number | null {
  const row = db.prepare(sql).get() as any;
  const value = row?.latest;
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).getTime();
  }
  return alreadyEpochSeconds ? value * 1000 : value;
}

function safeJson(value: string | null): Record<string, any> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
