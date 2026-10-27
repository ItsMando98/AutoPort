import { randomUUID } from 'crypto';
import {
  saveSymbolTheses,
  type PortfolioIntentAction,
} from '../autonomy.js';
import db from '../db.js';
import { createExecutionAttempt, updateExecutionAttempt } from '../execution.js';
import { refreshDegradationState } from '../degradation.js';
import {
  evaluateExecutionRecoveryTimingPolicy,
  evaluateExecutionResubmitStrategyPolicy,
  evaluateExecutionSizingPolicy,
  evaluatePortfolioConstructionPolicy,
} from '../executionPolicy.js';
import { getUpcomingEarnings } from '../fundamentals.js';
import { getLatestMacroRegime, type MacroRegime } from '../macro.js';
import { getMarketSessionStatus } from '../marketclock.js';
import { fetchCurrentPrices, getMarketDataStatus } from '../marketdata.js';
import { markDataSourceFailure, markDataSourceSuccess } from '../ops.js';
import { getState, getTotalValue, persistToDB } from '../portfolio.js';
import { updateSignalCandidateStatus } from '../research.js';
import { checkTradeAllowed, getStopLossAlerts } from '../risk.js';
import { isBrokerConnected } from '../broker.js';
import { getTradingMode, canExecuteTrades, shouldUseBrokerExecution } from '../runtime.js';
import { buildCommitteeDecisions, type CommitteeDecision } from '../portfolioManager.js';
import { determineOrderPlan } from '../strategy.js';
import { WATCHLIST, computeTechnicalSnapshot } from '../technicals.js';
import { shouldConsolidate, consolidate } from '../knowledge.js';
import { getReadinessStatus } from '../readiness.js';
import { evaluateLiveExecutionPolicy } from '../rollout.js';
import { syncTradeAuditFromExecutionAttempt } from '../reconciliation.js';
import { executeOrderIntent } from '../executionGateway.js';
import { BaseAgent } from './base.js';

interface AgentLogEntry {
  type: 'HYPOTHESIS' | 'DECISION' | 'RISK_CHECK' | 'MONITOR' | 'ERROR';
  asset: string;
  content: string;
  action: string;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'COMPLETED';
}

export class CoordinatorAgent extends BaseAgent {
  readonly name = 'coordinator';
  readonly intervalMs = 30_000;
  readonly sourceKey = 'agent';

  protected override get dependencySourceKeys(): string[] {
    return ['research_ingestion', 'macro_fred', 'sentiment_options'];
  }

  private readonly logs: Array<AgentLogEntry & { id: string; timestamp: number }> = [];
  private cycleCount = 0;
  private lastCycleAt: number | null = null;
  private lastCycleId: string | null = null;

  async run(): Promise<void> {
    const cycleId = this.beginCycle('interval');
    const macroRegime = getLatestMacroRegime().regime ?? 'neutral';

    try {
      const prices = await fetchCurrentPrices(WATCHLIST);
      const portfolio = getState();
      const totalValue = getTotalValue(prices);

      await this.processStopLossAlerts(cycleId, totalValue, prices, macroRegime);
      this.warnOnUpcomingEarnings();
      this.publishPositionDriftTheses(portfolio, prices, totalValue);

      const decisions = buildCommitteeDecisions({ macroRegime });
      markDataSourceSuccess('signal_candidates', decisions.length, { macroRegime, mode: 'committee' });
      const candidates = this.chooseCandidatesToTrade(decisions);

      if (candidates.length === 0) {
        this.updateCycle(cycleId, { status: 'completed' });
        this.addLog({
          type: 'MONITOR',
          asset: 'PORTFOLIO',
          content: 'No eligible PM committee decision after freshness and disagreement gating.',
          action: 'HOLD',
          status: 'COMPLETED',
        });
        this.markSuccess(0, { candidate: null, macroRegime });
        this.finalizeCycle(cycleId);
        return;
      }

      // Use the first candidate for cycle tracking; process all in sequence
      const candidate = candidates[0];
      this.updateCycle(cycleId, {
        selectedSymbol: candidate.symbol,
        candidateId: candidate.candidateId,
      });

      const market = getMarketSessionStatus();
      const marketStatus = getMarketDataStatus(getTradingMode());
      if (!market.isOpen || !marketStatus.executionEligible) {
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, {
          status: 'rejected',
          executionResult: {
            rejected: true,
            reason: !market.isOpen ? market.note : marketStatus.reason,
          },
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: !market.isOpen ? market.note : `Trade blocked: ${marketStatus.reason}`,
          action: 'Trade aborted.',
          status: 'REJECTED',
        });
        this.markFailure(!market.isOpen ? market.note : marketStatus.reason, { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      if (!canExecuteTrades()) {
        this.updateCycle(cycleId, {
          status: 'completed',
          executionResult: { analysisOnly: true },
        });
        this.addLog({
          type: 'MONITOR',
          asset: candidate.symbol,
          content: candidate.reasoning,
          action: 'Analysis mode - candidate logged without execution.',
          status: 'COMPLETED',
        });
        this.markSuccess(0, { analysisOnly: true, symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      const executionAction = toExecutionAction(candidate.action, candidate.stance);
      const currentPrice = prices[candidate.symbol];
      if (!currentPrice) {
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, {
          status: 'rejected',
          executionResult: { rejected: true, reason: 'No live price available.' },
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: `Candidate ${candidate.action} ${candidate.symbol} but no live price available.`,
          action: 'Trade aborted.',
          status: 'REJECTED',
        });
        this.markFailure('No live price available.', { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      const degradation = refreshDegradationState();
      if (getTradingMode() === 'live' && !degradation.executionAllowedLive) {
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, {
          status: 'rejected',
          executionResult: { rejected: true, reason: degradation.liveAutoLockReason ?? 'Live execution is auto-locked by degradation controls.' },
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: degradation.liveAutoLockReason ?? 'Live execution is auto-locked by degradation controls.',
          action: 'Trade aborted.',
          status: 'REJECTED',
        });
        this.markFailure(degradation.liveAutoLockReason ?? 'Live execution locked', { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      if (getTradingMode() === 'paper' && !degradation.executionAllowedPaper) {
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, {
          status: 'rejected',
          executionResult: { rejected: true, reason: 'Paper execution is blocked because no valid price path is currently available.' },
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: 'Paper execution is blocked because no valid price path is currently available.',
          action: 'Trade aborted.',
          status: 'REJECTED',
        });
        this.markFailure('Paper execution blocked because no valid price path is currently available.', { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      const constructionPolicy = evaluatePortfolioConstructionPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        degradationSeverity: degradation.severity,
        degradationReasons: degradation.signals.filter(signal => signal.severity !== 'none').map(signal => signal.detail),
        refreshProfiles: false,
      });
      const technicalSnapshot = computeTechnicalSnapshot(candidate.symbol);
      const atrPct = technicalSnapshot && currentPrice > 0 ? technicalSnapshot.atr14 / currentPrice : undefined;
      const baseSizing = determineOrderPlan(
        executionAction,
        Math.round(candidate.confidence * 100),
        candidate.symbol,
        currentPrice,
        portfolio,
        totalValue,
        {
          targetWeightMultiplier: executionAction === 'BUY' ? constructionPolicy.targetWeightMultiplier : 1,
          executionFeedbackBand: executionAction === 'BUY' ? constructionPolicy.band : null,
          executionFeedbackReason: executionAction === 'BUY' ? constructionPolicy.reason : null,
          atrPct,
        },
        macroRegime,
      );
      const sizingPolicy = evaluateExecutionSizingPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        degradationSeverity: degradation.severity,
        degradationReasons: degradation.signals.filter(signal => signal.severity !== 'none').map(signal => signal.detail),
        refreshProfiles: false,
      });
      const adjustedShares = Math.floor((baseSizing.shares ?? 0) * sizingPolicy.multiplier);
      const sizing = {
        ...baseSizing,
        shares: sizingPolicy.blocked ? 0 : adjustedShares,
      };
      const strategyPolicy = evaluateExecutionResubmitStrategyPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        refreshProfiles: false,
      });
      const timingPolicy = evaluateExecutionRecoveryTimingPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        refreshProfiles: false,
      });
      const attemptId = createExecutionAttempt({
        cycleId,
        candidateId: candidate.id,
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        status: 'planned',
        plannedShares: sizing.shares,
        plannedPrice: currentPrice,
        initialTargetShares: baseSizing.shares,
        initialTargetValue: Number((baseSizing.shares * currentPrice).toFixed(2)),
        finalTargetShares: sizing.shares,
        finalTargetValue: Number((sizing.shares * currentPrice).toFixed(2)),
        baseTargetWeight: baseSizing.baseTargetWeight,
        adjustedTargetWeight: baseSizing.adjustedTargetWeight,
        constructionBand: baseSizing.executionFeedbackBand,
        constructionReason: baseSizing.executionFeedbackReason,
        sizingMultiplier: sizingPolicy.multiplier,
        sizingBand: sizingPolicy.band,
        sizingReason: sizingPolicy.reason,
        strategyBand: strategyPolicy.band,
        timingBand: timingPolicy.band,
        degradedExecution: degradation.severity !== 'none',
        degradationReasons: degradation.signals.filter(signal => signal.severity !== 'none').map(signal => `${signal.id}: ${signal.detail}`),
        retryReason: sizing.intent,
        decisionBatchId: candidate.decisionBatchId,
      });

      if (sizing.shares <= 0) {
        updateExecutionAttempt(attemptId, { status: 'rejected', error: sizingPolicy.blocked ? sizingPolicy.reason : 'No tradable quantity' });
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, {
          status: 'rejected',
          riskResult: { allowed: false, reason: sizingPolicy.blocked ? sizingPolicy.reason : 'No tradable quantity' },
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: `${candidate.action} candidate for ${candidate.symbol} generated no tradable quantity.`,
          action: sizingPolicy.reason ?? 'Trade aborted.',
          status: 'REJECTED',
        });
        this.markFailure(sizingPolicy.reason ?? 'No tradable quantity', { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      const risk = checkTradeAllowed(candidate.symbol, executionAction, sizing.shares, currentPrice, {
        cash: portfolio.cash,
        positions: portfolio.positions,
        totalValue,
      });
      this.updateCycle(cycleId, { riskResult: risk });

      if (!risk.allowed) {
        updateExecutionAttempt(attemptId, { status: 'rejected', error: risk.reason });
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.updateCycle(cycleId, { status: 'rejected' });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: `Risk Engine blocked ${candidate.action} ${candidate.symbol}: ${risk.reason}`,
          action: `Failed check: ${risk.failedCheck}`,
          status: 'REJECTED',
        });
        this.markFailure(risk.reason, { symbol: candidate.symbol });
        this.finalizeCycle(cycleId);
        return;
      }

      updateExecutionAttempt(attemptId, { status: 'submitted' });
      const execution = await this.executeCandidateTrade(candidate, executionAction, cycleId, attemptId, sizing.shares, currentPrice, totalValue);
      this.updateCycle(cycleId, {
        status: execution.ok ? 'completed' : 'rejected',
        executionResult: execution,
      });

      if (execution.ok && execution.status === 'filled') {
        updateSignalCandidateStatus(candidate.id, 'executed');
        if (candidate.symbol !== 'MARKET' && shouldConsolidate(candidate.symbol)) {
          consolidate(candidate.symbol).catch(err => this.addLog({
            type: 'ERROR',
            asset: candidate.symbol,
            content: `Knowledge consolidation failed: ${err?.message ?? 'Unknown error'}`,
            action: 'Knowledge',
            status: 'REJECTED',
          }));
        }
        this.markSuccess(1, { symbol: candidate.symbol, action: candidate.action, macroRegime });
      } else if (execution.ok && (execution.status === 'submitted' || execution.status === 'submitted_unknown' || execution.status === 'partially_filled')) {
        updateSignalCandidateStatus(candidate.id, 'in_flight');
        this.markSuccess(0, { symbol: candidate.symbol, action: candidate.action, status: execution.status, macroRegime });
      } else {
        updateSignalCandidateStatus(candidate.id, 'blocked');
        this.markFailure(execution.reason ?? 'Trade execution failed', { symbol: candidate.symbol, action: candidate.action });
      }

      // Execute additional high-conviction candidates in the same cycle
      for (const extra of candidates.slice(1)) {
        await this.tryExecuteAdditionalCandidate(extra, cycleId, prices, portfolio, totalValue, macroRegime);
      }
    } catch (err: any) {
      const message = err?.message ?? 'Unknown error';
      markDataSourceFailure('agent', message);
      this.updateCycle(cycleId, { status: 'error', error: message });
      this.addLog({
        type: 'ERROR',
        asset: 'SYSTEM',
        content: `Cycle error: ${message}`,
        action: 'Will retry on next cycle.',
        status: 'REJECTED',
      });
      this.markFailure(message);
    } finally {
      this.finalizeCycle(cycleId);
    }
  }

  getCoordinatorStatus() {
    const prices = getMarketDataStatus(getTradingMode());
    const readiness = getReadinessStatus();
    const degraded = readiness.degradation.severity !== 'none' || !!prices.lastError;
    return {
      running: this.isRunning(),
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastCycleId: this.lastCycleId,
      processing: this.getStatus().inFlight,
      logsCount: this.getLogs(500).length,
      mode: getTradingMode(),
      degraded,
      killSwitchEngaged: readiness.controls.killSwitchEngaged,
      liveExecutionAllowed: readiness.liveExecutionAllowed,
      readinessEligible: readiness.eligibleForLive,
      marketSession: getMarketSessionStatus(),
      freshness: prices,
    };
  }

  override getLogs(limit = 100) {
    return this.logs.slice(0, Math.min(limit, this.logs.length));
  }

  private beginCycle(triggerReason: string): string {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO agent_cycles (id, started_at, status, mode, trigger_reason)
      VALUES (@id, @started_at, 'running', @mode, @trigger_reason)
    `).run({
      id,
      started_at: Math.floor(Date.now() / 1000),
      mode: getTradingMode(),
      trigger_reason: triggerReason,
    });
    this.lastCycleId = id;
    return id;
  }

  private updateCycle(
    id: string,
    input: Partial<{
      status: 'running' | 'completed' | 'rejected' | 'error';
      selectedSourceType: string | null;
      selectedSourceId: string | null;
      selectedSymbol: string | null;
      candidateId: string | null;
      llmOutput: Record<string, any> | null;
      riskResult: Record<string, any> | null;
      executionResult: Record<string, any> | null;
      error: string | null;
    }>
  ): void {
    db.prepare(`
      UPDATE agent_cycles
      SET completed_at = CASE WHEN @status IN ('completed', 'rejected', 'error') THEN unixepoch() ELSE completed_at END,
          status = COALESCE(@status, status),
          selected_source_type = COALESCE(@selected_source_type, selected_source_type),
          selected_source_id = COALESCE(@selected_source_id, selected_source_id),
          selected_symbol = COALESCE(@selected_symbol, selected_symbol),
          candidate_id = COALESCE(@candidate_id, candidate_id),
          llm_output = COALESCE(@llm_output, llm_output),
          risk_result = COALESCE(@risk_result, risk_result),
          execution_result = COALESCE(@execution_result, execution_result),
          error = COALESCE(@error, error)
      WHERE id = @id
    `).run({
      id,
      status: input.status ?? null,
      selected_source_type: input.selectedSourceType ?? null,
      selected_source_id: input.selectedSourceId ?? null,
      selected_symbol: input.selectedSymbol ?? null,
      candidate_id: input.candidateId ?? null,
      llm_output: input.llmOutput ? JSON.stringify(input.llmOutput) : null,
      risk_result: input.riskResult ? JSON.stringify(input.riskResult) : null,
      execution_result: input.executionResult ? JSON.stringify(input.executionResult) : null,
      error: input.error ?? null,
    });
  }

  private async processStopLossAlerts(
    cycleId: string,
    totalValue: number,
    prices: Record<string, number>,
    macroRegime: MacroRegime,
  ): Promise<void> {
    const alerts = getStopLossAlerts(getState().positions, prices, macroRegime);
    for (const alert of alerts) {
      const exitAction: 'BUY' | 'SELL' = alert.shares < 0 ? 'BUY' : 'SELL';
      const exitShares = Math.abs(alert.shares);
      const attemptId = createExecutionAttempt({
        cycleId,
        symbol: alert.symbol,
        action: exitAction,
        mode: getTradingMode(),
        status: 'planned',
        plannedShares: exitShares,
        plannedPrice: alert.currentPrice,
        initialTargetShares: exitShares,
        initialTargetValue: Number((exitShares * alert.currentPrice).toFixed(2)),
        finalTargetShares: exitShares,
        finalTargetValue: Number((exitShares * alert.currentPrice).toFixed(2)),
        baseTargetWeight: 0,
        adjustedTargetWeight: 0,
        constructionBand: 'clean',
        constructionReason: 'Stop-loss exits bypass pre-trade target-weight adjustments and use the held position size.',
        sizingMultiplier: 1,
        sizingBand: 'base',
        sizingReason: 'Stop-loss exit uses full remaining position size.',
        retryReason: 'stop_loss',
      });
      const execution = await executeOrderIntent({
        attemptId,
        symbol: alert.symbol,
        action: exitAction,
        shares: exitShares,
        referencePrice: alert.currentPrice,
        reason: 'stop_loss',
        riskReducing: true,
      });
      if (!execution.ok || execution.status !== 'filled') {
        this.addLog({
          type: execution.ok ? 'MONITOR' : 'ERROR',
          asset: alert.symbol,
          content: execution.reason ?? `Stop-loss order is ${execution.status}.`,
          action: execution.ok ? 'Awaiting broker reconciliation.' : 'Stop-loss execution failed.',
          status: execution.ok ? 'PENDING' : 'REJECTED',
        });
        continue;
      }

      const pct = (alert.pnlPct * 100).toFixed(1);
      const fillPrice = execution.fillPrice ?? alert.currentPrice;
      this.addLog({
        type: 'RISK_CHECK',
        asset: alert.symbol,
        content: `Stop-loss triggered: ${alert.symbol} down ${pct}% from avg $${alert.avgPrice.toFixed(2)}.`,
        action: `${exitAction === 'BUY' ? 'Auto-bought to cover' : 'Auto-sold'} ${exitShares} shares at $${fillPrice.toFixed(2)}.`,
        status: 'EXECUTED',
      });
      this.saveTrade({
        symbol: alert.symbol,
        action: exitAction,
        shares: exitShares,
        price: fillPrice,
        executionAttemptId: attemptId,
        cycleId,
        exitReason: `Stop-loss: ${pct}% loss`,
        portfolioBefore: totalValue,
      });
    }
  }

  private warnOnUpcomingEarnings(): void {
    const heldSymbols = getState().positions.map(position => position.symbol);
    if (heldSymbols.length === 0) return;

    for (const event of getUpcomingEarnings(3)) {
      if (!heldSymbols.includes(event.symbol)) continue;
      this.addLog({
        type: 'MONITOR',
        asset: event.symbol,
        content: `Earnings in ${event.daysUntil} day(s)${event.epsEstimate ? ` - EPS est. $${event.epsEstimate.toFixed(2)}` : ''}.`,
        action: 'No automatic action - review position manually.',
        status: 'COMPLETED',
      });
    }
  }

  private publishPositionDriftTheses(
    portfolio: { positions: Array<{ symbol: string; shares: number }> },
    prices: Record<string, number>,
    totalValue: number,
  ): void {
    if (totalValue <= 0) return;
    const now = Date.now();
    for (const position of portfolio.positions) {
      const price = prices[position.symbol];
      if (!price) continue;
      const currentWeight = (position.shares * price) / totalValue;

      // Read target weight from most recent filled execution attempt for this symbol
      const row = db.prepare(`
        SELECT base_target_weight FROM execution_attempts
        WHERE symbol = ? AND status = 'filled' AND base_target_weight IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(position.symbol) as { base_target_weight: number } | undefined;

      if (!row?.base_target_weight) continue;
      const targetWeight = row.base_target_weight;
      if (currentWeight > targetWeight * 1.5) {
        saveSymbolTheses([{
          agentName: 'coordinator',
          sourceKey: 'agent',
          symbol: position.symbol,
          stance: 'SELL',
          confidence: 0.62,
          horizon: '1w',
          catalyst: 'position_drift',
          invalidation: 'Position weight returns within 1.3× of target.',
          thesis: `${position.symbol} drifted to ${(currentWeight * 100).toFixed(1)}% vs target ${(targetWeight * 100).toFixed(1)}% — rebalancing needed.`,
          freshnessScore: 0.70,
          createdAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        }]);
      }
    }
  }

  private chooseCandidatesToTrade(candidates: CommitteeDecision[]): Array<CommitteeDecision & { id: string }> {
    const result: Array<CommitteeDecision & { id: string }> = [];
    for (const candidate of candidates) {
      if (candidate.action === 'HOLD') continue;
      const recentTrade = db.prepare(`
        SELECT id FROM trades
        WHERE symbol = ? AND created_at >= unixepoch('now', '-6 hours')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(candidate.symbol) as any;
      if (recentTrade) continue;
      // An execution attempt for this symbol may still be in flight (submitted to the
      // broker but not yet filled/rejected/cancelled) — the `trades` row above is only
      // written on fill, so without this check a later cycle can re-trade the same
      // symbol while the first order is still pending, doubling the position.
      const openAttempt = db.prepare(`
        SELECT id FROM execution_attempts
        WHERE symbol = ?
          AND status IN ('planned', 'submitted', 'submitted_unknown', 'partially_filled')
          AND created_at >= unixepoch('now', '-15 minutes')
        LIMIT 1
      `).get(candidate.symbol) as any;
      if (openAttempt) continue;
      const signalCandidate = db.prepare(`
        SELECT id
        FROM signal_candidates
        WHERE decision_batch_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(candidate.decisionBatchId) as any;
      const entry = { ...candidate, id: signalCandidate?.id ?? candidate.candidateId };
      if (result.length === 0) {
        // First candidate — always include
        result.push(entry);
      } else if (candidate.confidence >= 0.75 && candidate.disagreementPenalty < 0.3) {
        // Additional candidates — only include high-conviction, low-disagreement
        result.push(entry);
        if (result.length >= 3) break;
      }
    }
    return result;
  }

  private async tryExecuteAdditionalCandidate(
    candidate: CommitteeDecision & { id: string },
    cycleId: string,
    prices: Record<string, number>,
    portfolio: ReturnType<typeof getState>,
    totalValue: number,
    macroRegime: string,
  ): Promise<void> {
    try {
      const currentPrice = prices[candidate.symbol];
      if (!currentPrice) return;

      const executionAction = toExecutionAction(candidate.action, candidate.stance);
      const degradation = refreshDegradationState();
      if (getTradingMode() === 'live' && !degradation.executionAllowedLive) return;
      if (getTradingMode() === 'paper' && !degradation.executionAllowedPaper) return;

      const constructionPolicy = evaluatePortfolioConstructionPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        degradationSeverity: degradation.severity,
        degradationReasons: degradation.signals.filter(s => s.severity !== 'none').map(s => s.detail),
        refreshProfiles: false,
      });
      const baseSizing = determineOrderPlan(
        executionAction,
        Math.round(candidate.confidence * 100),
        candidate.symbol,
        currentPrice,
        portfolio,
        totalValue,
        {
          targetWeightMultiplier: executionAction === 'BUY' ? constructionPolicy.targetWeightMultiplier : 1,
          executionFeedbackBand: executionAction === 'BUY' ? constructionPolicy.band : null,
          executionFeedbackReason: executionAction === 'BUY' ? constructionPolicy.reason : null,
        },
        macroRegime as any,
      );
      const sizingPolicy = evaluateExecutionSizingPolicy({
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        degradationSeverity: degradation.severity,
        degradationReasons: degradation.signals.filter(s => s.severity !== 'none').map(s => s.detail),
        refreshProfiles: false,
      });
      const shares = sizingPolicy.blocked ? 0 : Math.floor((baseSizing.shares ?? 0) * sizingPolicy.multiplier);
      if (shares <= 0) return;

      const risk = checkTradeAllowed(candidate.symbol, executionAction, shares, currentPrice, {
        cash: portfolio.cash,
        positions: portfolio.positions,
        totalValue,
      });
      if (!risk.allowed) return;

      const attemptId = createExecutionAttempt({
        cycleId,
        candidateId: candidate.id,
        symbol: candidate.symbol,
        action: executionAction,
        mode: getTradingMode(),
        status: 'submitted',
        plannedShares: shares,
        plannedPrice: currentPrice,
        initialTargetShares: baseSizing.shares,
        initialTargetValue: Number((baseSizing.shares * currentPrice).toFixed(2)),
        finalTargetShares: shares,
        finalTargetValue: Number((shares * currentPrice).toFixed(2)),
        baseTargetWeight: baseSizing.baseTargetWeight,
        adjustedTargetWeight: baseSizing.adjustedTargetWeight,
        constructionBand: baseSizing.executionFeedbackBand,
        constructionReason: baseSizing.executionFeedbackReason,
        sizingMultiplier: sizingPolicy.multiplier,
        sizingBand: sizingPolicy.band,
        sizingReason: sizingPolicy.reason,
        strategyBand: 'base',
        timingBand: 'base',
        retryReason: 'multi_candidate',
      });

      const execution = await this.executeCandidateTrade(candidate, executionAction, cycleId, attemptId, shares, currentPrice, totalValue);
      if (execution.ok && execution.status === 'filled') {
        updateSignalCandidateStatus(candidate.id, 'executed');
      } else if (execution.ok) {
        updateSignalCandidateStatus(candidate.id, 'in_flight');
      } else {
        updateSignalCandidateStatus(candidate.id, 'blocked');
      }
    } catch {
      // Non-fatal — additional candidates are best-effort
    }
  }

  private async executeCandidateTrade(
    candidate: CommitteeDecision & { id: string },
    executionAction: 'BUY' | 'SELL',
    cycleId: string,
    executionAttemptId: string,
    shares: number,
    currentPrice: number,
    portfolioBefore: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    brokerOrderId?: string | null;
    fillPrice?: number | null;
    status?: 'submitted' | 'submitted_unknown' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled';
  }> {
    let tradeAuditUpserted = false;
    const priorPosition = getState().positions.find(position => position.symbol === candidate.symbol);
    const isClosingLong = executionAction === 'SELL' && (priorPosition?.shares ?? 0) > 0;
    const isCoveringShort = executionAction === 'BUY' && (priorPosition?.shares ?? 0) < 0;

    const readiness = getReadinessStatus();
    const liveBrokerExecution = shouldUseBrokerExecution() && isBrokerConnected() && readiness.brokerMode === 'live';

    if (liveBrokerExecution) {
      const livePolicy = evaluateLiveExecutionPolicy({ shares, price: currentPrice });
      if (!livePolicy.allowed) {
        updateExecutionAttempt(executionAttemptId, {
          status: 'rejected',
          error: `Live rollout policy blocked execution: ${livePolicy.reason}`,
        });
        this.addLog({
          type: 'RISK_CHECK',
          asset: candidate.symbol,
          content: `Live rollout policy blocked ${executionAction} ${candidate.symbol}.`,
          action: livePolicy.reason,
          status: 'REJECTED',
        });
        return { ok: false, reason: livePolicy.reason };
      }
    }

    const brokerExecution = shouldUseBrokerExecution() && isBrokerConnected();
    const execution = await executeOrderIntent({
      attemptId: executionAttemptId,
      symbol: candidate.symbol,
      action: executionAction,
      shares,
      referencePrice: currentPrice,
      reason: candidate.reasoning,
      riskReducing: isClosingLong || isCoveringShort,
    });
    const brokerOrderId = execution.brokerOrder?.id ?? null;
    const fillPrice = execution.fillPrice ?? currentPrice;

    if (brokerExecution && execution.brokerOrder) {
      markDataSourceSuccess('broker_submit', 1, {
        symbol: candidate.symbol,
        action: executionAction,
        brokerOrderId,
      });
      if (execution.status === 'partially_filled') {
        syncTradeAuditFromExecutionAttempt(executionAttemptId, candidate.id, execution.brokerOrder, 'partial');
        tradeAuditUpserted = true;
      } else if (execution.status === 'filled') {
        syncTradeAuditFromExecutionAttempt(executionAttemptId, candidate.id, execution.brokerOrder, 'executed');
        tradeAuditUpserted = true;
      }
    } else if (brokerExecution && execution.status === 'submitted_unknown') {
      markDataSourceFailure('broker_submit', execution.reason ?? 'Ambiguous broker submission', {
        symbol: candidate.symbol,
        action: executionAction,
      });
    }

    if (execution.status === 'submitted' || execution.status === 'submitted_unknown' || execution.status === 'partially_filled') {
      this.addLog({
        type: 'DECISION',
        asset: candidate.symbol,
        content: execution.reason ?? `Broker order is ${execution.status}.`,
        action: execution.status === 'partially_filled'
          ? `${execution.brokerOrder?.filledQty ?? 0}/${execution.brokerOrder?.qty ?? shares} shares filled; waiting for completion`
          : 'Order awaits broker reconciliation.',
        status: execution.status === 'partially_filled' ? 'EXECUTED' : 'PENDING',
      });
      return { ok: true, brokerOrderId, fillPrice: execution.fillPrice, status: execution.status };
    }

    if (!execution.ok || execution.status !== 'filled') {
      return { ok: false, reason: execution.reason ?? 'Execution failed', brokerOrderId, fillPrice: execution.fillPrice, status: execution.status };
    }

    persistToDB(getTotalValue(await fetchCurrentPrices(WATCHLIST)));

    if (!tradeAuditUpserted) {
      this.saveTrade({
        symbol: candidate.symbol,
        action: executionAction,
        shares,
        price: fillPrice,
        candidateId: candidate.id,
        executionAttemptId,
        cycleId,
        decisionBatchId: candidate.decisionBatchId,
        portfolioBefore,
        entryThesis: (executionAction === 'BUY' && !isCoveringShort) || (executionAction === 'SELL' && !isClosingLong)
          ? candidate.reasoning
          : undefined,
        exitReason: isClosingLong || isCoveringShort ? candidate.reasoning : undefined,
      });
    }

    db.prepare(`
      INSERT INTO signals (symbol, signal_type, score, confidence, sources, reasoning, status)
      VALUES (@symbol, @signal_type, @score, @confidence, @sources, @reasoning, 'executed')
    `).run({
      symbol: candidate.symbol,
      signal_type: executionAction,
      score: candidate.score,
      confidence: Math.round(candidate.confidence * 100),
      sources: JSON.stringify(['committee_pm', 'symbol_theses', 'market_forecasts', 'portfolio_intents']),
      reasoning: candidate.reasoning,
    });

    this.addLog({
      type: 'DECISION',
      asset: candidate.symbol,
      content: candidate.reasoning,
      action: `${executionAction} ${shares} shares of ${candidate.symbol} at $${fillPrice.toFixed(2)} (${candidate.action})`,
      status: 'EXECUTED',
    });

    return { ok: true, brokerOrderId, fillPrice, status: 'filled' };
  }

  private saveTrade(params: {
    symbol: string;
    action: 'BUY' | 'SELL';
    shares: number;
    price: number;
    candidateId?: string | null;
    executionAttemptId?: string | null;
    cycleId?: string | null;
    decisionBatchId?: string | null;
    entryThesis?: string;
    exitReason?: string;
    portfolioBefore?: number;
    status?: string;
  }): void {
    db.prepare(`
      INSERT OR IGNORE INTO trades
        (id, symbol, action, shares, price, total_value, candidate_id, execution_attempt_id, cycle_id, source_event_ids, entry_thesis, exit_reason,
         risk_check_passed, portfolio_value_before, status, decision_batch_id)
      VALUES
        (@id, @symbol, @action, @shares, @price, @total_value, @candidate_id, @execution_attempt_id, @cycle_id, @source_event_ids, @entry_thesis, @exit_reason,
         1, @portfolio_value_before, @status, @decision_batch_id)
    `).run({
      id: randomUUID(),
      symbol: params.symbol,
      action: params.action,
      shares: params.shares,
      price: params.price,
      total_value: params.shares * params.price,
      candidate_id: params.candidateId ?? null,
      execution_attempt_id: params.executionAttemptId ?? null,
      cycle_id: params.cycleId ?? null,
      source_event_ids: JSON.stringify([]),
      entry_thesis: params.entryThesis ?? null,
      exit_reason: params.exitReason ?? null,
      portfolio_value_before: params.portfolioBefore ?? null,
      status: params.status ?? 'executed',
      decision_batch_id: params.decisionBatchId ?? null,
    });
  }

  private addLog(entry: AgentLogEntry): void {
    const log = { ...entry, id: randomUUID(), timestamp: Date.now() };
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs.pop();

    db.prepare(`
      INSERT INTO engine_logs (id, timestamp, log_type, asset, content, action, status)
      VALUES (@id, @timestamp, @log_type, @asset, @content, @action, @status)
    `).run({
      id: log.id,
      timestamp: log.timestamp,
      log_type: log.type,
      asset: log.asset,
      content: log.content,
      action: log.action,
      status: log.status,
    });
  }

  private finalizeCycle(cycleId: string): void {
    this.lastCycleAt = Date.now();
    this.cycleCount += 1;
    if (!cycleId) return;
  }
}

function toExecutionAction(action: PortfolioIntentAction, stance: 'BUY' | 'SELL' | 'HOLD'): 'BUY' | 'SELL' {
  if (action === 'BUY' || action === 'ADD') return 'BUY';
  if (action === 'TRIM' || action === 'EXIT') return 'SELL';
  return stance === 'SELL' ? 'SELL' : 'BUY';
}
