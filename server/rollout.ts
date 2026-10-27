import db from './db.js';
import { getBrokerMode } from './broker.js';
import { getSystemControls, setLiveRolloutProfile as setRolloutProfileControl } from './controls.js';

export type LiveRolloutProfile = 'paper' | 'limited_live' | 'full_live';

export interface RolloutPolicy {
  profile: LiveRolloutProfile;
  maxOrderValue: number;
  dailyNotionalLimit: number;
  maxFilledOrdersPerDay: number;
}

export interface LivePolicyDecision {
  allowed: boolean;
  reason: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  policy: RolloutPolicy;
}

export function getLiveRolloutProfile(): LiveRolloutProfile {
  const configured = getSystemControls().liveRolloutProfile;
  return configured === 'limited_live' || configured === 'full_live' ? configured : 'paper';
}

export function setLiveRolloutProfile(profile: LiveRolloutProfile): void {
  setRolloutProfileControl(profile);
}

export function getRolloutPolicy(profile = getLiveRolloutProfile()): RolloutPolicy {
  switch (profile) {
    case 'limited_live':
      return {
        profile,
        maxOrderValue: 5_000,
        dailyNotionalLimit: 15_000,
        maxFilledOrdersPerDay: 3,
      };
    case 'full_live':
      return {
        profile,
        maxOrderValue: 20_000,
        dailyNotionalLimit: 50_000,
        maxFilledOrdersPerDay: 10,
      };
    default:
      return {
        profile: 'paper',
        maxOrderValue: 0,
        dailyNotionalLimit: 0,
        maxFilledOrdersPerDay: 0,
      };
  }
}

export function evaluateLiveExecutionPolicy(input: {
  shares: number;
  price: number;
}): LivePolicyDecision {
  const policy = getRolloutPolicy();
  const orderValue = input.shares * input.price;
  const todayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const liveToday = db.prepare(`
    SELECT
      COUNT(*) AS fills,
      COALESCE(SUM(t.total_value), 0) AS notional
    FROM execution_attempts ea
    LEFT JOIN trades t ON t.execution_attempt_id = ea.id
    WHERE ea.mode = 'live'
      AND ea.status = 'filled'
      AND ea.updated_at >= ?
  `).get(todayStart) as { fills: number; notional: number };

  const checks = [
    {
      name: 'Rollout Profile',
      passed: policy.profile !== 'paper',
      detail: `Profile ${policy.profile}`,
    },
    {
      name: 'Per-Order Notional',
      passed: orderValue <= policy.maxOrderValue || policy.maxOrderValue === 0,
      detail: `$${orderValue.toFixed(0)} vs limit $${policy.maxOrderValue.toFixed(0)}`,
    },
    {
      name: 'Daily Live Notional',
      passed: liveToday.notional + orderValue <= policy.dailyNotionalLimit || policy.dailyNotionalLimit === 0,
      detail: `$${(liveToday.notional + orderValue).toFixed(0)} vs limit $${policy.dailyNotionalLimit.toFixed(0)}`,
    },
    {
      name: 'Daily Live Order Count',
      passed: liveToday.fills < policy.maxFilledOrdersPerDay || policy.maxFilledOrdersPerDay === 0,
      detail: `${liveToday.fills} vs limit ${policy.maxFilledOrdersPerDay}`,
    },
  ];

  const failed = checks.find(check => !check.passed);
  if (getBrokerMode() !== 'live') {
    return {
      allowed: true,
      reason: 'Broker is not in live mode.',
      checks,
      policy,
    };
  }

  if (failed) {
    return {
      allowed: false,
      reason: failed.detail,
      checks,
      policy,
    };
  }

  return {
    allowed: true,
    reason: `Allowed under autonomous ${policy.profile.replace(/_/g, ' ')} rollout policy.`,
    checks,
    policy,
  };
}
