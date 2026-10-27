import { useState } from "react"
import { BarChart3, Target, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { format } from "date-fns"
import { api, type ScreenerResultRow } from "@/src/lib/api"
import { pollUntilChanged } from "./utils"

export function ReportsScreener({
  results,
  onResults,
}: {
  results: ScreenerResultRow[]
  onResults: (results: ScreenerResultRow[]) => void
}) {
  const [screeningNow, setScreeningNow] = useState(false)

  const handleRunScreener = async () => {
    setScreeningNow(true)
    const beforeTimestamp = results[0]?.screenedAt ?? 0
    await api.runScreener()
    const fresh = await pollUntilChanged(
      () => api.getScreenerResults(),
      rows => rows.length > 0 && (rows[0]?.screenedAt ?? 0) > beforeTimestamp,
      { intervalMs: 1500, timeoutMs: 20000 }
    )
    onResults(fresh ?? [])
    setScreeningNow(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-emerald-400" />
              Daily Screener — Top Candidates
            </CardTitle>
            <CardDescription>
              {results.length > 0
                ? `${results.length} candidates from ~75 universe stocks — updated ${results[0]?.screenedAt ? format(new Date(results[0].screenedAt), 'HH:mm') : 'today'}`
                : 'Scans 75+ stocks for unusual volume, price action, and RSI extremes'
              }
            </CardDescription>
          </div>
          <button
            onClick={handleRunScreener}
            disabled={screeningNow}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", screeningNow && "animate-spin")} />
            {screeningNow ? "Scanning..." : "Run Screen"}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <BarChart3 className="h-8 w-8 text-zinc-700 mx-auto" />
            <p className="text-sm text-zinc-400">No screener results yet</p>
            <p className="text-xs text-zinc-500">Click "Run Screen" or wait for the 6:30 AM daily run</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {results.map(c => (
              <div key={c.symbol} className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-sm",
                c.isCore ? "bg-zinc-800/60" : "bg-zinc-900/40"
              )}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-bold text-zinc-50 w-12">{c.symbol}</span>
                  <span className="text-zinc-500 text-xs hidden sm:block">{c.sector}</span>
                  <span className={cn(
                    "font-mono text-xs",
                    c.changePercent >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {c.changePercent >= 0 ? '+' : ''}{c.changePercent.toFixed(1)}%
                  </span>
                  {c.volumeRatio >= 1.5 && (
                    <span className="text-amber-400 text-xs">{c.volumeRatio.toFixed(1)}x vol</span>
                  )}
                  <span className="text-zinc-500 text-xs truncate hidden md:block">
                    {c.signals?.[0] ?? ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.rsi14 && (
                    <span className={cn(
                      "text-xs font-mono",
                      c.rsi14 <= 35 ? "text-emerald-400" : c.rsi14 >= 68 ? "text-red-400" : "text-zinc-400"
                    )}>
                      RSI {c.rsi14.toFixed(0)}
                    </span>
                  )}
                  <Badge variant={c.score >= 50 ? "success" : c.score >= 25 ? "warning" : "secondary"} className="text-xs">
                    {c.score.toFixed(0)}pts
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
