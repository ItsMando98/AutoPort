import db from './db.js';
import { getBrokerMode, isBrokerConnected } from './broker.js';
import { getDataSourceStatuses } from './ops.js';
import { getMarketDataStatus } from './marketdata.js';
import { getReconciliationStatus } from './reconciliation.js';

const LIVE_PRICE_STALE_MS = 60_000;
const PAPER_PRICE_STALE_MS = 5 * 60_000;
const RECONCILIATION_STALE_MS = 3 * 60_000;
const STABILITY_WINDOW_MS = 5 * 60_000;

export interface DegradationSignal {
  id: 'broker_connectivity' | 'broker_submission' | 'broker_reconciliation' | 'live_price_freshness' | 'quote_fallback';
  severity: 'none' | 'warning' | 'critical';
  detail: string;
}

export interface DegradationStatus {
  severity: 'none' | 'warning' | 'critical';
  signals: DegradationSignal[];
  liveAutoLockEngaged: boolean;
  liveAutoLockReason: string | null;
  executionAllowedLive: boolean;
  executionAllowedPaper: boolean;
  lastCriticalAt: number | null;
  lastHealthyAt: number | null;
  stableAfter: number | null;
  updatedAt: number | null;
}

export function getDegradationStatus(): DegradationStatus {
  const row = db.prepare(`
    SELECT *
    FROM system_degradation_state
    WHERE id = 1
    LIMIT 1
  `).get() as any;

  return {
    severity: row?.severity ?? 'none',
    signals: safeJson(row?.details).signals ?? [],
    liveAutoLockEngaged: Boolean(row?.live_auto_lock_engaged),
    liveAutoLockReason: row?.live_auto_lock_reason ?? null,
    executionAllowedLive: Boolean(row?.execution_allowed_live),
    executionAllowedPaper: Boolean(row?.execution_allowed_paper),
    lastCriticalAt: row?.last_critical_at ? row.last_critical_at * 1000 : null,
    lastHealthyAt: row?.last_healthy_at ? row.last_healthy_at * 1000 : null,
    stableAfter: row?.stable_after ? row.stable_after * 1000 : null,
    updatedAt: row?.updated_at ? row.updated_at * 1000 : null,
  };
}

export function refreshDegradationState(now = Date.now()): DegradationStatus {
  const current = getDegradationStatus();
  const statuses = getDataSourceStatuses();
  const bySource = new Map(statuses.map(status => [status.source, status]));
  const mode = getBrokerMode() === 'live' ? 'live' : 'paper';
  const marketData = getMarketDataStatus(mode);
  const reconciliation = getReconciliationStatus();

  const livePrices = bySource.get('live_prices');
  const brokerSubmit = bySource.get('broker_submit');
  const signals: DegradationSignal[] = [];

  const brokerConnectivitySeverity = getBrokerMode() === 'live' && !isBrokerConnected() ? 'critical' : 'none';
  signals.push({
    id: 'broker_connectivity',
    severity: brokerConnectivitySeverity,
    detail: brokerConnectivitySeverity === 'critical'
      ? 'Live broker mode is configured but broker connectivity is unavailable.'
      : 'Broker connectivity is healthy for the current mode.',
  });

  const brokerSubmissionSeverity = brokerSubmit?.status === 'error' ? (getBrokerMode() === 'live' ? 'critical' : 'warning') : 'none';
  signals.push({
    id: 'broker_submission',
    severity: brokerSubmissionSeverity,
    detail: brokerSubmit?.lastError ?? 'Recent broker submissions are healthy.',
  });

  const reconciliationStale = Boolean(reconciliation.lastSuccessAt && (now - reconciliation.lastSuccessAt > RECONCILIATION_STALE_MS));
  const reconciliationSeverity = reconciliation.lastError
    ? (getBrokerMode() === 'live' ? 'critical' : 'warning')
    : reconciliationStale
      ? 'warning'
      : 'none';
  signals.push({
    id: 'broker_reconciliation',
    severity: reconciliationSeverity,
    detail: reconciliation.lastError
      ? reconciliation.lastError
      : reconciliationStale
        ? 'Broker reconciliation heartbeat is stale.'
        : 'Broker reconciliation heartbeat is healthy.',
  });

  const livePriceCritical =
    Boolean(marketData.lastError) ||
    (marketData.staleMs !== null && marketData.staleMs > LIVE_PRICE_STALE_MS) ||
    (livePrices?.details?.source === 'stored_eod_fallback' && getBrokerMode() === 'live');
  const polygonDelayed = livePrices?.details?.source === 'polygon';
  const eodFallback = livePrices?.details?.source === 'stored_eod_fallback';
  const livePriceWarning =
    !livePriceCritical &&
    Boolean(
      (marketData.staleMs !== null && marketData.staleMs > PAPER_PRICE_STALE_MS) ||
      eodFallback ||
      (polygonDelayed && getBrokerMode() === 'live')
    );
  signals.push({
    id: 'live_price_freshness',
    severity: livePriceCritical ? 'critical' : livePriceWarning ? 'warning' : 'none',
    detail: marketData.lastError
      ? marketData.lastError
      : livePrices?.details?.source
        ? `Current price source: ${livePrices.details.source}.`
        : 'Current price freshness is healthy.',
  });

  const quoteFallbackSeverity = eodFallback
    ? (getBrokerMode() === 'live' ? 'critical' : 'warning')
    : polygonDelayed
      ? (getBrokerMode() === 'live' ? 'warning' : 'none')
      : 'none';
  signals.push({
    id: 'quote_fallback',
    severity: quoteFallbackSeverity,
    detail: livePrices?.details?.source
      ? `Execution is using ${livePrices.details.source} quotes.`
      : 'Primary execution quote source is healthy.',
  });

  const severity = signals.some(signal => signal.severity === 'critical')
    ? 'critical'
    : signals.some(signal => signal.severity === 'warning')
      ? 'warning'
      : 'none';

  const criticalIds = signals.filter(signal => signal.severity === 'critical').map(signal => signal.id);
  const liveCritical = criticalIds.includes('broker_connectivity') || criticalIds.includes('broker_submission') || criticalIds.includes('live_price_freshness');
  const paperBlocked = !marketData.executionEligible;

  const lastCriticalAt = severity === 'critical'
    ? now
    : current.lastCriticalAt;
  const stableAfter = severity === 'critical'
    ? now + STABILITY_WINDOW_MS
    : current.stableAfter;
  const canReleaseAutoLock = current.liveAutoLockEngaged && severity !== 'critical' && stableAfter !== null && now >= stableAfter;
  const liveAutoLockEngaged = liveCritical || (current.liveAutoLockEngaged && !canReleaseAutoLock);

  const next: DegradationStatus = {
    severity,
    signals,
    liveAutoLockEngaged,
    liveAutoLockReason: liveCritical
      ? signals.filter(signal => signal.severity === 'critical').map(signal => signal.detail).join(' ')
      : current.liveAutoLockEngaged && !canReleaseAutoLock
        ? 'Live auto-lock remains engaged until the post-failure stability window has passed.'
        : null,
    executionAllowedLive: !liveAutoLockEngaged,
    executionAllowedPaper: !paperBlocked,
    lastCriticalAt,
    lastHealthyAt: severity === 'none' ? now : current.lastHealthyAt,
    stableAfter: severity === 'critical' ? stableAfter : canReleaseAutoLock ? null : current.stableAfter,
    updatedAt: now,
  };

  db.prepare(`
    UPDATE system_degradation_state
    SET live_auto_lock_engaged = @live_auto_lock_engaged,
        live_auto_lock_reason = @live_auto_lock_reason,
        severity = @severity,
        execution_allowed_live = @execution_allowed_live,
        execution_allowed_paper = @execution_allowed_paper,
        last_critical_at = @last_critical_at,
        last_healthy_at = @last_healthy_at,
        stable_after = @stable_after,
        details = @details,
        updated_at = unixepoch()
    WHERE id = 1
  `).run({
    live_auto_lock_engaged: next.liveAutoLockEngaged ? 1 : 0,
    live_auto_lock_reason: next.liveAutoLockReason,
    severity: next.severity,
    execution_allowed_live: next.executionAllowedLive ? 1 : 0,
    execution_allowed_paper: next.executionAllowedPaper ? 1 : 0,
    last_critical_at: next.lastCriticalAt ? Math.floor(next.lastCriticalAt / 1000) : null,
    last_healthy_at: next.lastHealthyAt ? Math.floor(next.lastHealthyAt / 1000) : null,
    stable_after: next.stableAfter ? Math.floor(next.stableAfter / 1000) : null,
    details: JSON.stringify({ signals: next.signals }),
  });

  return next;
}

function safeJson(value: string | null | undefined): any {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
