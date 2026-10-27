import { randomUUID } from 'crypto';
import db from './db.js';
import {
  getAgentCalibrationWeights,
  getLatestSymbolTheses,
  saveDecisionBatch,
  type DecisionContribution,
  type LatestThesisRecord,
  type PortfolioIntentAction,
  type ThesisStance,
} from './autonomy.js';
import type { MacroRegime } from './macro.js';
import { getState } from './portfolio.js';
import { getSignalThreshold } from './research.js';

interface CommitteeOptions {
  macroRegime: MacroRegime;
  now?: number;
}

export interface CommitteeDecision {
  decisionBatchId: string;
  candidateId: string;
  symbol: string;
  action: PortfolioIntentAction;
  stance: ThesisStance;
  confidence: number;
  score: number;
  coverage: number;
  requiredCoverageMet: boolean;
  disagreementPenalty: number;
  freshnessScore: number;
  reasoning: string;
  heldOutReason: string | null;
  thesisIds: string[];
}

const CRITICAL_SOURCES = new Set(['research_ingestion', 'macro_fred', 'sentiment_options']);
const MEGA_CAP_TECH_CLUSTER = new Set(['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA']);

export function buildCommitteeDecisions(options: CommitteeOptions): CommitteeDecision[] {
  const now = options.now ?? Date.now();
  const theses = getLatestSymbolTheses({ onlyFresh: true, limit: 2000, includeThemeSources: false });
  const grouped = new Map<string, LatestThesisRecord[]>();
  for (const thesis of theses) {
    if (thesis.symbol === 'MARKET') continue;
    const bucket = grouped.get(thesis.symbol) ?? [];
    bucket.push(thesis);
    grouped.set(thesis.symbol, bucket);
  }

  const calibrationWeights = getAgentCalibrationWeights();
  const decisions: CommitteeDecision[] = [];
  for (const [symbol, symbolTheses] of grouped.entries()) {
    const decision = buildDecisionForSymbol(symbol, symbolTheses, options.macroRegime, calibrationWeights, now);
    decisions.push(decision);
    upsertSignalCandidateFromDecision(decision);
  }

  return decisions.sort((a, b) => b.confidence - a.confidence || Math.abs(b.score) - Math.abs(a.score));
}

export function getBestActionableCommitteeDecision(options: CommitteeOptions): CommitteeDecision | null {
  const decisions = buildCommitteeDecisions(options);
  return decisions.find(decision => decision.action !== 'HOLD') ?? null;
}

// Rebalancing/position-drift notes the coordinator posts about its own book
// (sourceKey 'agent') are portfolio hygiene, not independent research. Voting
// them into the same pool as research/macro/sentiment theses lets the
// coordinator's own rebalance note veto a high-conviction external signal via
// the disagreement penalty — a self-inflicted gridlock rather than genuine
// cross-agent disagreement. They're tracked separately and surfaced in the
// reasoning, but excluded from scoring, coverage, and disagreement.
const SELF_REFERENTIAL_SOURCES = new Set(['agent']);

function buildDecisionForSymbol(
  symbol: string,
  theses: LatestThesisRecord[],
  macroRegime: MacroRegime,
  calibrationWeights: ReturnType<typeof getAgentCalibrationWeights>,
  now: number,
): CommitteeDecision {
  const freshTheses = theses.filter(thesis => thesis.expiresAt === null || thesis.expiresAt > now);
  const votingTheses = freshTheses.filter(thesis => !SELF_REFERENTIAL_SOURCES.has(thesis.sourceKey));
  const rebalanceNotes = freshTheses.filter(thesis => SELF_REFERENTIAL_SOURCES.has(thesis.sourceKey));
  const contributions: DecisionContribution[] = votingTheses.map(thesis => {
    const calibration = calibrationWeights.get(thesis.sourceKey);
    const freshness = clamp(computeFreshness(thesis, now), 0, 1);
    const weight = clamp((calibration?.weight ?? 1) * freshness, 0.4, 1.5);
    const stanceScore = thesis.stance === 'BUY' ? 1 : thesis.stance === 'SELL' ? -1 : 0;
    const weightedScore = stanceScore * thesis.confidence * weight;
    return {
      agentName: thesis.agentName,
      sourceKey: thesis.sourceKey,
      symbol,
      stance: thesis.stance,
      confidence: thesis.confidence,
      weight,
      weightedScore,
      freshnessScore: freshness,
      thesisId: thesis.id,
      thesis: thesis.thesis,
    };
  });

  // Mega-cap tech cluster concentration penalty
  // If portfolio already holds 2+ symbols from the cluster and this is a BUY, reduce committee score
  const netSupport0 = contributions.reduce((sum, item) => sum + item.weightedScore, 0);
  const isBuySignal = netSupport0 > 0;
  if (isBuySignal && MEGA_CAP_TECH_CLUSTER.has(symbol)) {
    const portfolio = getState();
    const heldClusterCount = portfolio.positions.filter(p => MEGA_CAP_TECH_CLUSTER.has(p.symbol) && p.symbol !== symbol).length;
    if (heldClusterCount >= 2) {
      for (const contribution of contributions) {
        (contribution as any).weightedScore = contribution.weightedScore * 0.6;
        (contribution as any).weight = contribution.weight * 0.6;
      }
    }
  }

  const coverage = contributions.length;
  const coveredSources = new Set(contributions.map(contribution => contribution.sourceKey));
  const missingCritical = [...CRITICAL_SOURCES].filter(sourceKey => !coveredSources.has(sourceKey));
  // research_ingestion only fires when a symbol has fresh news, so most
  // symbols will never see all three CRITICAL_SOURCES at once — requiring
  // every one of them (plus coverage >= 3) meant almost every symbol was
  // permanently held out as a "coverage gap" regardless of signal quality.
  // Two independent agents with at least one critical source is enough
  // cross-confirmation to act on.
  const hasCriticalSource = missingCritical.length < CRITICAL_SOURCES.size;
  const requiredCoverageMet = coverage >= 2 && hasCriticalSource;
  const grossSupport = contributions.reduce((sum, item) => sum + Math.abs(item.weightedScore), 0);
  const netSupport = contributions.reduce((sum, item) => sum + item.weightedScore, 0);
  // grossSupport === 0 means every agent said HOLD — there's no directional
  // conviction to disagree about. Treating that as maximum disagreement
  // mislabels "no signal" as "agents fighting", and needlessly trips the
  // disagreement veto below instead of falling through to the (equally
  // correct, but more honest) "score below threshold" reason.
  const disagreementPenalty = grossSupport === 0 ? 0 : round(1 - Math.abs(netSupport) / grossSupport, 4);
  const freshnessScore = coverage === 0
    ? 0
    : round(contributions.reduce((sum, item) => sum + item.freshnessScore, 0) / coverage, 4);

  const macroPenalty = getMacroPenalty(macroRegime, netSupport);
  const baseScore = netSupport * (1 - disagreementPenalty * 0.65) * freshnessScore * macroPenalty;
  const signalThreshold = getSignalThreshold(macroRegime);
  const normalizedScore = round(baseScore * 25, 4);
  const absoluteScore = Math.abs(normalizedScore);

  let stance: ThesisStance = normalizedScore > 0 ? 'BUY' : normalizedScore < 0 ? 'SELL' : 'HOLD';
  let action: PortfolioIntentAction = 'HOLD';
  let heldOutReason: string | null = null;

  if (!requiredCoverageMet) {
    stance = 'HOLD';
    heldOutReason = `Coverage gap: missing ${missingCritical.join(', ') || 'cross-agent confirmation'}.`;
  } else if (disagreementPenalty >= 0.85) {
    // The base score already dampens by disagreementPenalty * 0.65, so a
    // moderate split among agents naturally shrinks below threshold on its
    // own. This hard veto now only catches near-total gridlock (agents
    // essentially split down the middle), instead of blocking every trade
    // that has any dissent at all.
    stance = 'HOLD';
    heldOutReason = `Agent disagreement penalty ${disagreementPenalty.toFixed(2)} is too high.`;
  } else if (absoluteScore < signalThreshold) {
    stance = 'HOLD';
    heldOutReason = `Committee score ${absoluteScore.toFixed(1)} is below ${macroRegime} threshold ${signalThreshold}.`;
  }

  const confidence = stance === 'HOLD'
    ? clamp(0.35 + freshnessScore * 0.2, 0, 0.65)
    : clamp(absoluteScore / Math.max(signalThreshold * 1.6, 1), 0, 0.95);
  action = derivePortfolioIntent(symbol, stance, confidence);

  if (stance === 'HOLD') {
    action = 'HOLD';
  }

  const decisionReason = buildDecisionReason({
    symbol,
    stance,
    macroRegime,
    contributions,
    missingCritical,
    absoluteScore,
    signalThreshold,
    disagreementPenalty,
    heldOutReason,
    rebalanceNotes,
  });

  const decisionBatchId = saveDecisionBatch({
    symbol,
    action,
    stance,
    confidence,
    score: normalizedScore,
    disagreementPenalty,
    freshnessScore,
    coverage,
    requiredCoverageMet,
    macroRegime,
    decisionReason,
    heldOutReason,
    contributions,
    sourceThesisIds: freshTheses.map(thesis => thesis.id),
    metadata: {
      coveredSources: [...coveredSources],
      missingCritical,
      rebalanceNoteIds: rebalanceNotes.map(thesis => thesis.id),
      generatedAt: now,
    },
  });

  const candidateId = randomUUID();
  return {
    decisionBatchId,
    candidateId,
    symbol,
    action,
    stance,
    confidence: round(confidence, 4),
    score: normalizedScore,
    coverage,
    requiredCoverageMet,
    disagreementPenalty,
    freshnessScore,
    reasoning: decisionReason,
    heldOutReason,
    thesisIds: freshTheses.map(thesis => thesis.id),
  };
}

function derivePortfolioIntent(symbol: string, stance: ThesisStance, confidence: number): PortfolioIntentAction {
  const position = getState().positions.find(entry => entry.symbol === symbol);
  if (stance === 'BUY') {
    if (!position) return 'BUY';
    return position.shares < 0 ? 'BUY' : 'ADD';
  }
  if (stance === 'SELL') {
    if (!position) return 'SELL';
    if (position.shares < 0) return 'SELL';
    return confidence >= 0.8 ? 'EXIT' : 'TRIM';
  }
  return position ? 'HOLD' : 'HOLD';
}

function buildDecisionReason(input: {
  symbol: string;
  stance: ThesisStance;
  macroRegime: MacroRegime;
  contributions: DecisionContribution[];
  missingCritical: string[];
  absoluteScore: number;
  signalThreshold: number;
  disagreementPenalty: number;
  heldOutReason: string | null;
  rebalanceNotes: LatestThesisRecord[];
}): string {
  const topDrivers = input.contributions
    .filter(item => item.weightedScore !== 0)
    .sort((a, b) => Math.abs(b.weightedScore) - Math.abs(a.weightedScore))
    .slice(0, 4)
    .map(item => `${item.agentName}:${item.stance} ${(item.confidence * 100).toFixed(0)}%`);

  const basis = topDrivers.length > 0
    ? `Drivers ${topDrivers.join(', ')}`
    : 'No directional theses available';

  const rebalanceNote = input.rebalanceNotes.length > 0
    ? ` Portfolio note (informational, not voted): ${input.rebalanceNotes[0].thesis}`
    : '';

  if (input.heldOutReason) {
    return `${basis}. ${input.heldOutReason} Macro regime ${input.macroRegime}.${rebalanceNote}`;
  }

  return `${basis}. Committee ${input.stance} with score ${input.absoluteScore.toFixed(1)} vs threshold ${input.signalThreshold} in ${input.macroRegime} regime and disagreement penalty ${input.disagreementPenalty.toFixed(2)}.${rebalanceNote}`;
}

function getMacroPenalty(macroRegime: MacroRegime, netSupport: number): number {
  if (macroRegime === 'bear' && netSupport > 0) return 0.7;
  if (macroRegime === 'bull' && netSupport < 0) return 0.9;
  return 1;
}

function computeFreshness(thesis: LatestThesisRecord, now: number): number {
  if (!thesis.expiresAt) return thesis.freshnessScore;
  const lifespan = Math.max(thesis.expiresAt - thesis.createdAt, 1);
  const remaining = Math.max(thesis.expiresAt - now, 0);
  const ratio = remaining / lifespan;
  return thesis.freshnessScore * ratio;
}

function upsertSignalCandidateFromDecision(decision: CommitteeDecision): void {
  if (decision.action === 'HOLD') {
    db.prepare(`
      UPDATE signal_candidates
      SET status = 'stale',
          decision_batch_id = @decision_batch_id,
          decision_action = 'HOLD',
          reasoning = @reasoning,
          updated_at = unixepoch()
      WHERE symbol = @symbol
        AND status IN ('new', 'pending_approval', 'blocked', 'in_flight')
    `).run({
      symbol: decision.symbol,
      decision_batch_id: decision.decisionBatchId,
      reasoning: decision.reasoning,
    });
    return;
  }

  const existing = db.prepare(`
    SELECT id
    FROM signal_candidates
    WHERE symbol = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(decision.symbol) as any;
  const id = existing?.id ?? decision.candidateId;
  const action = decision.stance === 'HOLD'
    ? 'HOLD'
    : decision.stance === 'BUY'
      ? 'BUY'
      : 'SELL';

  db.prepare(`
    INSERT INTO signal_candidates
      (id, symbol, action, score, confidence, status, reasoning, source_event_ids, factor_breakdown,
       decision_batch_id, decision_action, created_at, updated_at)
    VALUES
      (@id, @symbol, @action, @score, @confidence, 'new', @reasoning, @source_event_ids, @factor_breakdown,
       @decision_batch_id, @decision_action, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      action = excluded.action,
      score = excluded.score,
      confidence = excluded.confidence,
      status = excluded.status,
      reasoning = excluded.reasoning,
      source_event_ids = excluded.source_event_ids,
      factor_breakdown = excluded.factor_breakdown,
      decision_batch_id = excluded.decision_batch_id,
      decision_action = excluded.decision_action,
      updated_at = unixepoch()
  `).run({
    id,
    symbol: decision.symbol,
    action,
    score: decision.score,
    confidence: Math.round(decision.confidence * 100),
    reasoning: decision.reasoning,
    source_event_ids: JSON.stringify([]),
    factor_breakdown: JSON.stringify({
      committeeScore: decision.score,
      disagreementPenalty: decision.disagreementPenalty,
      freshnessScore: decision.freshnessScore,
      coverage: decision.coverage,
    }),
    decision_batch_id: decision.decisionBatchId,
    decision_action: decision.action,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
