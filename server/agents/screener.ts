import { saveAgentObservations, saveSymbolTheses } from '../autonomy.js';
import { runScreener } from '../screener.js';
import { BaseAgent } from './base.js';

export class ScreenerAgent extends BaseAgent {
  readonly name = 'screener';
  readonly intervalMs = 60 * 1000;
  readonly sourceKey = 'screener';

  private lastTriggerKey: string | null = null;

  protected override get freshnessTtlMs(): number {
    return 18 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    const triggerKey = getTriggerKey();
    if (!triggerKey || triggerKey === this.lastTriggerKey) {
      return;
    }

    const results = await runScreener();
    publishScreenerOutputs(results);
    this.lastTriggerKey = triggerKey;
    this.markSuccess(results.length, { triggerKey });
  }
}

function publishScreenerOutputs(results: any[], now = Date.now()): void {
  for (const row of results.slice(0, 15)) {
    const observationIds = saveAgentObservations([{
      agentName: 'screener',
      sourceKey: 'screener',
      symbol: row.symbol,
      topic: 'screen',
      observationType: 'screener_score',
      value: row.score,
      confidence: Math.min(0.55 + Number(row.score ?? 0) / 200, 0.85),
      details: row,
      observedAt: now,
      expiresAt: now + 18 * 60 * 60 * 1000,
    }]);

    const stance = Number(row.change_percent ?? 0) >= 0 ? 'BUY' : 'SELL';
    const confidence = Math.min(0.55 + Math.abs(Number(row.change_percent ?? 0)) / 25, 0.82);
    saveSymbolTheses([{
      agentName: 'screener',
      sourceKey: 'screener',
      symbol: row.symbol,
      stance,
      confidence,
      horizon: '2d',
      catalyst: 'technical_screen',
      invalidation: 'Momentum rank exits top cohort or reversal breaks setup.',
      thesis: `${row.symbol} ranks highly on the screener with score ${Number(row.score ?? 0).toFixed(1)} and ${Number(row.change_percent ?? 0).toFixed(1)}% move.`,
      supportingObservationIds: observationIds,
      freshnessScore: 0.72,
      createdAt: now,
      expiresAt: now + 18 * 60 * 60 * 1000,
    }]);
  }
}

function getTriggerKey(now = new Date()): string | null {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return null;

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes >= 570 && totalMinutes < 575) return `${date}:open`;
  if (totalMinutes >= 720 && totalMinutes < 725) return `${date}:midday`;
  if (totalMinutes >= 870 && totalMinutes < 875) return `${date}:midafternoon`;
  if (totalMinutes >= 960 && totalMinutes < 965) return `${date}:close`;
  return null;
}
