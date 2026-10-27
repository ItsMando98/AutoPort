import { getMarketSessionStatus, type MarketSessionStatus } from './marketclock.js';
import { getLiveRolloutProfile, type LiveRolloutProfile } from './rollout.js';

export type ExecutionSessionRegime = 'cash_open' | 'off_session_weekday' | 'weekend' | 'legacy';

export function deriveExecutionRolloutProfile(mode: string): LiveRolloutProfile {
  return mode === 'live' ? getLiveRolloutProfile() : 'paper';
}

export function getExecutionSessionRegime(now = new Date()): ExecutionSessionRegime {
  const market = getMarketSessionStatus(now);
  return deriveExecutionSessionRegime(market);
}

export function deriveExecutionSessionRegime(market: MarketSessionStatus): ExecutionSessionRegime {
  if (market.isOpen) return 'cash_open';
  if (market.isWeekday) return 'off_session_weekday';
  return 'weekend';
}
