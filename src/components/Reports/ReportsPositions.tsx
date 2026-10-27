import { Cpu, Calendar } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { format } from "date-fns"
import type { EarningsEvent, FundamentalData } from "@/src/lib/api"
import type { Position } from "@/src/context/PaperTradingContext"

export function ReportsPositions({
  topSymbols,
  fundamentals,
  currentPrices,
  upcomingEarnings,
  positions,
}: {
  topSymbols: Array<[string, number]>
  fundamentals: Record<string, FundamentalData>
  currentPrices: Record<string, number>
  upcomingEarnings: EarningsEvent[]
  positions: Position[]
}) {
  return (
    <>
      {topSymbols.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4 text-zinc-400" />
              Most Traded Symbols
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topSymbols.map(([symbol, count]) => {
                const f = fundamentals[symbol]
                const currentPrice = currentPrices[symbol]
                return (
                  <div key={symbol} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-zinc-50 w-12">{symbol}</span>
                      {currentPrice && (
                        <span className="text-sm text-zinc-400 font-mono">${currentPrice.toFixed(2)}</span>
                      )}
                      {f?.peRatio && (
                        <span className="text-xs text-zinc-500">P/E {f.peRatio.toFixed(0)}</span>
                      )}
                      {f?.revenueGrowth !== null && f?.revenueGrowth !== undefined && (
                        <span className={cn(
                          "text-xs",
                          f.revenueGrowth >= 0.1 ? "text-emerald-400" : "text-zinc-500"
                        )}>
                          Rev {f.revenueGrowth >= 0 ? '+' : ''}{(f.revenueGrowth * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <Badge variant="secondary">{count} trades</Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-purple-400" />
            Earnings Calendar (next 30 days)
          </CardTitle>
          <CardDescription>
            BUY orders automatically blocked 1 day before earnings
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingEarnings.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No upcoming earnings data. Start the engine to load.</p>
          ) : (
            <div className="space-y-2">
              {upcomingEarnings.map((e) => {
                const f = fundamentals[e.symbol]
                const isHeld = positions.some(p => p.symbol === e.symbol)
                return (
                  <div key={e.symbol + e.earningsDate}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2",
                      e.daysUntil <= 3 ? "bg-amber-950/30 border border-amber-500/20" : "bg-zinc-900/40"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-zinc-50 w-12">{e.symbol}</span>
                      <span className="text-xs text-zinc-400">
                        {format(new Date(e.earningsDate), 'MMM d, yyyy')}
                      </span>
                      {isHeld && <Badge variant="warning" className="text-xs">held</Badge>}
                      {f?.epsTrailing && (
                        <span className="text-xs text-zinc-500">
                          Last EPS: ${f.epsTrailing.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.epsEstimate && (
                        <span className="text-xs text-zinc-400 font-mono">est. ${e.epsEstimate.toFixed(2)}</span>
                      )}
                      <Badge variant={e.daysUntil <= 1 ? "destructive" : e.daysUntil <= 7 ? "warning" : "secondary"}>
                        {e.daysUntil === 0 ? "Today" : e.daysUntil === 1 ? "Tomorrow" : `${e.daysUntil}d`}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
