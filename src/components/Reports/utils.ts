export function actionVariant(action?: 'BUY' | 'SELL' | 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | null) {
  if (action === 'BUY' || action === 'ADD') return 'success' as const
  if (action === 'SELL' || action === 'TRIM' || action === 'EXIT') return 'destructive' as const
  return 'secondary' as const
}

/**
 * Polls `fetchFn` until `hasChanged` reports the data actually updated, instead
 * of blindly waiting a guessed fixed duration. The backend trigger endpoints
 * (screener run, knowledge consolidation) respond immediately and do the work
 * async with no job-status endpoint, so this is the closest thing to a real
 * completion signal available.
 */
export async function pollUntilChanged<T>(
  fetchFn: () => Promise<T>,
  hasChanged: (result: T) => boolean,
  { intervalMs = 1500, timeoutMs = 20000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let result = await fetchFn()
  while (!hasChanged(result) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    result = await fetchFn()
  }
  return result
}
