import { saveAgentObservations, saveSymbolTheses, type ThesisStance } from '../autonomy.js';
import { consolidate, consolidateAllIfNeeded } from '../knowledge.js';
import { getAllProfiles } from '../knowledge.js';
import { WATCHLIST } from '../technicals.js';
import { BaseAgent } from './base.js';

export class KnowledgeAgent extends BaseAgent {
  readonly name = 'knowledge';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'knowledge_consolidation';

  protected override get freshnessTtlMs(): number {
    return 7 * 24 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    await consolidateAllIfNeeded(WATCHLIST);
    publishKnowledgeOutputs();
    this.markSuccess(WATCHLIST.length, { scan: true });
  }

  async runForSymbol(symbol?: string): Promise<void> {
    if (symbol) {
      await consolidate(symbol.toUpperCase());
      publishKnowledgeOutputs();
      this.markSuccess(1, { symbol: symbol.toUpperCase() });
      return;
    }

    await this.run();
  }
}

function deriveStanceFromProfile(profile: { avg_confidence?: number | null }): ThesisStance {
  const avg = Number(profile.avg_confidence ?? 50);
  if (avg > 65) return 'BUY';
  if (avg < 45) return 'SELL';
  return 'HOLD';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function publishKnowledgeOutputs(now = Date.now()): void {
  const profiles = getAllProfiles();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  for (const [symbol, profile] of Object.entries(profiles)) {
    if (!profile) continue;
    // profile.updated_at is seconds (DB unixepoch()) — convert to ms for all timestamp fields
    const updatedAtMs = (profile.updated_at ?? 0) * 1000 || now;
    const observationIds = saveAgentObservations([{
      agentName: 'knowledge',
      sourceKey: 'knowledge_consolidation',
      symbol,
      topic: 'compound_memory',
      observationType: 'knowledge_profile',
      confidence: Math.min(Number(profile.avg_confidence ?? 50) / 100, 0.85),
      details: profile,
      observedAt: updatedAtMs,
      expiresAt,
    }]);

    const stance = deriveStanceFromProfile(profile);
    const confidence = clamp(Number(profile.avg_confidence ?? 50) / 100, 0.45, 0.82);
    saveSymbolTheses([{
      agentName: 'knowledge',
      sourceKey: 'knowledge_consolidation',
      symbol,
      stance,
      confidence,
      horizon: '1m',
      catalyst: 'compound_memory',
      invalidation: 'Profile refresh from materially different analyses.',
      thesis: `${symbol} compound memory: bull case ${profile.bull_thesis} Bear case ${profile.bear_thesis}`,
      supportingObservationIds: observationIds,
      freshnessScore: 0.65,
      createdAt: updatedAtMs,
      expiresAt,
    }]);
  }
}
