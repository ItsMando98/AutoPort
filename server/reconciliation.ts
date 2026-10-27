import { randomUUID } from 'crypto';
import db from './db.js';
import { getOrderByClientOrderId, getOrders, isBrokerConnected, syncToLocalPortfolio, type BrokerOrder } from './broker.js';
import { getExecutionAttemptsByStatus, updateExecutionAttempt, type ExecutionAttemptStatus } from './execution.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';
import { updateSignalCandidateStatus } from './research.js';

export interface ReconciliationRunResult {
  scanned: number;
  updated: number;
  filled: number;
  rejected: number;
  cancelled: number;
}

export interface ReconciliationStatus {
  running: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastResult: ReconciliationRunResult | null;
}

const reconciliationStatus: ReconciliationStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
};

export function getReconciliationStatus(): ReconciliationStatus {
  return { ...reconciliationStatus };
}

export async function reconcileBrokerOrders(): Promise<{
  scanned: number;
  updated: number;
  filled: number;
  rejected: number;
  cancelled: number;
}> {
  reconciliationStatus.running = true;
  reconciliationStatus.lastRunAt = Date.now();

  try {
    if (!isBrokerConnected()) {
      const skippedResult = { scanned: 0, updated: 0, filled: 0, rejected: 0, cancelled: 0 };
      reconciliationStatus.lastSuccessAt = Date.now();
      reconciliationStatus.lastError = null;
      reconciliationStatus.lastResult = skippedResult;
      markDataSourceSuccess('broker_reconciliation', 0, { skipped: true, reason: 'broker_not_connected' });
      return skippedResult;
    }

    const attempts = getExecutionAttemptsByStatus(['submitted', 'submitted_unknown', 'awaiting_approval', 'partially_filled']);
    const brokerOrders = await getOrders('all', 100);
    const byOrderId = new Map(brokerOrders.map(order => [order.id, order]));

    let updated = 0;
    let filled = 0;
    let rejected = 0;
    let cancelled = 0;

    for (const attempt of attempts) {
      const order = attempt.brokerOrderId
        ? byOrderId.get(attempt.brokerOrderId)
        : attempt.status === 'submitted_unknown'
          ? await getOrderByClientOrderId(attempt.id).catch(() => null)
          : null;
      if (!order) continue;

      const result = applyBrokerOrderToAttempt(attempt.id, attempt.candidateId, order, attempt.plannedPrice);
      updated += result.updated ? 1 : 0;
      filled += result.filled ? 1 : 0;
      rejected += result.rejected ? 1 : 0;
      cancelled += result.cancelled ? 1 : 0;
    }

    if (filled > 0 || updated > 0) {
      await syncToLocalPortfolio().catch(() => {});
    }

    const summary = {
      scanned: attempts.length,
      updated,
      filled,
      rejected,
      cancelled,
    };

    reconciliationStatus.lastSuccessAt = Date.now();
    reconciliationStatus.lastError = null;
    reconciliationStatus.lastResult = summary;
    markDataSourceSuccess('broker_reconciliation', summary.updated, summary);
    return summary;
  } catch (err: any) {
    reconciliationStatus.lastError = err?.message ?? 'Broker reconciliation failed';
    markDataSourceFailure('broker_reconciliation', reconciliationStatus.lastError, {
      running: false,
      lastRunAt: reconciliationStatus.lastRunAt,
    });
    throw err;
  } finally {
    reconciliationStatus.running = false;
  }
}

function applyBrokerOrderToAttempt(
  attemptId: string,
  candidateId: string | null,
  order: BrokerOrder,
  plannedPrice: number | null,
): { updated: boolean; filled: boolean; rejected: boolean; cancelled: boolean } {
  const normalized = normalizeBrokerStatus(order.status);

  if (normalized === 'submitted') {
    updateExecutionAttempt(attemptId, {
      status: 'submitted',
      brokerOrderId: order.id,
      filledShares: order.filledQty > 0 ? order.filledQty : null,
      fillPrice: order.filledAvgPrice ?? null,
      error: null,
    });
    if (candidateId) updateSignalCandidateStatus(candidateId, 'in_flight');
    return { updated: true, filled: false, rejected: false, cancelled: false };
  }

  if (normalized === 'partially_filled') {
    updateExecutionAttempt(attemptId, {
      status: 'partially_filled',
      brokerOrderId: order.id,
      filledShares: order.filledQty > 0 ? order.filledQty : null,
      fillPrice: order.filledAvgPrice ?? plannedPrice ?? null,
      slippageBps: plannedPrice && order.filledAvgPrice
        ? Number((((order.filledAvgPrice - plannedPrice) / plannedPrice) * 10_000).toFixed(2))
        : null,
      error: null,
    });
    syncTradeAuditFromExecutionAttempt(attemptId, candidateId, order, 'partial');
    if (candidateId) updateSignalCandidateStatus(candidateId, 'in_flight');
    return { updated: true, filled: false, rejected: false, cancelled: false };
  }

  if (normalized === 'filled') {
    updateExecutionAttempt(attemptId, {
      status: 'filled',
      brokerOrderId: order.id,
      filledShares: order.filledQty,
      fillPrice: order.filledAvgPrice ?? plannedPrice ?? null,
      slippageBps: plannedPrice && order.filledAvgPrice
        ? Number((((order.filledAvgPrice - plannedPrice) / plannedPrice) * 10_000).toFixed(2))
        : null,
      error: null,
    });
    syncTradeAuditFromExecutionAttempt(attemptId, candidateId, order, 'executed');
    if (candidateId) updateSignalCandidateStatus(candidateId, 'executed');
    return { updated: true, filled: true, rejected: false, cancelled: false };
  }

  if (normalized === 'rejected') {
    updateExecutionAttempt(attemptId, {
      status: 'rejected',
      brokerOrderId: order.id,
      error: `Broker order ${order.status}`,
    });
    if (candidateId) updateSignalCandidateStatus(candidateId, 'blocked');
    return { updated: true, filled: false, rejected: true, cancelled: false };
  }

  updateExecutionAttempt(attemptId, {
    status: 'cancelled',
    brokerOrderId: order.id,
    error: `Broker order ${order.status}`,
  });
  if (candidateId) updateSignalCandidateStatus(candidateId, 'blocked');
  return { updated: true, filled: false, rejected: false, cancelled: true };
}

export function syncTradeAuditFromExecutionAttempt(
  attemptId: string,
  candidateId: string | null,
  order: BrokerOrder,
  tradeStatus: 'partial' | 'executed',
  override?: {
    shares?: number;
    price?: number;
  },
): void {
  const existing = db.prepare(`
    SELECT id FROM trades WHERE execution_attempt_id = ? LIMIT 1
  `).get(attemptId) as { id: string } | undefined;

  const attempt = db.prepare(`
    SELECT symbol, action, cycle_id, planned_price
    FROM execution_attempts
    WHERE id = ?
    LIMIT 1
  `).get(attemptId) as {
    symbol: string;
    action: 'BUY' | 'SELL';
    cycle_id: string | null;
    planned_price: number | null;
  } | undefined;
  if (!attempt) return;

  const candidate = candidateId
    ? db.prepare(`SELECT reasoning, source_event_ids FROM signal_candidates WHERE id = ? LIMIT 1`).get(candidateId) as {
        reasoning: string;
        source_event_ids: string | null;
      } | undefined
    : undefined;

  const shares = override?.shares ?? (order.filledQty > 0 ? order.filledQty : order.qty);
  const price = override?.price ?? order.filledAvgPrice ?? attempt.planned_price ?? 0;
  const totalValue = shares * price;

  if (existing) {
    db.prepare(`
      UPDATE trades
      SET shares = @shares,
          price = @price,
          total_value = @total_value,
          candidate_id = COALESCE(@candidate_id, candidate_id),
          cycle_id = COALESCE(@cycle_id, cycle_id),
          source_event_ids = COALESCE(@source_event_ids, source_event_ids),
          entry_thesis = COALESCE(@entry_thesis, entry_thesis),
          exit_reason = COALESCE(@exit_reason, exit_reason),
          status = @status
      WHERE id = @id
    `).run({
      id: existing.id,
      shares,
      price,
      total_value: totalValue,
      candidate_id: candidateId,
      cycle_id: attempt.cycle_id,
      source_event_ids: candidate?.source_event_ids ?? null,
      entry_thesis: attempt.action === 'BUY' ? candidate?.reasoning ?? 'Reconciled broker fill' : null,
      exit_reason: attempt.action === 'SELL' ? candidate?.reasoning ?? 'Reconciled broker fill' : null,
      status: tradeStatus,
    });
    return;
  }

  db.prepare(`
    INSERT INTO trades
      (id, symbol, action, shares, price, total_value, candidate_id, execution_attempt_id, cycle_id, source_event_ids, entry_thesis, exit_reason, risk_check_passed, portfolio_value_before, status)
    VALUES
      (@id, @symbol, @action, @shares, @price, @total_value, @candidate_id, @execution_attempt_id, @cycle_id, @source_event_ids, @entry_thesis, @exit_reason, 1, @portfolio_value_before, @status)
  `).run({
    id: randomUUID(),
    symbol: attempt.symbol,
    action: attempt.action,
    shares,
    price,
    total_value: totalValue,
    candidate_id: candidateId,
    execution_attempt_id: attemptId,
    cycle_id: attempt.cycle_id,
    source_event_ids: candidate?.source_event_ids ?? null,
    entry_thesis: attempt.action === 'BUY' ? candidate?.reasoning ?? 'Reconciled broker fill' : null,
    exit_reason: attempt.action === 'SELL' ? candidate?.reasoning ?? 'Reconciled broker fill' : null,
    portfolio_value_before: null,
    status: tradeStatus,
  });
}

export function normalizeBrokerStatus(status: string): Extract<ExecutionAttemptStatus, 'submitted' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled'> {
  const lower = status.toLowerCase();
  if (['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_replace', 'pending_cancel', 'pending_review', 'held', 'calculated'].includes(lower)) {
    return 'submitted';
  }
  if (lower === 'partially_filled') return 'partially_filled';
  if (lower === 'filled') return 'filled';
  if (['rejected', 'expired', 'suspended'].includes(lower)) return 'rejected';
  return 'cancelled';
}
