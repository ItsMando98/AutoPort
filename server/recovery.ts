import { cancelOrder, getOrderByClientOrderId, getOrders, isBrokerConnected, placeMarketOrder, syncToLocalPortfolio } from './broker.js';
import { getExecutionAttemptsByStatus, updateExecutionAttempt } from './execution.js';
import { buildAutoResubmitReason, getAutoResubmitCount } from './executionMeta.js';
import { refreshExecutionQualityProfiles } from './executionQualityProfiles.js';
import { evaluateAdaptiveResubmitPolicy, evaluateExecutionRecoveryTimingPolicy, evaluateExecutionResubmitStrategyPolicy } from './executionPolicy.js';
import { fetchCurrentPrices } from './marketdata.js';
import { getMarketSessionStatus } from './marketclock.js';
import { markDataSourceFailure, markDataSourceSuccess } from './ops.js';
import { getState, getTotalValue } from './portfolio.js';
import { checkTradeAllowed } from './risk.js';
import { updateSignalCandidateStatus } from './research.js';
import { normalizeBrokerStatus, syncTradeAuditFromExecutionAttempt } from './reconciliation.js';
import { getTradingMode, shouldUseBrokerExecution, canExecuteTrades } from './runtime.js';
import { evaluateLiveExecutionPolicy } from './rollout.js';

const SUBMITTED_TIMEOUT_MS = 2 * 60 * 1000;
const PARTIAL_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_RESUBMIT_COOLDOWN_MS = 30 * 1000;

export interface RecoveryRunResult {
  scanned: number;
  staleSubmitted: number;
  stalePartial: number;
  cancelled: number;
  brokerMissing: number;
  recoveredPartial: number;
  resubmitted: number;
  errored: number;
}

export interface RecoveryStatus {
  running: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastResult: RecoveryRunResult | null;
}

const recoveryStatus: RecoveryStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
};

export function getRecoveryStatus(): RecoveryStatus {
  return { ...recoveryStatus };
}

export async function recoverExecutionAttempts(now = Date.now()): Promise<RecoveryRunResult> {
  recoveryStatus.running = true;
  recoveryStatus.lastRunAt = now;

  try {
    if (!isBrokerConnected()) {
      const skipped = {
        scanned: 0,
        staleSubmitted: 0,
        stalePartial: 0,
        cancelled: 0,
        brokerMissing: 0,
        recoveredPartial: 0,
        resubmitted: 0,
        errored: 0,
      };
      recoveryStatus.lastSuccessAt = now;
      recoveryStatus.lastError = null;
      recoveryStatus.lastResult = skipped;
      markDataSourceSuccess('execution_recovery', 0, { skipped: true, reason: 'broker_not_connected' });
      return skipped;
    }

    const attempts = getExecutionAttemptsByStatus(['submitted', 'submitted_unknown', 'partially_filled']);
    refreshExecutionQualityProfiles();
    const brokerOrders = await getOrders('all', 100);
    const byOrderId = new Map(brokerOrders.map(order => [order.id, order]));

    let staleSubmitted = 0;
    let stalePartial = 0;
    let cancelled = 0;
    let brokerMissing = 0;
    let recoveredPartial = 0;
    let resubmitted = 0;
    let errored = 0;

    for (const attempt of attempts) {
      // Each attempt is recovered independently — one attempt throwing (a
      // flaky price fetch, a broker hiccup) must not stop recovery from
      // reaching every other stale order in this batch. Previously a single
      // bad attempt aborted the whole function, silently re-failing on the
      // same attempt every cycle and leaving unrelated stuck orders
      // unrecovered for as long as that one attempt kept erroring.
      try {
        const timing = evaluateExecutionRecoveryTimingPolicy({
          symbol: attempt.symbol,
          action: attempt.action,
          mode: attempt.mode,
          rolloutProfile: attempt.rolloutProfile ?? null,
          sessionRegime: attempt.sessionRegime ?? null,
          refreshProfiles: false,
        });
        const threshold = attempt.status === 'partially_filled'
          ? Math.max(timing.partialTimeoutMs, timing.resubmitCooldownMs)
          : Math.max(timing.submittedTimeoutMs, timing.resubmitCooldownMs);
        const ageMs = now - attempt.updatedAt;
        if (ageMs < threshold) continue;

        if (attempt.status === 'partially_filled') stalePartial += 1;
        else staleSubmitted += 1;

        let order = attempt.brokerOrderId ? byOrderId.get(attempt.brokerOrderId) : null;
        if (!order && attempt.status === 'submitted_unknown') {
          order = await getOrderByClientOrderId(attempt.id).catch(() => null);
        }
        if (!order) {
          brokerMissing += 1;
          const missingOrderResult = await attemptAutoResubmit(attempt, null, now);
          if (missingOrderResult.resubmitted) {
            resubmitted += 1;
          } else {
            updateExecutionAttempt(attempt.id, {
              status: 'cancelled',
              retryReason: missingOrderResult.retryReason ?? 'auto_recovery_missing_order',
              error: missingOrderResult.reason ?? 'Autonomous recovery cancelled stale attempt with no broker order found.',
            });
            finalizeCandidate(
              attempt.candidateId,
              attempt.status === 'partially_filled' ? 'partially_filled' : 'submitted',
              attempt.filledShares ?? 0,
            );
            cancelled += 1;
          }
          continue;
        }

        const normalized = normalizeBrokerStatus(order.status);
        if (normalized === 'filled') {
          updateExecutionAttempt(attempt.id, {
            status: 'filled',
            brokerOrderId: order.id,
            filledShares: order.filledQty,
            fillPrice: order.filledAvgPrice ?? attempt.plannedPrice ?? null,
            error: null,
          });
          syncTradeAuditFromExecutionAttempt(attempt.id, attempt.candidateId, order, 'executed');
          if (attempt.candidateId) updateSignalCandidateStatus(attempt.candidateId, 'executed');
          recoveredPartial += 1;
          continue;
        }

        if (normalized === 'partially_filled') {
          await cancelOrder(order.id).catch(() => {});
          const partialResult = await attemptAutoResubmit(attempt, order, now);
          if (partialResult.resubmitted) {
            resubmitted += 1;
          } else {
            updateExecutionAttempt(attempt.id, {
              status: 'cancelled',
              brokerOrderId: order.id,
              filledShares: order.filledQty > 0 ? order.filledQty : attempt.filledShares,
              fillPrice: order.filledAvgPrice ?? attempt.fillPrice ?? attempt.plannedPrice ?? null,
              retryReason: partialResult.retryReason ?? 'auto_recovery_partial_cancelled',
              error: partialResult.reason ?? `Autonomous recovery cancelled stale partially filled order after ${Math.round(ageMs / 1000)}s.`,
            });
            if (order.filledQty > 0) {
              syncTradeAuditFromExecutionAttempt(attempt.id, attempt.candidateId, order, 'partial', {
                shares: order.filledQty > 0 ? order.filledQty : attempt.filledShares ?? 0,
                price: order.filledAvgPrice ?? attempt.fillPrice ?? attempt.plannedPrice ?? 0,
              });
              recoveredPartial += 1;
            }
            finalizeCandidate(attempt.candidateId, 'partially_filled', order.filledQty);
            cancelled += 1;
          }
          continue;
        }

        if (normalized === 'submitted') {
          await cancelOrder(order.id).catch(() => {});
          const submitResult = await attemptAutoResubmit(attempt, order, now);
          if (submitResult.resubmitted) {
            resubmitted += 1;
          } else {
            updateExecutionAttempt(attempt.id, {
              status: 'cancelled',
              brokerOrderId: order.id,
              retryReason: submitResult.retryReason ?? 'auto_recovery_timeout',
              error: submitResult.reason ?? `Autonomous recovery cancelled stale submitted order after ${Math.round(ageMs / 1000)}s.`,
            });
            finalizeCandidate(attempt.candidateId, 'submitted', 0);
            cancelled += 1;
          }
          continue;
        }

        updateExecutionAttempt(attempt.id, {
          status: normalized,
          brokerOrderId: order.id,
          error: `Autonomous recovery observed broker terminal state: ${order.status}`,
        });
        finalizeCandidate(attempt.candidateId, normalized, order.filledQty);
        cancelled += normalized === 'cancelled' ? 1 : 0;
      } catch (attemptErr: any) {
        errored += 1;
        console.error(`[Recovery] Attempt ${attempt.id} (${attempt.symbol}) failed to recover:`, attemptErr?.message ?? attemptErr);
      }
    }

    if (cancelled > 0 || recoveredPartial > 0) {
      await syncToLocalPortfolio().catch(() => {});
    }

    const result = {
      scanned: attempts.length,
      staleSubmitted,
      stalePartial,
      cancelled,
      brokerMissing,
      recoveredPartial,
      resubmitted,
      errored,
    };

    recoveryStatus.lastSuccessAt = Date.now();
    recoveryStatus.lastError = null;
    recoveryStatus.lastResult = result;
    markDataSourceSuccess('execution_recovery', result.resubmitted + result.cancelled + result.recoveredPartial, result);
    return result;
  } catch (err: any) {
    recoveryStatus.lastError = err?.message ?? 'Execution recovery failed';
    markDataSourceFailure('execution_recovery', recoveryStatus.lastError, {
      running: false,
      lastRunAt: recoveryStatus.lastRunAt,
    });
    throw err;
  } finally {
    recoveryStatus.running = false;
  }
}

export function getExecutionRecoveryThresholdMs(status: 'submitted' | 'submitted_unknown' | 'partially_filled'): number {
  return status === 'partially_filled' ? PARTIAL_TIMEOUT_MS : SUBMITTED_TIMEOUT_MS;
}

export function getMinimumResubmitCooldownMs(): number {
  return MIN_RESUBMIT_COOLDOWN_MS;
}

function finalizeCandidate(
  candidateId: string | null,
  status: 'submitted' | 'submitted_unknown' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled',
  filledQty: number,
): void {
  if (!candidateId) return;
  if (status === 'filled' || (status === 'partially_filled' && filledQty > 0) || (status === 'cancelled' && filledQty > 0)) {
    updateSignalCandidateStatus(candidateId, 'executed');
    return;
  }
  updateSignalCandidateStatus(candidateId, 'blocked');
}

async function attemptAutoResubmit(
  attempt: Awaited<ReturnType<typeof getExecutionAttemptsByStatus>>[number],
  latestOrder: { id: string; qty: number; filledQty: number; filledAvgPrice: number | null } | null,
  now: number,
): Promise<{ resubmitted: boolean; reason?: string; retryReason?: string }> {
  const resubmitCount = getAutoResubmitCount(attempt.retryReason);
  const adaptivePolicy = evaluateAdaptiveResubmitPolicy({
    symbol: attempt.symbol,
    action: attempt.action,
    mode: attempt.mode,
    currentRetryCount: resubmitCount,
    rolloutProfile: attempt.rolloutProfile ?? null,
    sessionRegime: attempt.sessionRegime ?? null,
    refreshProfiles: false,
  });
  const resubmitStrategy = evaluateExecutionResubmitStrategyPolicy({
    symbol: attempt.symbol,
    action: attempt.action,
    mode: attempt.mode,
    rolloutProfile: attempt.rolloutProfile ?? null,
    sessionRegime: attempt.sessionRegime ?? null,
    refreshProfiles: false,
  });
  const timingPolicy = evaluateExecutionRecoveryTimingPolicy({
    symbol: attempt.symbol,
    action: attempt.action,
    mode: attempt.mode,
    rolloutProfile: attempt.rolloutProfile ?? null,
    sessionRegime: attempt.sessionRegime ?? null,
    refreshProfiles: false,
  });

  updateExecutionAttempt(attempt.id, {
    strategyBand: resubmitStrategy.band,
    timingBand: timingPolicy.band,
  });

  if (!adaptivePolicy.allowResubmit) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: adaptivePolicy.reason,
    };
  }

  if (!canExecuteTrades() || !shouldUseBrokerExecution()) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: 'Autonomous resubmit blocked by runtime execution gates.',
    };
  }

  const market = getMarketSessionStatus();
  if (!market.isOpen) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: `Autonomous resubmit blocked outside market hours. ${market.note}`,
    };
  }

  const alreadyFilled = latestOrder?.filledQty ?? attempt.filledShares ?? 0;
  const totalPlanned = attempt.plannedShares ?? 0;
  const remainingShares = Math.max(0, totalPlanned - alreadyFilled);
  if (remainingShares <= 0) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: 'No remaining quantity to resubmit.',
    };
  }

  if (alreadyFilled > 0 && !resubmitStrategy.allowPartialResubmit) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: `Autonomous resubmit stopped after partial fill. ${resubmitStrategy.reason}`,
    };
  }

  const resubmitShares = Math.max(0, Math.floor(remainingShares * resubmitStrategy.sizeMultiplier));
  const adjustedShares = resubmitShares > 0 ? resubmitShares : remainingShares;
  if (adjustedShares <= 0) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: `Autonomous resubmit decayed size below tradable quantity. ${resubmitStrategy.reason}`,
    };
  }
  const effectiveTargetShares = alreadyFilled + adjustedShares;

  const symbols = [...new Set([...getState().positions.map(position => position.symbol), attempt.symbol])];
  const prices = await fetchCurrentPrices(symbols);
  const currentPrice = prices[attempt.symbol] ?? latestOrder?.filledAvgPrice ?? attempt.fillPrice ?? attempt.plannedPrice;
  if (!currentPrice || currentPrice <= 0) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: 'No valid current price available for autonomous resubmit.',
    };
  }

  const portfolio = getState();
  const totalValue = getTotalValue(prices);
  const risk = checkTradeAllowed(attempt.symbol, attempt.action, adjustedShares, currentPrice, {
    cash: portfolio.cash,
    positions: portfolio.positions,
    totalValue,
  });
  if (!risk.allowed) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: `Autonomous resubmit blocked by risk engine: ${risk.reason}`,
    };
  }

  if (getTradingMode() === 'live') {
    const policy = evaluateLiveExecutionPolicy({ shares: adjustedShares, price: currentPrice });
    if (!policy.allowed) {
      return {
        resubmitted: false,
        retryReason: buildAutoResubmitReason(attempt.retryReason),
        reason: `Autonomous resubmit blocked by live rollout policy: ${policy.reason}`,
      };
    }
  }

  try {
    const retryOrdinal = getAutoResubmitCount(attempt.retryReason) + 1;
    const clientOrderId = `${attempt.id}-retry-${retryOrdinal}`;
    const existingRetryOrder = await getOrderByClientOrderId(clientOrderId);
    const newOrder = existingRetryOrder ?? await placeMarketOrder(
      attempt.symbol,
      attempt.action.toLowerCase() as 'buy' | 'sell',
      adjustedShares,
      clientOrderId,
    );
    const normalized = normalizeBrokerStatus(newOrder.status);
    const latestFilled = newOrder.filledQty > 0 ? newOrder.filledQty : 0;
    const cumulativeFilled = alreadyFilled + latestFilled;
    const weightedFillPrice = getWeightedFillPrice(
      alreadyFilled,
      latestOrder?.filledAvgPrice ?? attempt.fillPrice ?? attempt.plannedPrice ?? null,
      latestFilled,
      newOrder.filledAvgPrice ?? currentPrice,
    );

    let nextStatus = normalized;
    if (normalized === 'filled' && cumulativeFilled < effectiveTargetShares) {
      nextStatus = 'partially_filled';
    } else if ((normalized === 'submitted' || normalized === 'partially_filled') && cumulativeFilled >= effectiveTargetShares) {
      nextStatus = 'filled';
    }

    updateExecutionAttempt(attempt.id, {
      status: nextStatus,
      plannedShares: effectiveTargetShares,
      finalTargetShares: effectiveTargetShares,
      finalTargetValue: Number((effectiveTargetShares * currentPrice).toFixed(2)),
      plannedPrice: currentPrice,
      filledShares: cumulativeFilled > 0 ? cumulativeFilled : null,
      fillPrice: weightedFillPrice,
      brokerOrderId: newOrder.id,
      slippageBps: currentPrice > 0 && newOrder.filledAvgPrice
        ? Number((((newOrder.filledAvgPrice - currentPrice) / currentPrice) * 10_000).toFixed(2))
        : attempt.slippageBps,
      strategyBand: resubmitStrategy.band,
      timingBand: timingPolicy.band,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      error: null,
    });

    if (latestFilled > 0 && weightedFillPrice) {
      syncTradeAuditFromExecutionAttempt(
        attempt.id,
        attempt.candidateId,
        newOrder,
        nextStatus === 'filled' ? 'executed' : 'partial',
        { shares: cumulativeFilled, price: weightedFillPrice },
      );
    }

    if (attempt.candidateId) {
      if (nextStatus === 'filled') updateSignalCandidateStatus(attempt.candidateId, 'executed');
      else updateSignalCandidateStatus(attempt.candidateId, 'in_flight');
    }

    await syncToLocalPortfolio().catch(() => {});
    return { resubmitted: true, retryReason: buildAutoResubmitReason(attempt.retryReason) };
  } catch (err: any) {
    return {
      resubmitted: false,
      retryReason: buildAutoResubmitReason(attempt.retryReason),
      reason: `Autonomous resubmit failed: ${err?.message ?? 'broker error'}`,
    };
  }
}

function getWeightedFillPrice(
  previousShares: number,
  previousPrice: number | null,
  newShares: number,
  newPrice: number | null,
): number | null {
  if (previousShares <= 0 && (!newPrice || newShares <= 0)) return previousPrice ?? newPrice ?? null;
  if (previousShares <= 0 || previousPrice == null) return newPrice ?? null;
  if (newShares <= 0 || newPrice == null) return previousPrice;
  return Number((((previousShares * previousPrice) + (newShares * newPrice)) / (previousShares + newShares)).toFixed(4));
}
