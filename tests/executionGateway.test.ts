import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionGateway, type ExecutionGatewayDependencies } from '../server/executionGateway.js';
import type { BrokerOrder } from '../server/broker.js';

const intent = {
  attemptId: 'attempt-1', symbol: 'AAPL', action: 'SELL' as const, shares: 4,
  referencePrice: 200, reason: 'stop_loss', riskReducing: true,
};

function order(status = 'accepted'): BrokerOrder {
  return {
    id: 'broker-1', clientOrderId: 'attempt-1', symbol: 'AAPL', side: 'sell', qty: 4,
    filledQty: status === 'filled' ? 4 : 0, filledAvgPrice: status === 'filled' ? 199 : null,
    status, orderType: 'market', timeInForce: 'day', createdAt: '2026-07-19T12:00:00Z',
    filledAt: status === 'filled' ? '2026-07-19T12:00:01Z' : null,
  };
}

function dependencies(overrides: Partial<ExecutionGatewayDependencies> = {}): ExecutionGatewayDependencies {
  return {
    useBrokerExecution: () => false,
    brokerConnected: () => false,
    placeOrder: async () => order(),
    findOrderByClientId: async () => null,
    executeLocalTrade: () => true,
    syncBrokerPortfolio: async () => {},
    updateAttempt: () => {},
    normalizeStatus: status => status === 'filled' ? 'filled' : 'submitted',
    ...overrides,
  };
}

test('simulation fills through the local portfolio', async () => {
  let localMutations = 0;
  const gateway = createExecutionGateway(dependencies({ executeLocalTrade: () => { localMutations += 1; return true; } }));
  const result = await gateway(intent);
  assert.equal(result.status, 'filled');
  assert.equal(localMutations, 1);
});

test('broker submission never mutates the local portfolio before a fill', async () => {
  let localMutations = 0;
  const gateway = createExecutionGateway(dependencies({
    useBrokerExecution: () => true,
    brokerConnected: () => true,
    placeOrder: async () => order('accepted'),
    executeLocalTrade: () => { localMutations += 1; return true; },
  }));
  const result = await gateway(intent);
  assert.equal(result.status, 'submitted');
  assert.equal(localMutations, 0);
});

test('ambiguous broker failures reconcile by client id before returning', async () => {
  const gateway = createExecutionGateway(dependencies({
    useBrokerExecution: () => true,
    brokerConnected: () => true,
    placeOrder: async () => { throw new Error('socket closed'); },
    findOrderByClientId: async () => order('filled'),
    normalizeStatus: status => status === 'filled' ? 'filled' : 'submitted',
  }));
  const result = await gateway(intent);
  assert.equal(result.status, 'filled');
  assert.equal(result.ok, true);
});

test('unknown ambiguous broker failures remain non-terminal', async () => {
  const gateway = createExecutionGateway(dependencies({
    useBrokerExecution: () => true,
    brokerConnected: () => true,
    placeOrder: async () => { throw new Error('timeout'); },
    findOrderByClientId: async () => null,
  }));
  const result = await gateway(intent);
  assert.equal(result.status, 'submitted_unknown');
  assert.equal(result.ok, true);
});
