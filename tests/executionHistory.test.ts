import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import { createExecutionAttempt, getExecutionAttemptById, updateExecutionAttempt } from '../server/execution.js';
import { getExecutionHistory, getExecutionQualitySummary } from '../server/executionHistory.js';

const SYMBOL = 'TSTHIST';
const CANDIDATE_ID = 'cand-tsthist';

function cleanup() {
  db.prepare(`DELETE FROM trades WHERE symbol = ?`).run(SYMBOL);
  db.prepare(`DELETE FROM signal_candidates WHERE id = ?`).run(CANDIDATE_ID);
  db.prepare(`DELETE FROM execution_attempts WHERE symbol = ?`).run(SYMBOL);
}

test('execution history returns lineage fields and grouped quality summaries by terminal path', () => {
  cleanup();
  try {
    const nowSeconds = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO signal_candidates
        (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown, created_at, updated_at)
      VALUES
        (@id, @symbol, 'SELL', 31, 84, 'executed', @reasoning, '[]', '{}', @created_at, @updated_at)
    `).run({
      id: CANDIDATE_ID,
      symbol: SYMBOL,
      reasoning: 'Execution quality feedback still supports the sell thesis.',
      created_at: nowSeconds - 300,
      updated_at: nowSeconds - 60,
    });

    db.prepare(`
      INSERT INTO trades
        (id, symbol, action, shares, price, total_value, status, created_at)
      VALUES
        ('buy-tsthist', @symbol, 'BUY', 5, 90, 450, 'executed', @created_at)
    `).run({
      symbol: SYMBOL,
      created_at: nowSeconds - 600,
    });

    const attemptId = createExecutionAttempt({
      candidateId: CANDIDATE_ID,
      symbol: SYMBOL,
      action: 'SELL',
      mode: 'paper',
      status: 'planned',
      plannedShares: 5,
      plannedPrice: 100,
      initialTargetShares: 5,
      initialTargetValue: 500,
      finalTargetShares: 3,
      finalTargetValue: 300,
      sizingMultiplier: 0.6,
      sizingBand: 'reduced',
      sizingReason: 'Segment quality penalty.',
      strategyBand: 'reduced',
      timingBand: 'extended',
      retryReason: 'auto_resubmit:1:recovery',
    });

    updateExecutionAttempt(attemptId, {
      status: 'submitted',
      brokerOrderId: 'ord-hist-1',
    });
    updateExecutionAttempt(attemptId, {
      status: 'filled',
      plannedShares: 3,
      finalTargetShares: 3,
      finalTargetValue: 315,
      filledShares: 3,
      fillPrice: 105,
      brokerOrderId: 'ord-hist-2',
      slippageBps: 25,
      retryReason: 'auto_resubmit:1:recovery',
    });

    db.prepare(`
      INSERT INTO trades
        (id, symbol, action, shares, price, total_value, execution_attempt_id, candidate_id, status, created_at)
      VALUES
        ('sell-tsthist', @symbol, 'SELL', 3, 105, 315, @execution_attempt_id, @candidate_id, 'executed', @created_at)
    `).run({
      symbol: SYMBOL,
      execution_attempt_id: attemptId,
      candidate_id: CANDIDATE_ID,
      created_at: nowSeconds - 10,
    });

    const attempt = getExecutionAttemptById(attemptId);
    assert.equal(attempt?.terminalPath, 'reduced_resubmit_fill');
    assert.equal(attempt?.completionState, 'full');

    const history = getExecutionHistory({ symbol: SYMBOL, retryBand: 'reduced' });
    assert.equal(history.total, 1);
    assert.equal(history.items[0]?.candidateReasoning, 'Execution quality feedback still supports the sell thesis.');
    assert.equal(history.items[0]?.terminalPath, 'reduced_resubmit_fill');
    assert.equal(history.items[0]?.retryCount, 1);
    assert.equal(history.items[0]?.stateHistory.length, 3);
    assert.equal(history.items[0]?.realizedPnl, 45);

    const summary = getExecutionQualitySummary(50).find((row) => row.symbol === SYMBOL);
    assert.equal(summary?.terminalPath, 'reduced_resubmit_fill');
    assert.equal(summary?.attempts, 1);
    assert.equal(summary?.avgRetryCount, 1);
    assert.equal(summary?.avgCompletionRatio, 1);
  } finally {
    cleanup();
  }
});
