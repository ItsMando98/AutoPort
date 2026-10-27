import { getOrderByClientOrderId, isBrokerConnected, placeMarketOrder, syncToLocalPortfolio, type BrokerOrder } from './broker.js';
import { updateExecutionAttempt, type ExecutionAttemptStatus } from './execution.js';
import { executeTrade } from './portfolio.js';
import { normalizeBrokerStatus } from './reconciliation.js';
import { shouldUseBrokerExecution } from './runtime.js';

export interface ExecutionIntent {
  attemptId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  shares: number;
  referencePrice: number;
  reason: string;
  riskReducing: boolean;
}

export type GatewayStatus = Extract<ExecutionAttemptStatus,
  'submitted' | 'submitted_unknown' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled'>;

export interface ExecutionGatewayResult {
  ok: boolean;
  status: GatewayStatus;
  brokerOrder?: BrokerOrder;
  fillPrice: number | null;
  reason?: string;
}

export interface ExecutionGatewayDependencies {
  useBrokerExecution(): boolean;
  brokerConnected(): boolean;
  placeOrder(symbol: string, side: 'buy' | 'sell', qty: number, clientOrderId: string): Promise<BrokerOrder>;
  findOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null>;
  executeLocalTrade(action: 'BUY' | 'SELL', symbol: string, shares: number, price: number): boolean;
  syncBrokerPortfolio(): Promise<void>;
  updateAttempt(id: string, input: Parameters<typeof updateExecutionAttempt>[1]): void;
  normalizeStatus(status: string): Exclude<GatewayStatus, 'submitted_unknown'>;
}

// broker.ts throws `Alpaca ${res.status} ${path}: ${body}` for any non-ok
// HTTP response. A 4xx here is the broker synchronously refusing the order
// (validation, insufficient qty/buying power, asset restrictions) — that's a
// definite answer, not an ambiguous one. 5xx / non-HTTP errors (network
// failure before any response) stay ambiguous, since the order may or may not
// have been created broker-side.
function isDefiniteBrokerRejection(reason: string): boolean {
  const match = /^Alpaca (\d\d\d)\b/.exec(reason);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500;
}

export function createExecutionGateway(deps: ExecutionGatewayDependencies) {
  return async function execute(intent: ExecutionIntent): Promise<ExecutionGatewayResult> {
    if (!deps.useBrokerExecution() || !deps.brokerConnected()) {
      const filled = deps.executeLocalTrade(intent.action, intent.symbol, intent.shares, intent.referencePrice);
      const status: GatewayStatus = filled ? 'filled' : 'rejected';
      deps.updateAttempt(intent.attemptId, {
        status,
        filledShares: filled ? intent.shares : null,
        fillPrice: filled ? intent.referencePrice : null,
        slippageBps: filled ? 0 : null,
        error: filled ? null : 'Execution failed in local portfolio',
      });
      return { ok: filled, status, fillPrice: filled ? intent.referencePrice : null, reason: filled ? undefined : 'Execution failed' };
    }

    let brokerOrder: BrokerOrder | null = null;
    try {
      brokerOrder = await deps.placeOrder(
        intent.symbol,
        intent.action.toLowerCase() as 'buy' | 'sell',
        intent.shares,
        intent.attemptId,
      );
    } catch (error: any) {
      try {
        brokerOrder = await deps.findOrderByClientId(intent.attemptId);
      } catch {
        brokerOrder = null;
      }
      if (!brokerOrder) {
        const reason = error?.message ?? 'Ambiguous broker submission';
        // Alpaca's create-order call is synchronous: a 4xx response means the
        // request was parsed and definitively refused (bad qty, insufficient
        // buying power, asset not tradable, etc.) — no order was ever created,
        // so there's nothing ambiguous about it. Only a response-less failure
        // (network drop, timeout, 5xx before a body comes back) leaves genuine
        // doubt about whether an order exists broker-side. Misclassifying a
        // definitive rejection as "submitted_unknown" left attempts like this
        // stuck for days waiting on a stale-timeout/reconciliation dance that
        // could never resolve them, since no matching order would ever appear.
        if (isDefiniteBrokerRejection(reason)) {
          deps.updateAttempt(intent.attemptId, { status: 'rejected', error: reason });
          return { ok: false, status: 'rejected', fillPrice: null, reason };
        }
        deps.updateAttempt(intent.attemptId, { status: 'submitted_unknown', error: reason });
        return { ok: true, status: 'submitted_unknown', fillPrice: null, reason };
      }
    }

    const status = deps.normalizeStatus(brokerOrder.status);
    const fillPrice = brokerOrder.filledAvgPrice ?? null;
    const slippageBps = fillPrice && intent.referencePrice > 0
      ? Number((((fillPrice - intent.referencePrice) / intent.referencePrice) * 10_000).toFixed(2))
      : null;
    deps.updateAttempt(intent.attemptId, {
      status,
      filledShares: brokerOrder.filledQty > 0 ? brokerOrder.filledQty : null,
      fillPrice,
      brokerOrderId: brokerOrder.id,
      slippageBps,
      error: status === 'rejected' || status === 'cancelled' ? `Broker order ${brokerOrder.status}` : null,
    });
    if (status === 'filled' || status === 'partially_filled') {
      await deps.syncBrokerPortfolio().catch(() => {});
    }
    const ok = status === 'submitted' || status === 'partially_filled' || status === 'filled';
    return {
      ok,
      status,
      brokerOrder,
      fillPrice,
      reason: ok ? undefined : `Broker order ${brokerOrder.status}`,
    };
  };
}

export const executeOrderIntent = createExecutionGateway({
  useBrokerExecution: shouldUseBrokerExecution,
  brokerConnected: isBrokerConnected,
  placeOrder: placeMarketOrder,
  findOrderByClientId: getOrderByClientOrderId,
  executeLocalTrade: executeTrade,
  syncBrokerPortfolio: syncToLocalPortfolio,
  updateAttempt: (id, input) => updateExecutionAttempt(id, input),
  normalizeStatus: normalizeBrokerStatus,
});
