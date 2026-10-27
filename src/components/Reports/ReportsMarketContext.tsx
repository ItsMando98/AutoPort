import { TrendingUp, BarChart3 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { cn } from "@/src/lib/utils"
import type { SectorPerformanceRow, WeeklySnapshot } from "@/src/lib/api"

const TREND_COLORS: Record<string, string> = {
  strong_inflow: 'text-emerald-400',
  inflow: 'text-emerald-300',
  neutral: 'text-zinc-400',
  outflow: 'text-red-300',
  strong_outflow: 'text-red-400',
}
const TREND_BG: Record<string, string> = {
  strong_inflow: 'bg-emerald-950/50 border-l-2 border-emerald-500',
  inflow: 'bg-emerald-950/20',
  neutral: '',
  outflow: 'bg-red-950/20',
  strong_outflow: 'bg-red-950/50 border-l-2 border-red-500',
}
const TREND_ARROWS: Record<string, string> = {
  strong_inflow: '↑↑', inflow: '↑', neutral: '→', outflow: '↓', strong_outflow: '↓↓',
}
const MULTIFRAME_COLORS: Record<string, string> = {
  confirmed_bull: 'text-emerald-400',
  bull_caution: 'text-amber-400',
  neutral: 'text-zinc-400',
  bear_caution: 'text-amber-400',
  confirmed_bear: 'text-red-400',
}

export function ReportsMarketContext({
  sectorData,
  weeklyData,
}: {
  sectorData: SectorPerformanceRow[]
  weeklyData: Record<string, WeeklySnapshot | null>
}) {
  return (
    <>
      {sectorData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-zinc-400" />
              Sector Rotation Heatmap
            </CardTitle>
            <CardDescription>Relative strength across sectors — drives confidence adjustments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              <div className="grid grid-cols-5 text-xs text-zinc-500 px-2 pb-1 border-b border-zinc-800">
                <span className="col-span-2">Sector</span>
                <span className="text-right">1W</span>
                <span className="text-right">1M</span>
                <span className="text-right">vs Mkt</span>
              </div>
              {sectorData.map(s => (
                <div key={s.sector} className={cn(
                  "grid grid-cols-5 items-center rounded px-2 py-1.5 text-sm",
                  TREND_BG[s.trend]
                )}>
                  <div className="col-span-2 flex items-center gap-2">
                    <span className={cn("font-medium text-xs", TREND_COLORS[s.trend])}>
                      {TREND_ARROWS[s.trend]}
                    </span>
                    <span className="text-zinc-200 text-xs">{s.sector}</span>
                  </div>
                  <span className={cn("text-right font-mono text-xs", s.return1w >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {s.return1w >= 0 ? '+' : ''}{s.return1w.toFixed(1)}%
                  </span>
                  <span className={cn("text-right font-mono text-xs", s.return1m >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {s.return1m >= 0 ? '+' : ''}{s.return1m.toFixed(1)}%
                  </span>
                  <span className={cn("text-right font-mono text-xs", s.relStrength >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {s.relStrength >= 0 ? '+' : ''}{s.relStrength.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {Object.keys(weeklyData).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              Multi-Timeframe Analysis (Weekly)
            </CardTitle>
            <CardDescription>Weekly RSI and trend context — reduces daily noise for the agent</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="grid grid-cols-5 text-xs text-zinc-500 px-2 pb-1 border-b border-zinc-800">
                <span>Symbol</span>
                <span className="text-right">W-RSI</span>
                <span className="text-center">Weekly</span>
                <span className="text-center">Multi-Frame</span>
                <span className="text-center">Confluence</span>
              </div>
              {Object.entries(weeklyData).map(([sym, snap]) => {
                if (!snap) return null
                const rsiColor = (snap.weeklyRSI ?? 50) < 35 ? 'text-emerald-400' : (snap.weeklyRSI ?? 50) > 68 ? 'text-red-400' : 'text-zinc-300'
                const trendArrow = snap.weeklyTrend === 'up' ? '↑' : snap.weeklyTrend === 'down' ? '↓' : '→'
                return (
                  <div key={sym} className="grid grid-cols-5 items-center rounded px-2 py-1 text-xs hover:bg-zinc-900/30">
                    <span className="font-bold text-zinc-50">{sym}</span>
                    <span className={cn("text-right font-mono", rsiColor)}>
                      {snap.weeklyRSI?.toFixed(0) ?? '—'}
                    </span>
                    <span className={cn(
                      "text-center",
                      snap.weeklyTrend === 'up' ? 'text-emerald-400' : snap.weeklyTrend === 'down' ? 'text-red-400' : 'text-zinc-400'
                    )}>
                      {trendArrow}
                    </span>
                    <span className={cn("text-center text-[10px]", MULTIFRAME_COLORS[snap.multiframeTrend] ?? 'text-zinc-400')}>
                      {snap.multiframeTrend?.replace(/_/g, ' ')}
                    </span>
                    <span className={cn(
                      "text-center",
                      snap.confluence === 'high' ? 'text-emerald-500' : snap.confluence === 'low' ? 'text-amber-400' : 'text-zinc-400'
                    )}>
                      {snap.confluence}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
