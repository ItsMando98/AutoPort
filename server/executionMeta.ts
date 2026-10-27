export function getAutoResubmitCount(retryReason: string | null): number {
  const match = String(retryReason ?? '').match(/auto_resubmit:(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function buildAutoResubmitReason(retryReason: string | null): string {
  const count = getAutoResubmitCount(retryReason) + 1;
  const base = String(retryReason ?? '').replace(/auto_resubmit:\d+:?/, '') || 'recovery';
  return `auto_resubmit:${count}:${base}`;
}
