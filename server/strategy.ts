import type { MacroRegime } from './macro.js';

export interface CandidateCompositionInput {
  symbol: string;
  factors: Record<string, number>;
  notes: string[];
  sourceEventIds: string[];
}

export interface CandidateComposition {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  confidence: number;
  reasoning: string;
  sourceEventIds: string[];
  factorBreakdown: Record<string, number>;
}

export interface OrderPlan {
  shares: number;
  targetWeight: number;
  baseTargetWeight: number;
  adjustedTargetWeight: number;
  executionFeedbackBand: string | null;
  executionFeedbackReason: string | null;
  intent: 'target_weight' | 'reduce' | 'close';
}

export interface PortfolioConstructionAdjustment {
  targetWeightMultiplier?: number;
  executionFeedbackBand?: string | null;
  executionFeedbackReason?: string | null;
  atrPct?: number;
}

export function composeSignalCandidate(input: CandidateCompositionInput): CandidateComposition {
  const score = Object.values(input.factors).reduce((sum, value) => sum + value, 0);
  const action: CandidateComposition['action'] =
    score >= 18 ? 'BUY' :
    score <= -18 ? 'SELL' :
    'HOLD';
  const confidence = clamp(Math.round(Math.abs(score) * 2.2), 0, 100);

  return {
    symbol: input.symbol,
    action,
    score,
    confidence,
    reasoning: input.notes.join('. '),
    sourceEventIds: input.sourceEventIds,
    factorBreakdown: input.factors,
  };
}

export function determineOrderPlan(
  action: 'BUY' | 'SELL',
  confidence: number,
  symbol: string,
  price: number,
  portfolio: { cash: number; positions: Array<{ symbol: string; shares: number }> },
  totalValue: number,
  adjustment: PortfolioConstructionAdjustment = {},
  macroRegime: MacroRegime = 'neutral',
): OrderPlan {
  const existing = portfolio.positions.find(position => position.symbol === symbol);
  const currentShares = existing?.shares ?? 0;

  if (action === 'BUY') {
    if (currentShares < 0) {
      const shouldClose = confidence >= 85;
      return {
        shares: shouldClose ? Math.abs(currentShares) : Math.max(1, Math.ceil(Math.abs(currentShares) * 0.5)),
        targetWeight: 0,
        baseTargetWeight: 0,
        adjustedTargetWeight: 0,
        executionFeedbackBand: null,
        executionFeedbackReason: null,
        intent: shouldClose ? 'close' : 'reduce',
      };
    }

    const baseTargetWeight = deriveBaseTargetWeight(action, confidence, macroRegime, adjustment.atrPct);
    const targetWeightMultiplier = clamp(adjustment.targetWeightMultiplier ?? 1, 0, 1);
    const adjustedTargetWeight = clamp(round(baseTargetWeight * targetWeightMultiplier, 4), 0, baseTargetWeight);
    const currentValue = Math.max(currentShares, 0) * price;
    const targetValue = totalValue * adjustedTargetWeight;
    const additionalValue = Math.max(0, targetValue - currentValue);
    return {
      shares: Math.floor(Math.min(additionalValue, portfolio.cash) / price),
      targetWeight: adjustedTargetWeight,
      baseTargetWeight,
      adjustedTargetWeight,
      executionFeedbackBand: adjustment.executionFeedbackBand ?? null,
      executionFeedbackReason: adjustment.executionFeedbackReason ?? null,
      intent: 'target_weight',
    };
  }

  if (currentShares > 0) {
    const shouldClose = confidence >= 85;
    return {
      shares: shouldClose ? currentShares : Math.max(1, Math.ceil(currentShares * 0.5)),
      targetWeight: 0,
      baseTargetWeight: 0,
      adjustedTargetWeight: 0,
      executionFeedbackBand: null,
      executionFeedbackReason: null,
      intent: shouldClose ? 'close' : 'reduce',
    };
  }

  const baseTargetWeight = deriveBaseTargetWeight(action, confidence, macroRegime, adjustment.atrPct);
  const targetWeightMultiplier = clamp(adjustment.targetWeightMultiplier ?? 1, 0, 1);
  const adjustedTargetWeight = clamp(round(baseTargetWeight * targetWeightMultiplier, 4), 0, baseTargetWeight);
  const currentShortValue = Math.abs(Math.min(currentShares, 0)) * price;
  const targetShortValue = totalValue * adjustedTargetWeight;
  const additionalShortValue = Math.max(0, targetShortValue - currentShortValue);
  return {
    shares: Math.floor(additionalShortValue / price),
    targetWeight: -adjustedTargetWeight,
    baseTargetWeight: -baseTargetWeight,
    adjustedTargetWeight: -adjustedTargetWeight,
    executionFeedbackBand: adjustment.executionFeedbackBand ?? null,
    executionFeedbackReason: adjustment.executionFeedbackReason ?? null,
    intent: 'target_weight',
  };
}

export function deriveBaseTargetWeight(
  action: 'BUY' | 'SELL',
  confidence: number,
  macroRegime: MacroRegime = 'neutral',
  atrPct?: number,
): number {
  const baseWeight = clamp(confidence >= 85 ? 0.15 : confidence >= 70 ? 0.12 : 0.08, 0.05, 0.15);
  const regimeMultiplier = macroRegime === 'bear' ? 0.65 : macroRegime === 'neutral' ? 0.85 : 1.0;
  const volatilityMultiplier = atrPct !== undefined && atrPct > 0
    ? atrPct > 0.04 ? 0.70 : atrPct > 0.025 ? 0.85 : 1.0
    : 1.0;
  return clamp(round(baseWeight * regimeMultiplier * volatilityMultiplier, 4), 0.04, 0.15);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
