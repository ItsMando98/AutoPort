import db from './db.js';

export interface SystemControls {
  killSwitchEngaged: boolean;
  liveTradingEnabled: boolean;
  liveRolloutProfile: 'paper' | 'limited_live' | 'full_live';
  updatedAt: number | null;
}

export function getSystemControls(): SystemControls {
  const rows = db.prepare(`
    SELECT control_key, control_value, updated_at
    FROM system_controls
    WHERE control_key IN ('kill_switch_engaged', 'live_trading_enabled', 'live_rollout_profile')
  `).all() as Array<{ control_key: string; control_value: string; updated_at: number }>;

  const mapped = rows.reduce((acc, row) => {
    acc[row.control_key] = row;
    return acc;
  }, {} as Record<string, { control_value: string; updated_at: number }>);

  return {
    killSwitchEngaged: mapped.kill_switch_engaged?.control_value === 'true',
    liveTradingEnabled: mapped.live_trading_enabled?.control_value === 'true',
    liveRolloutProfile: mapped.live_rollout_profile?.control_value === 'limited_live'
      ? 'limited_live'
      : mapped.live_rollout_profile?.control_value === 'full_live'
        ? 'full_live'
        : 'paper',
    updatedAt: Math.max(
      mapped.kill_switch_engaged?.updated_at ?? 0,
      mapped.live_trading_enabled?.updated_at ?? 0,
      mapped.live_rollout_profile?.updated_at ?? 0,
    ) || null,
  };
}

export function isKillSwitchEngaged(): boolean {
  return getSystemControls().killSwitchEngaged;
}

export function setKillSwitchEngaged(engaged: boolean): void {
  setControlValue('kill_switch_engaged', engaged ? 'true' : 'false');
}

export function setLiveTradingEnabled(enabled: boolean): void {
  setControlValue('live_trading_enabled', enabled ? 'true' : 'false');
}

export function setLiveRolloutProfile(profile: 'paper' | 'limited_live' | 'full_live'): void {
  setControlValue('live_rollout_profile', profile);
}

function setControlValue(key: string, value: string): void {
  db.prepare(`
    INSERT INTO system_controls (control_key, control_value, updated_at)
    VALUES (@control_key, @control_value, unixepoch())
    ON CONFLICT(control_key) DO UPDATE SET
      control_value = excluded.control_value,
      updated_at = unixepoch()
  `).run({
    control_key: key,
    control_value: value,
  });
}
