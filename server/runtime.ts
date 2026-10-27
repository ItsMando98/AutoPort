import { getBrokerMode } from './broker.js';
import { isKillSwitchEngaged } from './controls.js';
import { getReadinessStatus } from './readiness.js';

export type TradingMode = 'analysis' | 'paper' | 'live';

export function getTradingMode(): TradingMode {
  const configured = (process.env.TRADING_MODE ?? '').toLowerCase();
  if (configured === 'analysis') return 'analysis';
  return shouldUseBrokerExecution() && getBrokerMode() === 'live' ? 'live' : 'paper';
}

export function canExecuteTrades(): boolean {
  return getTradingMode() !== 'analysis' && !isKillSwitchEngaged();
}

export function shouldUseBrokerExecution(): boolean {
  const brokerMode = getBrokerMode();
  if (brokerMode === 'simulation') return false;
  if (brokerMode === 'paper') return true;
  return getReadinessStatus().liveExecutionAllowed;
}
