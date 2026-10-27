import { randomUUID } from 'crypto';
import db from './db.js';
import { deriveExecutionRolloutProfile, getExecutionSessionRegime } from './executionContext.js';
import type { ExecutionSessionRegime } from './executionContext.js';
import { getAutoResubmitCount } from './executionMeta.js';
import type { LiveRolloutProfile } from './rollout.js';

export type ExecutionAttemptStatus =
  | 'planned'
  | 'awaiting_approval'
  | 'submitted'
  | 'submitted_unknown'
  | 'partially_filled'
  | 'filled'
  | 'rejected'
  | 'cancelled';

export interface ExecutionAttemptRecord {
  id: string;
  cycleId: string | null;
  candidateId: string | null;
  decisionBatchId?: string | null;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  status: ExecutionAttemptStatus;
  plannedShares: number | null;
  plannedPrice: number | null;
  initialTargetShares?: number | null;
  initialTargetValue?: number | null;
  finalTargetShares?: number | null;
  finalTargetValue?: number | null;
  baseTargetWeight?: number | null;
  adjustedTargetWeight?: number | null;
  constructionBand?: string | null;
  constructionReason?: string | null;
  filledShares: number | null;
  fillPrice: number | null;
  brokerOrderId: string | null;
  brokerOrderIds?: string[];
  slippageBps: number | null;
  rolloutProfile?: LiveRolloutProfile | null;
  sessionRegime?: ExecutionSessionRegime | null;
  sizingMultiplier?: number | null;
  sizingBand?: string | null;
  sizingReason?: string | null;
  strategyBand?: string | null;
  timingBand?: string | null;
  retryCount?: number;
  terminalPath?: string | null;
  completionRatio?: number | null;
  completionState?: 'none' | 'partial' | 'full' | null;
  stateHistory?: Array<Record<string, any>>;
  submittedAt?: number | null;
  firstFillAt?: number | null;
  lastFillAt?: number | null;
  cancelledAt?: number | null;
  rejectedAt?: number | null;
  completedAt?: number | null;
  degradedExecution?: boolean;
  degradationReasons?: string[];
  retryReason: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export function createExecutionAttempt(input: {
  cycleId?: string | null;
  candidateId?: string | null;
  decisionBatchId?: string | null;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  status?: ExecutionAttemptStatus;
  plannedShares?: number | null;
  plannedPrice?: number | null;
  initialTargetShares?: number | null;
  initialTargetValue?: number | null;
  finalTargetShares?: number | null;
  finalTargetValue?: number | null;
  baseTargetWeight?: number | null;
  adjustedTargetWeight?: number | null;
  constructionBand?: string | null;
  constructionReason?: string | null;
  rolloutProfile?: LiveRolloutProfile | null;
  sessionRegime?: ExecutionSessionRegime | null;
  sizingMultiplier?: number | null;
  sizingBand?: string | null;
  sizingReason?: string | null;
  strategyBand?: string | null;
  timingBand?: string | null;
  degradedExecution?: boolean;
  degradationReasons?: string[];
  retryReason?: string | null;
  error?: string | null;
}): string {
  const id = randomUUID();
  const rolloutProfile = input.rolloutProfile ?? deriveExecutionRolloutProfile(input.mode);
  const sessionRegime = input.sessionRegime ?? getExecutionSessionRegime();
  const plannedShares = input.plannedShares ?? null;
  const plannedPrice = input.plannedPrice ?? null;
  const initialTargetShares = input.initialTargetShares ?? plannedShares;
  const initialTargetValue = input.initialTargetValue ?? (initialTargetShares !== null && plannedPrice !== null ? Number((initialTargetShares * plannedPrice).toFixed(2)) : null);
  const finalTargetShares = input.finalTargetShares ?? plannedShares;
  const finalTargetValue = input.finalTargetValue ?? (finalTargetShares !== null && plannedPrice !== null ? Number((finalTargetShares * plannedPrice).toFixed(2)) : null);
  const retryReason = input.retryReason ?? null;
  db.prepare(`
    INSERT INTO execution_attempts
      (id, cycle_id, candidate_id, symbol, action, mode, status, planned_shares, planned_price, initial_target_shares, initial_target_value, final_target_shares, final_target_value,
       base_target_weight, adjusted_target_weight, construction_band, construction_reason, rollout_profile, session_regime, sizing_multiplier, sizing_band, sizing_reason, strategy_band, timing_band, retry_count, broker_order_ids, state_history,
       decision_batch_id,
       degraded_execution, degradation_reasons, retry_reason, error)
    VALUES
      (@id, @cycle_id, @candidate_id, @symbol, @action, @mode, @status, @planned_shares, @planned_price, @initial_target_shares, @initial_target_value, @final_target_shares, @final_target_value,
       @base_target_weight, @adjusted_target_weight, @construction_band, @construction_reason, @rollout_profile, @session_regime, @sizing_multiplier, @sizing_band, @sizing_reason, @strategy_band, @timing_band, @retry_count, @broker_order_ids, @state_history,
       @decision_batch_id,
       @degraded_execution, @degradation_reasons, @retry_reason, @error)
  `).run({
    id,
    cycle_id: input.cycleId ?? null,
    candidate_id: input.candidateId ?? null,
    symbol: input.symbol,
    action: input.action,
    mode: input.mode,
    status: input.status ?? 'planned',
    planned_shares: plannedShares,
    planned_price: plannedPrice,
    initial_target_shares: initialTargetShares,
    initial_target_value: initialTargetValue,
    final_target_shares: finalTargetShares,
    final_target_value: finalTargetValue,
    base_target_weight: input.baseTargetWeight ?? null,
    adjusted_target_weight: input.adjustedTargetWeight ?? null,
    construction_band: input.constructionBand ?? null,
    construction_reason: input.constructionReason ?? null,
    rollout_profile: rolloutProfile,
    session_regime: sessionRegime,
    sizing_multiplier: input.sizingMultiplier ?? 1,
    sizing_band: input.sizingBand ?? null,
    sizing_reason: input.sizingReason ?? null,
    strategy_band: input.strategyBand ?? null,
    timing_band: input.timingBand ?? null,
    retry_count: getAutoResubmitCount(retryReason),
    broker_order_ids: JSON.stringify([]),
    state_history: JSON.stringify([{
      at: Math.floor(Date.now() / 1000),
      status: input.status ?? 'planned',
      detail: 'Execution attempt created.',
    }]),
    decision_batch_id: input.decisionBatchId ?? null,
    degraded_execution: input.degradedExecution ? 1 : 0,
    degradation_reasons: JSON.stringify(input.degradationReasons ?? []),
    retry_reason: retryReason,
    error: input.error ?? null,
  });
  return id;
}

export function updateExecutionAttempt(
  id: string,
  input: Partial<{
    status: ExecutionAttemptStatus;
    plannedShares: number | null;
    plannedPrice: number | null;
    initialTargetShares: number | null;
    initialTargetValue: number | null;
    finalTargetShares: number | null;
    finalTargetValue: number | null;
    baseTargetWeight: number | null;
    adjustedTargetWeight: number | null;
    constructionBand: string | null;
    constructionReason: string | null;
    filledShares: number | null;
    fillPrice: number | null;
    brokerOrderId: string | null;
    slippageBps: number | null;
    rolloutProfile: LiveRolloutProfile | null;
    sessionRegime: ExecutionSessionRegime | null;
    sizingMultiplier: number | null;
    sizingBand: string | null;
    sizingReason: string | null;
    strategyBand: string | null;
    timingBand: string | null;
    terminalPath: string | null;
    completionRatio: number | null;
    completionState: 'none' | 'partial' | 'full' | null;
    degradedExecution: boolean;
    degradationReasons: string[];
    retryReason: string | null;
    error: string | null;
  }>
): void {
  const existing = db.prepare(`SELECT * FROM execution_attempts WHERE id = ? LIMIT 1`).get(id) as any;
  if (!existing) return;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const nextStatus = input.status ?? existing.status;
  const nextPlannedShares = input.plannedShares ?? existing.planned_shares ?? null;
  const nextPlannedPrice = input.plannedPrice ?? existing.planned_price ?? null;
  const nextInitialTargetShares = input.initialTargetShares ?? existing.initial_target_shares ?? nextPlannedShares;
  const nextInitialTargetValue = input.initialTargetValue ?? existing.initial_target_value ?? (nextInitialTargetShares !== null && nextPlannedPrice !== null ? Number((nextInitialTargetShares * nextPlannedPrice).toFixed(2)) : null);
  const nextFinalTargetShares = input.finalTargetShares ?? existing.final_target_shares ?? nextPlannedShares;
  const nextFinalTargetValue = input.finalTargetValue ?? existing.final_target_value ?? (nextFinalTargetShares !== null && nextPlannedPrice !== null ? Number((nextFinalTargetShares * nextPlannedPrice).toFixed(2)) : null);
  const nextBaseTargetWeight = input.baseTargetWeight ?? existing.base_target_weight ?? null;
  const nextAdjustedTargetWeight = input.adjustedTargetWeight ?? existing.adjusted_target_weight ?? nextBaseTargetWeight ?? null;
  const nextFilledShares = input.filledShares ?? existing.filled_shares ?? null;
  const nextFillPrice = input.fillPrice ?? existing.fill_price ?? null;
  const nextBrokerOrderId = input.brokerOrderId ?? existing.broker_order_id ?? null;
  const nextRetryReason = input.retryReason ?? existing.retry_reason ?? null;
  const nextRetryCount = getAutoResubmitCount(nextRetryReason);
  const nextStrategyBand = input.strategyBand ?? existing.strategy_band ?? null;
  const nextTimingBand = input.timingBand ?? existing.timing_band ?? null;
  const nextTerminalPath = input.terminalPath ?? classifyTerminalPath(nextStatus, nextRetryCount, nextFilledShares, nextInitialTargetShares, nextFinalTargetShares, nextStrategyBand);
  const nextCompletionRatio = input.completionRatio ?? computeCompletionRatio(nextFilledShares, nextFinalTargetShares);
  const nextCompletionState = input.completionState ?? classifyCompletionState(nextCompletionRatio);
  const nextDegradationReasons = input.degradationReasons ?? safeJson<string[]>(existing.degradation_reasons, []);
  const brokerOrderIds = appendUniqueString(safeJson<string[]>(existing.broker_order_ids, []), nextBrokerOrderId);
  const stateHistory = appendLifecycleHistory(safeJson<any[]>(existing.state_history, []), existing, {
    at: nowSeconds,
    status: nextStatus,
    brokerOrderId: nextBrokerOrderId,
    filledShares: nextFilledShares,
    error: input.error ?? existing.error ?? null,
  });

  db.prepare(`
    UPDATE execution_attempts
    SET status = COALESCE(@status, status),
        planned_shares = COALESCE(@planned_shares, planned_shares),
        planned_price = COALESCE(@planned_price, planned_price),
        initial_target_shares = COALESCE(@initial_target_shares, initial_target_shares),
        initial_target_value = COALESCE(@initial_target_value, initial_target_value),
        final_target_shares = COALESCE(@final_target_shares, final_target_shares),
        final_target_value = COALESCE(@final_target_value, final_target_value),
        base_target_weight = COALESCE(@base_target_weight, base_target_weight),
        adjusted_target_weight = COALESCE(@adjusted_target_weight, adjusted_target_weight),
        construction_band = COALESCE(@construction_band, construction_band),
        construction_reason = COALESCE(@construction_reason, construction_reason),
        filled_shares = COALESCE(@filled_shares, filled_shares),
        fill_price = COALESCE(@fill_price, fill_price),
        broker_order_id = COALESCE(@broker_order_id, broker_order_id),
        slippage_bps = COALESCE(@slippage_bps, slippage_bps),
        rollout_profile = COALESCE(@rollout_profile, rollout_profile),
        session_regime = COALESCE(@session_regime, session_regime),
        sizing_multiplier = COALESCE(@sizing_multiplier, sizing_multiplier),
        sizing_band = COALESCE(@sizing_band, sizing_band),
        sizing_reason = COALESCE(@sizing_reason, sizing_reason),
        strategy_band = COALESCE(@strategy_band, strategy_band),
        timing_band = COALESCE(@timing_band, timing_band),
        retry_count = COALESCE(@retry_count, retry_count),
        terminal_path = COALESCE(@terminal_path, terminal_path),
        completion_ratio = COALESCE(@completion_ratio, completion_ratio),
        completion_state = COALESCE(@completion_state, completion_state),
        broker_order_ids = COALESCE(@broker_order_ids, broker_order_ids),
        state_history = COALESCE(@state_history, state_history),
        submitted_at = COALESCE(@submitted_at, submitted_at),
        first_fill_at = COALESCE(@first_fill_at, first_fill_at),
        last_fill_at = COALESCE(@last_fill_at, last_fill_at),
        cancelled_at = COALESCE(@cancelled_at, cancelled_at),
        rejected_at = COALESCE(@rejected_at, rejected_at),
        completed_at = COALESCE(@completed_at, completed_at),
        degraded_execution = COALESCE(@degraded_execution, degraded_execution),
        degradation_reasons = COALESCE(@degradation_reasons, degradation_reasons),
        retry_reason = COALESCE(@retry_reason, retry_reason),
        error = COALESCE(@error, error),
        updated_at = unixepoch()
    WHERE id = @id
  `).run({
    id,
    status: nextStatus,
    planned_shares: nextPlannedShares,
    planned_price: nextPlannedPrice,
    initial_target_shares: nextInitialTargetShares,
    initial_target_value: nextInitialTargetValue,
    final_target_shares: nextFinalTargetShares,
    final_target_value: nextFinalTargetValue,
    base_target_weight: nextBaseTargetWeight,
    adjusted_target_weight: nextAdjustedTargetWeight,
    construction_band: input.constructionBand ?? existing.construction_band ?? null,
    construction_reason: input.constructionReason ?? existing.construction_reason ?? null,
    filled_shares: nextFilledShares,
    fill_price: nextFillPrice,
    broker_order_id: nextBrokerOrderId,
    slippage_bps: input.slippageBps ?? existing.slippage_bps ?? null,
    rollout_profile: input.rolloutProfile ?? existing.rollout_profile ?? null,
    session_regime: input.sessionRegime ?? existing.session_regime ?? null,
    sizing_multiplier: input.sizingMultiplier ?? existing.sizing_multiplier ?? null,
    sizing_band: input.sizingBand ?? existing.sizing_band ?? null,
    sizing_reason: input.sizingReason ?? existing.sizing_reason ?? null,
    strategy_band: nextStrategyBand,
    timing_band: nextTimingBand,
    retry_count: nextRetryCount,
    terminal_path: nextTerminalPath,
    completion_ratio: nextCompletionRatio,
    completion_state: nextCompletionState,
    broker_order_ids: JSON.stringify(brokerOrderIds),
    state_history: JSON.stringify(stateHistory),
    submitted_at: nextStatus === 'submitted' && !existing.submitted_at ? nowSeconds : null,
    first_fill_at: (nextFilledShares ?? 0) > 0 && !existing.first_fill_at ? nowSeconds : null,
    last_fill_at: (nextFilledShares ?? 0) > 0 ? nowSeconds : null,
    cancelled_at: nextStatus === 'cancelled' ? nowSeconds : null,
    rejected_at: nextStatus === 'rejected' ? nowSeconds : null,
    completed_at: ['filled', 'rejected', 'cancelled'].includes(nextStatus) ? nowSeconds : null,
    degraded_execution: input.degradedExecution !== undefined ? (input.degradedExecution ? 1 : 0) : existing.degraded_execution ?? null,
    degradation_reasons: JSON.stringify(nextDegradationReasons),
    retry_reason: nextRetryReason,
    error: input.error ?? existing.error ?? null,
  });
}

export function getExecutionAttempts(limit = 100): ExecutionAttemptRecord[] {
  const rows = db.prepare(`
    SELECT * FROM execution_attempts
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    cycleId: row.cycle_id ?? null,
    candidateId: row.candidate_id ?? null,
    symbol: row.symbol,
    action: row.action,
    mode: row.mode,
    status: row.status,
    plannedShares: row.planned_shares ?? null,
    plannedPrice: row.planned_price ?? null,
    initialTargetShares: row.initial_target_shares ?? null,
    initialTargetValue: row.initial_target_value ?? null,
    finalTargetShares: row.final_target_shares ?? null,
    finalTargetValue: row.final_target_value ?? null,
    baseTargetWeight: row.base_target_weight ?? null,
    adjustedTargetWeight: row.adjusted_target_weight ?? null,
    constructionBand: row.construction_band ?? null,
    constructionReason: row.construction_reason ?? null,
    filledShares: row.filled_shares ?? null,
    fillPrice: row.fill_price ?? null,
    brokerOrderId: row.broker_order_id ?? null,
    brokerOrderIds: safeJson<string[]>(row.broker_order_ids, []),
    slippageBps: row.slippage_bps ?? null,
    rolloutProfile: row.rollout_profile ?? null,
    sessionRegime: row.session_regime ?? null,
    sizingMultiplier: row.sizing_multiplier ?? null,
    sizingBand: row.sizing_band ?? null,
    sizingReason: row.sizing_reason ?? null,
    strategyBand: row.strategy_band ?? null,
    timingBand: row.timing_band ?? null,
    retryCount: row.retry_count ?? getAutoResubmitCount(row.retry_reason ?? null),
    terminalPath: row.terminal_path ?? null,
    completionRatio: row.completion_ratio ?? null,
    completionState: row.completion_state ?? null,
    stateHistory: safeJson<any[]>(row.state_history, []),
    submittedAt: row.submitted_at ? row.submitted_at * 1000 : null,
    firstFillAt: row.first_fill_at ? row.first_fill_at * 1000 : null,
    lastFillAt: row.last_fill_at ? row.last_fill_at * 1000 : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at * 1000 : null,
    rejectedAt: row.rejected_at ? row.rejected_at * 1000 : null,
    completedAt: row.completed_at ? row.completed_at * 1000 : null,
    degradedExecution: Boolean(row.degraded_execution),
    degradationReasons: safeJson<string[]>(row.degradation_reasons, []),
    retryReason: row.retry_reason ?? null,
    error: row.error ?? null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  }));
}

export function getExecutionAttemptById(id: string): ExecutionAttemptRecord | null {
  const row = db.prepare(`
    SELECT * FROM execution_attempts
    WHERE id = ?
    LIMIT 1
  `).get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    cycleId: row.cycle_id ?? null,
    candidateId: row.candidate_id ?? null,
    symbol: row.symbol,
    action: row.action,
    mode: row.mode,
    status: row.status,
    plannedShares: row.planned_shares ?? null,
    plannedPrice: row.planned_price ?? null,
    initialTargetShares: row.initial_target_shares ?? null,
    initialTargetValue: row.initial_target_value ?? null,
    finalTargetShares: row.final_target_shares ?? null,
    finalTargetValue: row.final_target_value ?? null,
    baseTargetWeight: row.base_target_weight ?? null,
    adjustedTargetWeight: row.adjusted_target_weight ?? null,
    constructionBand: row.construction_band ?? null,
    constructionReason: row.construction_reason ?? null,
    filledShares: row.filled_shares ?? null,
    fillPrice: row.fill_price ?? null,
    brokerOrderId: row.broker_order_id ?? null,
    brokerOrderIds: safeJson<string[]>(row.broker_order_ids, []),
    slippageBps: row.slippage_bps ?? null,
    rolloutProfile: row.rollout_profile ?? null,
    sessionRegime: row.session_regime ?? null,
    sizingMultiplier: row.sizing_multiplier ?? null,
    sizingBand: row.sizing_band ?? null,
    sizingReason: row.sizing_reason ?? null,
    strategyBand: row.strategy_band ?? null,
    timingBand: row.timing_band ?? null,
    retryCount: row.retry_count ?? getAutoResubmitCount(row.retry_reason ?? null),
    terminalPath: row.terminal_path ?? null,
    completionRatio: row.completion_ratio ?? null,
    completionState: row.completion_state ?? null,
    stateHistory: safeJson<any[]>(row.state_history, []),
    submittedAt: row.submitted_at ? row.submitted_at * 1000 : null,
    firstFillAt: row.first_fill_at ? row.first_fill_at * 1000 : null,
    lastFillAt: row.last_fill_at ? row.last_fill_at * 1000 : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at * 1000 : null,
    rejectedAt: row.rejected_at ? row.rejected_at * 1000 : null,
    completedAt: row.completed_at ? row.completed_at * 1000 : null,
    degradedExecution: Boolean(row.degraded_execution),
    degradationReasons: safeJson<string[]>(row.degradation_reasons, []),
    retryReason: row.retry_reason ?? null,
    error: row.error ?? null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  };
}

export function getExecutionAttemptsByStatus(statuses: ExecutionAttemptRecord['status'][]): ExecutionAttemptRecord[] {
  if (statuses.length === 0) return [];

  const rows = db.prepare(`
    SELECT * FROM execution_attempts
    WHERE status IN (${statuses.map(() => '?').join(',')})
    ORDER BY updated_at DESC
  `).all(...statuses) as any[];

  return rows.map(row => ({
    id: row.id,
    cycleId: row.cycle_id ?? null,
    candidateId: row.candidate_id ?? null,
    symbol: row.symbol,
    action: row.action,
    mode: row.mode,
    status: row.status,
    plannedShares: row.planned_shares ?? null,
    plannedPrice: row.planned_price ?? null,
    initialTargetShares: row.initial_target_shares ?? null,
    initialTargetValue: row.initial_target_value ?? null,
    finalTargetShares: row.final_target_shares ?? null,
    finalTargetValue: row.final_target_value ?? null,
    baseTargetWeight: row.base_target_weight ?? null,
    adjustedTargetWeight: row.adjusted_target_weight ?? null,
    constructionBand: row.construction_band ?? null,
    constructionReason: row.construction_reason ?? null,
    filledShares: row.filled_shares ?? null,
    fillPrice: row.fill_price ?? null,
    brokerOrderId: row.broker_order_id ?? null,
    brokerOrderIds: safeJson<string[]>(row.broker_order_ids, []),
    slippageBps: row.slippage_bps ?? null,
    rolloutProfile: row.rollout_profile ?? null,
    sessionRegime: row.session_regime ?? null,
    sizingMultiplier: row.sizing_multiplier ?? null,
    sizingBand: row.sizing_band ?? null,
    sizingReason: row.sizing_reason ?? null,
    strategyBand: row.strategy_band ?? null,
    timingBand: row.timing_band ?? null,
    retryCount: row.retry_count ?? getAutoResubmitCount(row.retry_reason ?? null),
    terminalPath: row.terminal_path ?? null,
    completionRatio: row.completion_ratio ?? null,
    completionState: row.completion_state ?? null,
    stateHistory: safeJson<any[]>(row.state_history, []),
    submittedAt: row.submitted_at ? row.submitted_at * 1000 : null,
    firstFillAt: row.first_fill_at ? row.first_fill_at * 1000 : null,
    lastFillAt: row.last_fill_at ? row.last_fill_at * 1000 : null,
    cancelledAt: row.cancelled_at ? row.cancelled_at * 1000 : null,
    rejectedAt: row.rejected_at ? row.rejected_at * 1000 : null,
    completedAt: row.completed_at ? row.completed_at * 1000 : null,
    degradedExecution: Boolean(row.degraded_execution),
    degradationReasons: safeJson<string[]>(row.degradation_reasons, []),
    retryReason: row.retry_reason ?? null,
    error: row.error ?? null,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
  }));
}

function computeCompletionRatio(filledShares: number | null, finalTargetShares: number | null): number | null {
  if (!filledShares || !finalTargetShares || finalTargetShares <= 0) return filledShares && filledShares > 0 ? 1 : null;
  return Number(Math.min(1, filledShares / finalTargetShares).toFixed(4));
}

function classifyCompletionState(completionRatio: number | null): 'none' | 'partial' | 'full' | null {
  if (completionRatio === null) return null;
  if (completionRatio >= 0.9999) return 'full';
  if (completionRatio > 0) return 'partial';
  return 'none';
}

function classifyTerminalPath(
  status: ExecutionAttemptStatus,
  retryCount: number,
  filledShares: number | null,
  initialTargetShares: number | null,
  finalTargetShares: number | null,
  strategyBand: string | null,
): string | null {
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') {
    if ((filledShares ?? 0) > 0 && strategyBand === 'halt_partial') return 'halt_after_partial';
    return (filledShares ?? 0) > 0 ? 'cancelled_after_partial' : 'cancelled_no_fill';
  }
  if (status === 'filled') {
    if (retryCount <= 0) return 'first_fill';
    if ((finalTargetShares ?? 0) < (initialTargetShares ?? finalTargetShares ?? 0) || strategyBand === 'reduced' || strategyBand === 'halt_partial') {
      return 'reduced_resubmit_fill';
    }
    return 'reduced_resubmit_fill';
  }
  return null;
}

function appendUniqueString(values: string[], value: string | null): string[] {
  if (!value) return values;
  if (values.includes(value)) return values;
  return [...values, value];
}

function appendLifecycleHistory(
  history: Array<Record<string, any>>,
  existing: any,
  next: { at: number; status: string; brokerOrderId: string | null; filledShares: number | null; error: string | null },
): Array<Record<string, any>> {
  const last = history[history.length - 1];
  if (
    last &&
    last.status === next.status &&
    last.brokerOrderId === next.brokerOrderId &&
    Number(last.filledShares ?? 0) === Number(next.filledShares ?? 0) &&
    String(last.error ?? '') === String(next.error ?? '')
  ) {
    return history;
  }

  return [
    ...history,
    {
      at: next.at,
      status: next.status,
      brokerOrderId: next.brokerOrderId,
      filledShares: next.filledShares,
      error: next.error,
    },
  ];
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
