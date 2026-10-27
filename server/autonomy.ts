import { randomUUID } from 'crypto';
import db from './db.js';

export type ThesisStance = 'BUY' | 'SELL' | 'HOLD';
export type PortfolioIntentAction = 'BUY' | 'SELL' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD';
export type ForecastDirection = 'up' | 'down' | 'flat';
export type ForecastStatus = 'open' | 'resolved' | 'expired';
export type RunStatus = 'running' | 'success' | 'failure';

export interface AgentRunInput {
  agentName: string;
  sourceKey: string;
  triggerReason: string;
  cadenceMs: number;
  freshnessTtlMs?: number | null;
  inputs?: Record<string, any> | null;
}

export interface AgentObservationInput {
  agentName: string;
  sourceKey: string;
  symbol?: string | null;
  topic?: string | null;
  observationType: string;
  value?: number | null;
  confidence?: number | null;
  details?: Record<string, any> | null;
  observedAt?: number;
  expiresAt?: number | null;
}

export interface SymbolThesisInput {
  agentName: string;
  sourceKey: string;
  symbol: string;
  stance: ThesisStance;
  confidence: number;
  horizon: string;
  catalyst?: string | null;
  invalidation?: string | null;
  thesis: string;
  supportingObservationIds?: string[];
  freshnessScore?: number;
  createdAt?: number;
  expiresAt?: number | null;
}

export interface EventForecastInput {
  agentName: string;
  sourceKey: string;
  symbol?: string | null;
  targetVariable: string;
  eventType: string;
  direction: ForecastDirection;
  probability: number;
  confidence: number;
  reasoning: string;
  windowStartAt: number;
  windowEndAt: number;
  baselineValue?: number | null;
  metadata?: Record<string, any> | null;
}

export interface MarketForecastInput {
  agentName: string;
  sourceKey: string;
  scope: string;
  targetVariable: string;
  outcomeSymbol: string;
  direction: ForecastDirection;
  probability: number;
  confidence: number;
  reasoning: string;
  windowStartAt: number;
  windowEndAt: number;
  regime?: string | null;
  metadata?: Record<string, any> | null;
}

export interface DecisionContribution {
  agentName: string;
  sourceKey: string;
  symbol: string;
  stance: ThesisStance;
  confidence: number;
  weight: number;
  weightedScore: number;
  freshnessScore: number;
  thesisId?: string;
  thesis: string;
}

export interface DecisionBatchInput {
  symbol: string;
  action: PortfolioIntentAction;
  stance: ThesisStance;
  confidence: number;
  score: number;
  disagreementPenalty: number;
  freshnessScore: number;
  coverage: number;
  requiredCoverageMet: boolean;
  macroRegime: string;
  decisionReason: string;
  heldOutReason?: string | null;
  contributions: DecisionContribution[];
  sourceThesisIds: string[];
  sourceForecastIds?: string[];
  metadata?: Record<string, any> | null;
}

export interface LatestThesisRecord {
  id: string;
  agentName: string;
  sourceKey: string;
  symbol: string;
  stance: ThesisStance;
  confidence: number;
  horizon: string;
  catalyst: string | null;
  invalidation: string | null;
  thesis: string;
  freshnessScore: number;
  supportingObservationIds: string[];
  createdAt: number;
  expiresAt: number | null;
}

export interface AgentCalibrationWeight {
  sourceKey: string;
  weight: number;
  hitRate: number;
  sampleSize: number;
}

export function startAgentRun(input: AgentRunInput): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO agent_runs
      (id, agent_name, source_key, trigger_reason, cadence_ms, freshness_ttl_ms, status, started_at, inputs)
    VALUES
      (@id, @agent_name, @source_key, @trigger_reason, @cadence_ms, @freshness_ttl_ms, 'running', @started_at, @inputs)
  `).run({
    id,
    agent_name: input.agentName,
    source_key: input.sourceKey,
    trigger_reason: input.triggerReason,
    cadence_ms: input.cadenceMs,
    freshness_ttl_ms: input.freshnessTtlMs ?? null,
    started_at: Math.floor(Date.now() / 1000),
    inputs: serialize(input.inputs ?? null),
  });
  return id;
}

export function finishAgentRun(
  id: string,
  status: Exclude<RunStatus, 'running'>,
  input: {
    recordsWritten?: number;
    runtimeMs?: number;
    usableOutputAt?: number | null;
    error?: string | null;
    details?: Record<string, any> | null;
  } = {},
): void {
  db.prepare(`
    UPDATE agent_runs
    SET status = @status,
        completed_at = @completed_at,
        runtime_ms = @runtime_ms,
        records_written = COALESCE(@records_written, records_written),
        usable_output_at = @usable_output_at,
        error = @error,
        details = COALESCE(@details, details)
    WHERE id = @id
  `).run({
    id,
    status,
    completed_at: Math.floor(Date.now() / 1000),
    runtime_ms: input.runtimeMs ?? null,
    records_written: input.recordsWritten ?? null,
    usable_output_at: toUnixSeconds(input.usableOutputAt ?? Date.now()),
    error: input.error ?? null,
    details: serialize(input.details ?? null),
  });
}

export function saveAgentObservations(observations: AgentObservationInput[]): string[] {
  if (observations.length === 0) return [];
  const insert = db.prepare(`
    INSERT INTO agent_observations
      (id, agent_name, source_key, symbol, topic, market_topic, observation_type, numeric_value, confidence,
       title, summary, details, payload, source_refs, freshness_score, observed_at, expires_at)
    VALUES
      (@id, @agent_name, @source_key, @symbol, @topic, @market_topic, @observation_type, @numeric_value, @confidence,
       @title, @summary, @details, @payload, @source_refs, @freshness_score, @observed_at, @expires_at)
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const observation of observations) {
      const id = randomUUID();
      ids.push(id);
      insert.run({
        id,
        agent_name: observation.agentName,
        source_key: observation.sourceKey,
        symbol: normalizeSymbol(observation.symbol ?? null),
        topic: observation.topic ?? null,
        market_topic: observation.topic ?? null,
        observation_type: observation.observationType,
        numeric_value: observation.value ?? null,
        confidence: clamp(observation.confidence ?? null, 0, 1),
        title: observation.observationType,
        summary: summarizeDetails(observation.details),
        details: serialize(observation.details ?? null),
        payload: serialize(observation.details ?? null),
        source_refs: serialize([]),
        freshness_score: clamp(observation.confidence ?? 0.75, 0, 1),
        observed_at: toUnixSeconds(observation.observedAt ?? Date.now()),
        expires_at: toUnixSeconds(observation.expiresAt ?? null),
      });
    }
  });
  tx();
  return ids;
}

export function saveSymbolTheses(theses: SymbolThesisInput[]): string[] {
  if (theses.length === 0) return [];
  const insert = db.prepare(`
    INSERT INTO symbol_theses
      (id, agent_name, source_key, symbol, stance, confidence, horizon, catalyst, catalysts, invalidation, thesis,
       reasoning, supporting_observation_ids, freshness_score, metadata, valid_from, created_at, expires_at)
    VALUES
      (@id, @agent_name, @source_key, @symbol, @stance, @confidence, @horizon, @catalyst, @catalysts, @invalidation, @thesis,
       @reasoning, @supporting_observation_ids, @freshness_score, @metadata, @valid_from, @created_at, @expires_at)
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const thesis of theses) {
      const id = randomUUID();
      ids.push(id);
      insert.run({
        id,
        agent_name: thesis.agentName,
        source_key: thesis.sourceKey,
        symbol: normalizeSymbol(thesis.symbol),
        stance: thesis.stance,
        confidence: clamp(thesis.confidence, 0, 1),
        horizon: thesis.horizon,
        catalyst: thesis.catalyst ?? null,
        catalysts: thesis.catalyst ?? null,
        invalidation: thesis.invalidation ?? null,
        thesis: thesis.thesis,
        reasoning: thesis.thesis,
        supporting_observation_ids: serialize(thesis.supportingObservationIds ?? []),
        freshness_score: clamp(thesis.freshnessScore ?? 0.8, 0, 1),
        metadata: serialize(null),
        valid_from: toUnixSeconds(thesis.createdAt ?? Date.now()),
        created_at: toUnixSeconds(thesis.createdAt ?? Date.now()),
        expires_at: toUnixSeconds(thesis.expiresAt ?? null),
      });
    }
  });
  tx();
  return ids;
}

/**
 * True if an unresolved forecast already exists for this symbol/source/variable
 * combination. Agents that run on a fixed interval (or re-fire on process
 * restart via the 'startup' trigger) would otherwise re-assert the same claim
 * every cycle while the original forecast is still pending resolution,
 * inflating sample size and skewing calibration stats without adding any new
 * information.
 */
export function hasOpenForecast(sourceKey: string, symbol: string | null, targetVariable: string): boolean {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return false;
  const row = db.prepare(`
    SELECT id FROM event_forecasts
    WHERE source_key = ? AND symbol = ? AND target_variable = ? AND status = 'open'
    LIMIT 1
  `).get(sourceKey, normalized, targetVariable) as any;
  return !!row;
}

/**
 * True if an unresolved market-level forecast already exists for this
 * source/scope/variable combination. Same rationale as hasOpenForecast, for
 * agents (macro, market_breadth) that publish to market_forecasts instead of
 * per-symbol event_forecasts.
 */
export function hasOpenMarketForecast(sourceKey: string, scope: string, targetVariable: string): boolean {
  const row = db.prepare(`
    SELECT id FROM market_forecasts
    WHERE source_key = ? AND scope = ? AND target_variable = ? AND status = 'open'
    LIMIT 1
  `).get(sourceKey, scope, targetVariable) as any;
  return !!row;
}

export function saveEventForecasts(forecasts: EventForecastInput[]): string[] {
  if (forecasts.length === 0) return [];
  const insert = db.prepare(`
    INSERT INTO event_forecasts
      (id, agent_name, source_key, symbol, market_topic, target_variable, target_value, event_type, direction, predicted_direction, probability, confidence,
       reasoning, window_start_at, window_end_at, resolution_window_start, resolution_window_end, prediction_timestamp,
       baseline_value, metadata, status, created_at)
    VALUES
      (@id, @agent_name, @source_key, @symbol, @market_topic, @target_variable, @target_value, @event_type, @direction, @predicted_direction, @probability, @confidence,
       @reasoning, @window_start_at, @window_end_at, @resolution_window_start, @resolution_window_end, @prediction_timestamp,
       @baseline_value, @metadata, 'open', unixepoch())
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const forecast of forecasts) {
      const id = randomUUID();
      ids.push(id);
      insert.run({
        id,
        agent_name: forecast.agentName,
        source_key: forecast.sourceKey,
        symbol: normalizeSymbol(forecast.symbol ?? null),
        market_topic: forecast.symbol ? null : forecast.eventType,
        target_variable: forecast.targetVariable,
        target_value: forecast.targetVariable,
        event_type: forecast.eventType,
        direction: forecast.direction,
        predicted_direction: forecast.direction,
        probability: clamp(forecast.probability, 0, 1),
        confidence: clamp(forecast.confidence, 0, 1),
        reasoning: forecast.reasoning,
        window_start_at: toUnixSeconds(forecast.windowStartAt),
        window_end_at: toUnixSeconds(forecast.windowEndAt),
        resolution_window_start: toUnixSeconds(forecast.windowStartAt),
        resolution_window_end: toUnixSeconds(forecast.windowEndAt),
        prediction_timestamp: Math.floor(Date.now() / 1000),
        baseline_value: forecast.baselineValue ?? null,
        metadata: serialize(forecast.metadata ?? null),
      });
    }
  });
  tx();
  return ids;
}

export function saveMarketForecasts(forecasts: MarketForecastInput[]): string[] {
  if (forecasts.length === 0) return [];
  const insert = db.prepare(`
    INSERT INTO market_forecasts
      (id, agent_name, source_key, scope, forecast_type, target_variable, target, direction, predicted_direction, probability, confidence,
       reasoning, window_start_at, window_end_at, resolution_window_start, resolution_window_end, prediction_timestamp,
       regime, metadata, status, created_at)
    VALUES
      (@id, @agent_name, @source_key, @scope, @forecast_type, @target_variable, @target, @direction, @predicted_direction, @probability, @confidence,
       @reasoning, @window_start_at, @window_end_at, @resolution_window_start, @resolution_window_end, @prediction_timestamp,
       @regime, @metadata, 'open', unixepoch())
  `);
  const ids: string[] = [];
  const tx = db.transaction(() => {
    for (const forecast of forecasts) {
      const id = randomUUID();
      ids.push(id);
      insert.run({
        id,
        agent_name: forecast.agentName,
        source_key: forecast.sourceKey,
        scope: forecast.scope,
        forecast_type: forecast.scope,
        target_variable: forecast.targetVariable,
        target: forecast.targetVariable,
        direction: forecast.direction,
        predicted_direction: forecast.direction,
        probability: clamp(forecast.probability, 0, 1),
        confidence: clamp(forecast.confidence, 0, 1),
        reasoning: forecast.reasoning,
        window_start_at: toUnixSeconds(forecast.windowStartAt),
        window_end_at: toUnixSeconds(forecast.windowEndAt),
        resolution_window_start: toUnixSeconds(forecast.windowStartAt),
        resolution_window_end: toUnixSeconds(forecast.windowEndAt),
        prediction_timestamp: Math.floor(Date.now() / 1000),
        regime: forecast.regime ?? null,
        metadata: serialize({
          ...(forecast.metadata ?? {}),
          outcomeSymbol: normalizeSymbol(forecast.outcomeSymbol),
        }),
      });
    }
  });
  tx();
  return ids;
}

export function saveDecisionBatch(input: DecisionBatchInput): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO decision_batches
      (id, symbol, action, stance, decision_action, execution_action, intent, conviction, confidence, score, consensus_score,
       disagreement_penalty, freshness_score, coverage, coverage_score, required_coverage_met, freshness_ok,
       macro_regime, decision_reason, held_out_reason, committee_summary, contributions, contribution_weights,
       source_thesis_ids, thesis_ids, source_forecast_ids, forecast_ids, metadata, decided_at, created_at, status)
    VALUES
      (@id, @symbol, @action, @stance, @decision_action, @execution_action, @intent, @conviction, @confidence, @score, @consensus_score,
       @disagreement_penalty, @freshness_score, @coverage, @coverage_score, @required_coverage_met, @freshness_ok,
       @macro_regime, @decision_reason, @held_out_reason, @committee_summary, @contributions, @contribution_weights,
       @source_thesis_ids, @thesis_ids, @source_forecast_ids, @forecast_ids, @metadata, @decided_at, unixepoch(), 'new')
  `).run({
    id,
    symbol: normalizeSymbol(input.symbol),
    action: input.action,
    stance: input.stance,
    decision_action: input.action,
    execution_action: input.stance === 'SELL' ? 'SELL' : input.stance === 'BUY' ? 'BUY' : 'HOLD',
    intent: input.action,
    conviction: clamp(input.confidence, 0, 1),
    confidence: clamp(input.confidence, 0, 1),
    score: input.score,
    consensus_score: input.score,
    disagreement_penalty: clamp(input.disagreementPenalty, 0, 1),
    freshness_score: clamp(input.freshnessScore, 0, 1),
    coverage: input.coverage,
    coverage_score: input.coverage,
    required_coverage_met: input.requiredCoverageMet ? 1 : 0,
    freshness_ok: input.freshnessScore >= 0.5 ? 1 : 0,
    macro_regime: input.macroRegime,
    decision_reason: input.decisionReason,
    held_out_reason: input.heldOutReason ?? null,
    committee_summary: input.decisionReason,
    contributions: serialize(input.contributions),
    contribution_weights: serialize(input.contributions.map(item => ({
      agentName: item.agentName,
      sourceKey: item.sourceKey,
      weight: item.weight,
    }))),
    source_thesis_ids: serialize(input.sourceThesisIds),
    thesis_ids: serialize(input.sourceThesisIds),
    source_forecast_ids: serialize(input.sourceForecastIds ?? []),
    forecast_ids: serialize(input.sourceForecastIds ?? []),
    metadata: serialize(input.metadata ?? null),
    decided_at: Math.floor(Date.now() / 1000),
  });

  db.prepare(`
    INSERT INTO portfolio_intents
      (id, symbol, action, desired_action, confidence, conviction, score, decision_batch_id, reasoning, rationale, status, created_at, updated_at)
    VALUES
      (@id, @symbol, @action, @desired_action, @confidence, @conviction, @score, @decision_batch_id, @reasoning, @rationale, 'active', unixepoch(), unixepoch())
    ON CONFLICT(symbol) DO UPDATE SET
      action = excluded.action,
      desired_action = excluded.desired_action,
      confidence = excluded.confidence,
      conviction = excluded.conviction,
      score = excluded.score,
      decision_batch_id = excluded.decision_batch_id,
      reasoning = excluded.reasoning,
      rationale = excluded.rationale,
      status = 'active',
      updated_at = unixepoch()
  `).run({
    id: randomUUID(),
    symbol: normalizeSymbol(input.symbol),
    action: input.action,
    desired_action: input.action,
    confidence: clamp(input.confidence, 0, 1),
    conviction: clamp(input.confidence, 0, 1),
    score: input.score,
    decision_batch_id: id,
    reasoning: input.heldOutReason ?? input.decisionReason,
    rationale: input.heldOutReason ?? input.decisionReason,
  });

  return id;
}

export function getLatestSymbolTheses(options: {
  symbol?: string;
  limit?: number;
  onlyFresh?: boolean;
  includeThemeSources?: boolean;
} = {}): LatestThesisRecord[] {
  const limit = Math.min(options.limit ?? 200, 1000);
  // Deduplicate to "one row per (agent_name, symbol)" INSIDE the SQL query via
  // a window function, before any LIMIT is applied. The previous version took
  // the globally most-recent N rows first and deduped after — for a symbol
  // that isn't among the most recently active, its still-valid thesis from a
  // given source could fall outside that window entirely once enough OTHER
  // symbols/sources produced newer rows, silently reporting it as "missing"
  // coverage (e.g. blocking a legitimate risk-driven SELL as a false-negative
  // coverage gap) even though a fresh thesis exists in the table.
  const rows = options.symbol
    ? db.prepare(`
        WITH ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY agent_name, symbol ORDER BY created_at DESC) AS rn
          FROM symbol_theses
          WHERE symbol = ?
        )
        SELECT * FROM ranked WHERE rn = 1
        ORDER BY created_at DESC
        LIMIT ?
      `).all(normalizeSymbol(options.symbol), limit)
    : db.prepare(`
        WITH ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY agent_name, symbol ORDER BY created_at DESC) AS rn
          FROM symbol_theses
        )
        SELECT * FROM ranked WHERE rn = 1
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

  const latestByAgentAndSymbol = new Map<string, LatestThesisRecord>();
  for (const row of rows as any[]) {
    if (options.includeThemeSources === false && String(row.source_key ?? '').startsWith('theme_')) continue;
    const record = rowToLatestThesis(row);
    if (options.onlyFresh && !isFresh(record.expiresAt, Date.now())) continue;
    const key = `${record.agentName}:${record.symbol}`;
    if (!latestByAgentAndSymbol.has(key)) {
      latestByAgentAndSymbol.set(key, record);
    }
  }
  return [...latestByAgentAndSymbol.values()];
}

export function getLatestDecisionBatches(limit = 50, symbol?: string): any[] {
  const rows = symbol
    ? db.prepare(`
        SELECT *
        FROM decision_batches
        WHERE symbol = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(normalizeSymbol(symbol), limit)
    : db.prepare(`
        SELECT *
        FROM decision_batches
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

  return (rows as any[]).map(row => ({
    id: row.id,
    symbol: row.symbol,
    action: row.action,
    stance: row.stance,
    confidence: row.confidence,
    score: row.score,
    disagreementPenalty: row.disagreement_penalty,
    freshnessScore: row.freshness_score,
    coverage: row.coverage,
    requiredCoverageMet: Boolean(row.required_coverage_met),
    macroRegime: row.macro_regime,
    decisionReason: row.decision_reason,
    heldOutReason: row.held_out_reason ?? null,
    contributions: parseJson(row.contributions, []),
    sourceThesisIds: parseJson(row.source_thesis_ids, []),
    sourceForecastIds: parseJson(row.source_forecast_ids, []),
    metadata: parseJson(row.metadata, {}),
    createdAt: toMs(row.created_at),
  }));
}

export function getPortfolioIntents(limit = 100): any[] {
  const rows = db.prepare(`
    SELECT *
    FROM portfolio_intents
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(Math.min(limit, 500)) as any[];
  return rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    action: row.action,
    confidence: row.confidence,
    score: row.score,
    decisionBatchId: row.decision_batch_id,
    reasoning: row.reasoning,
    status: row.status,
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  }));
}

export function getDecisionLineage(decisionBatchId: string): {
  decision: any | null;
  theses: LatestThesisRecord[];
  forecasts: any[];
  trades: any[];
} {
  const decision = getLatestDecisionBatches(1).find(entry => entry.id === decisionBatchId)
    ?? getDecisionBatchById(decisionBatchId);
  if (!decision) {
    return { decision: null, theses: [], forecasts: [], trades: [] };
  }

  const thesisIds = new Set<string>(decision.sourceThesisIds ?? []);
  const theses = thesisIds.size === 0
    ? []
    : (db.prepare(`
        SELECT *
        FROM symbol_theses
        WHERE id IN (${[...thesisIds].map(() => '?').join(',')})
        ORDER BY created_at DESC
      `).all(...thesisIds) as any[]).map(rowToLatestThesis);

  const forecastIds = new Set<string>(decision.sourceForecastIds ?? []);
  const forecasts = forecastIds.size === 0
    ? []
    : db.prepare(`
        SELECT id, agent_name, source_key, symbol, target_variable, event_type, direction, probability, confidence,
               reasoning, window_start_at, window_end_at, resolution_at, actual_direction, actual_value, status
        FROM event_forecasts
        WHERE id IN (${[...forecastIds].map(() => '?').join(',')})
        UNION ALL
        SELECT id, agent_name, source_key, NULL as symbol, target_variable, scope as event_type, direction, probability, confidence,
               reasoning, window_start_at, window_end_at, resolution_at, actual_direction, actual_value, status
        FROM market_forecasts
        WHERE id IN (${[...forecastIds].map(() => '?').join(',')})
      `).all(...forecastIds, ...forecastIds);

  const trades = db.prepare(`
    SELECT *
    FROM trades
    WHERE decision_batch_id = ?
    ORDER BY created_at DESC
  `).all(decisionBatchId) as any[];

  return { decision, theses, forecasts, trades };
}

export function getCalibrationSummary(): {
  bySource: Array<AgentCalibrationWeight & { brierScore: number | null; avgConfidence: number | null }>;
  overall: { totalResolved: number; hitRate: number | null; brierScore: number | null };
} {
  const rows = db.prepare(`
    SELECT source_key,
           COUNT(*) as sample_size,
           AVG(CASE WHEN resolved_correct = 1 THEN 1.0 ELSE 0.0 END) as hit_rate,
           AVG(CASE WHEN probability IS NOT NULL AND resolved_correct IS NOT NULL
                    THEN ((probability - resolved_correct) * (probability - resolved_correct))
                    ELSE NULL END) as brier_score,
           AVG(confidence) as avg_confidence
    FROM realized_outcomes
    WHERE resolved_correct IS NOT NULL
    GROUP BY source_key
    ORDER BY sample_size DESC, source_key ASC
  `).all() as any[];

  const total = db.prepare(`
    SELECT COUNT(*) as sample_size,
           AVG(CASE WHEN resolved_correct = 1 THEN 1.0 ELSE 0.0 END) as hit_rate,
           AVG(CASE WHEN probability IS NOT NULL AND resolved_correct IS NOT NULL
                    THEN ((probability - resolved_correct) * (probability - resolved_correct))
                    ELSE NULL END) as brier_score
    FROM realized_outcomes
    WHERE resolved_correct IS NOT NULL
  `).get() as any;

  return {
    bySource: rows.map(row => ({
      sourceKey: row.source_key,
      weight: computeCalibrationWeight(row.hit_rate, row.sample_size),
      hitRate: round(row.hit_rate ?? 0, 4),
      sampleSize: row.sample_size,
      brierScore: row.brier_score === null ? null : round(row.brier_score, 4),
      avgConfidence: row.avg_confidence === null ? null : round(row.avg_confidence, 4),
    })),
    overall: {
      totalResolved: total?.sample_size ?? 0,
      hitRate: total?.hit_rate === null || total?.hit_rate === undefined ? null : round(total.hit_rate, 4),
      brierScore: total?.brier_score === null || total?.brier_score === undefined ? null : round(total.brier_score, 4),
    },
  };
}

let calibrationWeightsCache: { weights: Map<string, AgentCalibrationWeight>; at: number } | null = null;
const CALIBRATION_CACHE_TTL_MS = 5 * 60 * 1000;

export function getAgentCalibrationWeights(): Map<string, AgentCalibrationWeight> {
  const now = Date.now();

  // Use cache if fresh
  if (calibrationWeightsCache && now - calibrationWeightsCache.at < CALIBRATION_CACHE_TTL_MS) {
    return calibrationWeightsCache.weights;
  }

  // Try reading from persisted table first
  try {
    const rows = db.prepare(`
      SELECT source_key, weight, hit_rate, sample_size
      FROM agent_calibration_weights
      WHERE last_computed_at > unixepoch('now', '-5 minutes')
    `).all() as any[];

    if (rows.length > 0) {
      const weights = new Map<string, AgentCalibrationWeight>(
        rows.map((row: any) => [row.source_key, {
          sourceKey: row.source_key,
          weight: row.weight,
          hitRate: row.hit_rate,
          sampleSize: row.sample_size,
        }])
      );
      calibrationWeightsCache = { weights, at: now };
      return weights;
    }
  } catch {
    // Fall through to full recomputation
  }

  // Fall back to full recomputation
  const summary = getCalibrationSummary();
  const weights = new Map(summary.bySource.map(entry => [entry.sourceKey, {
    sourceKey: entry.sourceKey,
    weight: entry.weight,
    hitRate: entry.hitRate,
    sampleSize: entry.sampleSize,
  }]));
  calibrationWeightsCache = { weights, at: now };
  return weights;
}

export function getAgentFreshnessStatus(now = Date.now()): Array<{
  agentName: string;
  sourceKey: string;
  cadenceMs: number;
  freshnessTtlMs: number | null;
  lastRunAt: number | null;
  lastUsableOutputAt: number | null;
  cadenceStatus: 'on_time' | 'late' | 'missed' | 'idle';
  freshnessStatus: 'fresh' | 'stale' | 'idle';
}> {
  const rows = db.prepare(`
    SELECT agent_name, source_key, cadence_ms, freshness_ttl_ms, MAX(started_at) as last_run_at, MAX(usable_output_at) as last_usable_output_at
    FROM agent_runs
    GROUP BY agent_name, source_key, cadence_ms, freshness_ttl_ms
  `).all() as any[];

  return rows.map(row => {
    const lastRunAt = row.last_run_at ? row.last_run_at * 1000 : null;
    const lastUsableOutputAt = row.last_usable_output_at ? row.last_usable_output_at * 1000 : null;
    const cadenceMs = row.cadence_ms ?? 0;
    const freshnessTtlMs = row.freshness_ttl_ms ?? null;
    const cadenceDelta = lastRunAt === null ? null : now - lastRunAt;
    const freshnessDelta = lastUsableOutputAt === null ? null : now - lastUsableOutputAt;
    return {
      agentName: row.agent_name,
      sourceKey: row.source_key,
      cadenceMs,
      freshnessTtlMs,
      lastRunAt,
      lastUsableOutputAt,
      cadenceStatus: classifyCadence(cadenceDelta, cadenceMs),
      freshnessStatus: classifyFreshness(freshnessDelta, freshnessTtlMs),
    };
  });
}

export function resolveForecastOutcomes(now = Date.now()): { resolved: number; expired: number } {
  let resolved = 0;
  let expired = 0;

  const eventRows = db.prepare(`
    SELECT *
    FROM event_forecasts
    WHERE status = 'open' AND window_end_at <= ?
    ORDER BY window_end_at ASC
  `).all(Math.floor(now / 1000)) as any[];

  const marketRows = db.prepare(`
    SELECT *
    FROM market_forecasts
    WHERE status = 'open' AND window_end_at <= ?
    ORDER BY window_end_at ASC
  `).all(Math.floor(now / 1000)) as any[];

  for (const row of eventRows) {
    const outcome = resolveDirectionalOutcome(row.symbol, row.window_start_at, row.window_end_at, row.baseline_value);
    if (outcome) {
      finalizeEventForecast(row, outcome);
      resolved += 1;
    } else {
      expireEventForecast(row);
      expired += 1;
    }
  }

  for (const row of marketRows) {
    const metadata = parseJson<Record<string, any>>(row.metadata, {});
    const outcomeSymbol = normalizeSymbol(metadata.outcomeSymbol);
    if (!outcomeSymbol) {
      expireMarketForecast(row);
      expired += 1;
      continue;
    }
    const outcome = resolveDirectionalOutcome(outcomeSymbol, row.window_start_at, row.window_end_at, null);
    if (outcome) {
      finalizeMarketForecast(row, outcome);
      resolved += 1;
    } else {
      expireMarketForecast(row);
      expired += 1;
    }
  }

  return { resolved, expired };
}

function finalizeEventForecast(row: any, outcome: {
  baselineValue: number;
  actualValue: number;
  actualDirection: ForecastDirection;
}): void {
  const resolvedCorrect = Number(row.direction === outcome.actualDirection);
  db.prepare(`
    UPDATE event_forecasts
    SET status = 'resolved',
        actual_value = @actual_value,
        actual_direction = @actual_direction,
        resolved_correct = @resolved_correct,
        resolution_at = unixepoch()
    WHERE id = @id
  `).run({
    id: row.id,
    actual_value: outcome.actualValue,
    actual_direction: outcome.actualDirection,
    resolved_correct: resolvedCorrect,
  });

  insertRealizedOutcome({
    sourceTable: 'event_forecasts',
    sourceId: row.id,
    sourceKey: row.source_key,
    symbol: row.symbol,
    targetVariable: row.target_variable,
    predictedDirection: row.direction,
    actualDirection: outcome.actualDirection,
    probability: row.probability,
    confidence: row.confidence,
    predictedValue: row.baseline_value,
    actualValue: outcome.actualValue,
    resolvedCorrect,
  });
}

function finalizeMarketForecast(row: any, outcome: {
  baselineValue: number;
  actualValue: number;
  actualDirection: ForecastDirection;
}): void {
  const resolvedCorrect = Number(row.direction === outcome.actualDirection);
  db.prepare(`
    UPDATE market_forecasts
    SET status = 'resolved',
        actual_value = @actual_value,
        actual_direction = @actual_direction,
        resolved_correct = @resolved_correct,
        resolution_at = unixepoch()
    WHERE id = @id
  `).run({
    id: row.id,
    actual_value: outcome.actualValue,
    actual_direction: outcome.actualDirection,
    resolved_correct: resolvedCorrect,
  });

  insertRealizedOutcome({
    sourceTable: 'market_forecasts',
    sourceId: row.id,
    sourceKey: row.source_key,
    symbol: null,
    targetVariable: row.target_variable,
    predictedDirection: row.direction,
    actualDirection: outcome.actualDirection,
    probability: row.probability,
    confidence: row.confidence,
    predictedValue: null,
    actualValue: outcome.actualValue,
    resolvedCorrect,
  });
}

function expireEventForecast(row: any): void {
  db.prepare(`
    UPDATE event_forecasts
    SET status = 'expired', resolution_at = unixepoch()
    WHERE id = ?
  `).run(row.id);
}

function expireMarketForecast(row: any): void {
  db.prepare(`
    UPDATE market_forecasts
    SET status = 'expired', resolution_at = unixepoch()
    WHERE id = ?
  `).run(row.id);
}

function insertRealizedOutcome(input: {
  sourceTable: string;
  sourceId: string;
  sourceKey: string;
  symbol: string | null;
  targetVariable: string;
  predictedDirection: ForecastDirection;
  actualDirection: ForecastDirection;
  probability: number;
  confidence: number;
  predictedValue: number | null;
  actualValue: number | null;
  resolvedCorrect: number;
}): void {
  db.prepare(`
    INSERT INTO realized_outcomes
      (id, outcome_type, source_table, source_id, source_key, agent_name, symbol, horizon, target_variable,
       predicted_direction, actual_direction, probability, confidence, predicted_value, actual_value,
       resolved_correct, hit, measured_at, created_at)
    VALUES
      (@id, @outcome_type, @source_table, @source_id, @source_key, @agent_name, @symbol, @horizon, @target_variable,
       @predicted_direction, @actual_direction, @probability, @confidence, @predicted_value, @actual_value,
       @resolved_correct, @hit, @measured_at, unixepoch())
  `).run({
    id: randomUUID(),
    outcome_type: 'forecast',
    source_table: input.sourceTable,
    source_id: input.sourceId,
    source_key: input.sourceKey,
    agent_name: input.sourceKey,
    symbol: normalizeSymbol(input.symbol),
    horizon: 'forecast',
    target_variable: input.targetVariable,
    predicted_direction: input.predictedDirection,
    actual_direction: input.actualDirection,
    probability: clamp(input.probability, 0, 1),
    confidence: clamp(input.confidence, 0, 1),
    predicted_value: input.predictedValue,
    actual_value: input.actualValue,
    resolved_correct: input.resolvedCorrect,
    hit: input.resolvedCorrect,
    measured_at: Math.floor(Date.now() / 1000),
  });
}

function resolveDirectionalOutcome(
  symbol: string | null,
  startAtSeconds: number,
  endAtSeconds: number,
  baselineValue: number | null,
): {
  baselineValue: number;
  actualValue: number;
  actualDirection: ForecastDirection;
} | null {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || normalized === 'MARKET') return null;
  const startDate = new Date(startAtSeconds * 1000).toISOString().slice(0, 10);
  const endDate = new Date(endAtSeconds * 1000).toISOString().slice(0, 10);
  const baselineRow = db.prepare(`
    SELECT close
    FROM price_history
    WHERE symbol = ? AND date >= ?
    ORDER BY date ASC
    LIMIT 1
  `).get(normalized, startDate) as any;
  const finalRow = db.prepare(`
    SELECT close
    FROM price_history
    WHERE symbol = ? AND date <= ?
    ORDER BY date DESC
    LIMIT 1
  `).get(normalized, endDate) as any;
  const startValue = baselineValue ?? baselineRow?.close ?? null;
  const endValue = finalRow?.close ?? null;
  if (startValue === null || endValue === null) return null;

  const change = (endValue - startValue) / startValue;
  const actualDirection: ForecastDirection = change > 0.01 ? 'up' : change < -0.01 ? 'down' : 'flat';
  return {
    baselineValue: startValue,
    actualValue: endValue,
    actualDirection,
  };
}

function getDecisionBatchById(id: string): any | null {
  const row = db.prepare(`SELECT * FROM decision_batches WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    symbol: row.symbol,
    action: row.action,
    stance: row.stance,
    confidence: row.confidence,
    score: row.score,
    disagreementPenalty: row.disagreement_penalty,
    freshnessScore: row.freshness_score,
    coverage: row.coverage,
    requiredCoverageMet: Boolean(row.required_coverage_met),
    macroRegime: row.macro_regime,
    decisionReason: row.decision_reason,
    heldOutReason: row.held_out_reason ?? null,
    contributions: parseJson(row.contributions, []),
    sourceThesisIds: parseJson(row.source_thesis_ids, []),
    sourceForecastIds: parseJson(row.source_forecast_ids, []),
    metadata: parseJson(row.metadata, {}),
    createdAt: toMs(row.created_at),
  };
}

function rowToLatestThesis(row: any): LatestThesisRecord {
  return {
    id: row.id,
    agentName: row.agent_name,
    sourceKey: row.source_key,
    symbol: row.symbol,
    stance: row.stance,
    confidence: row.confidence,
    horizon: row.horizon,
    catalyst: row.catalyst ?? null,
    invalidation: row.invalidation ?? null,
    thesis: row.thesis,
    freshnessScore: row.freshness_score,
    supportingObservationIds: parseJson(row.supporting_observation_ids, []),
    createdAt: toMs(row.created_at),
    expiresAt: row.expires_at ? row.expires_at * 1000 : null,
  };
}

function isFresh(expiresAt: number | null, now: number): boolean {
  return expiresAt === null || expiresAt > now;
}

function classifyCadence(deltaMs: number | null, cadenceMs: number): 'on_time' | 'late' | 'missed' | 'idle' {
  if (deltaMs === null || cadenceMs <= 0) return 'idle';
  if (deltaMs <= cadenceMs * 1.25) return 'on_time';
  if (deltaMs <= cadenceMs * 2.5) return 'late';
  return 'missed';
}

function classifyFreshness(deltaMs: number | null, ttlMs: number | null): 'fresh' | 'stale' | 'idle' {
  if (deltaMs === null) return 'idle';
  if (ttlMs === null) return 'fresh';
  return deltaMs <= ttlMs ? 'fresh' : 'stale';
}

function computeCalibrationWeight(hitRate: number | null, sampleSize: number | null): number {
  if (!sampleSize || sampleSize < 3 || hitRate === null) return 1;
  const centered = (hitRate - 0.5) * 2;
  return clamp(round(1 + centered * 0.5, 4), 0.6, 1.4);
}

function normalizeSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  return String(symbol).toUpperCase();
}

function toUnixSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.floor(value / 1000);
}

function toMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value * 1000;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function summarizeDetails(details: Record<string, any> | null | undefined): string | null {
  if (!details) return null;
  if (typeof details.summary === 'string') return details.summary;
  if (typeof details.title === 'string') return details.title;
  return null;
}

function clamp(value: number | null, min: number, max: number): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
