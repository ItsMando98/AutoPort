import {
  saveAgentObservations,
  saveSymbolTheses,
} from '../autonomy.js';
import { getSignificantChanges, refreshAllHedgeFundHoldings } from '../hedgeFund.js';
import { BaseAgent } from './base.js';

export class HedgeFundAgent extends BaseAgent {
  readonly name = 'hedge_fund';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'hedge_fund_13f';

  protected override get freshnessTtlMs(): number {
    return 120 * 24 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    const result = await refreshAllHedgeFundHoldings();
    publishHedgeFundOutputs();
    if (result.errors > 0) {
      this.markFailure(`${result.errors} managers failed`, result);
      return;
    }
    this.markSuccess(result.processed, result);
  }
}

function publishHedgeFundOutputs(now = Date.now()): void {
  const changes = getSignificantChanges(undefined, 200);
  const latestBySymbol = new Map<string, any[]>();
  for (const row of changes) {
    if (!row.ticker) continue;
    const bucket = latestBySymbol.get(row.ticker) ?? [];
    bucket.push(row);
    latestBySymbol.set(row.ticker, bucket);
  }

  for (const [symbol, rows] of latestBySymbol.entries()) {
    const currentQuarterRows = rows.slice(0, 5);
    const bullish = currentQuarterRows.filter(row => row.change_type === 'new' || row.change_type === 'added').length;
    const bearish = currentQuarterRows.filter(row => row.change_type === 'reduced' || row.change_type === 'exited').length;
    const stance = bullish > bearish ? 'BUY' : bearish > bullish ? 'SELL' : 'HOLD';
    const confidence = Math.min(0.55 + currentQuarterRows.length * 0.08, 0.9);
    const thesisTime = Date.parse(`${currentQuarterRows[0]?.period_of_report ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`) || now;
    const observationIds = saveAgentObservations(currentQuarterRows.map(row => ({
      agentName: 'hedge_fund',
      sourceKey: 'hedge_fund_13f',
      symbol,
      topic: row.manager_name ?? row.manager_id,
      observationType: row.change_type,
      value: row.pct_change,
      confidence,
      details: row,
      observedAt: thesisTime,
      expiresAt: thesisTime + 120 * 24 * 60 * 60 * 1000,
    })));

    if (stance === 'HOLD') continue;

    const summary = currentQuarterRows
      .slice(0, 3)
      .map(row => `${row.manager_name ?? row.manager_id} ${row.change_type}`)
      .join(', ');

    saveSymbolTheses([{
      agentName: 'hedge_fund',
      sourceKey: 'hedge_fund_13f',
      symbol,
      stance,
      confidence,
      horizon: '1q',
      catalyst: 'institutional_positioning',
      invalidation: 'Next 13F quarter reverses the move or crowding fades.',
      thesis: `${symbol} has ${stance === 'BUY' ? 'accumulation' : 'distribution'} across tracked hedge funds: ${summary}.`,
      supportingObservationIds: observationIds,
      freshnessScore: 0.7,
      createdAt: thesisTime,
      expiresAt: thesisTime + 120 * 24 * 60 * 60 * 1000,
    }]);
  }
}
