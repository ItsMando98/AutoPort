import { BrainCircuit, Shield } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import type { OverviewStats } from "@/src/lib/api"

export function ReportsEngineAndRisk({
  overview,
  aiActivity,
  cycleCount,
  agentMode,
  agentDegraded,
  riskSummary,
  drawdown,
  cashBalance,
  totalValue,
}: {
  overview: OverviewStats | null
  aiActivity: { hypotheses: number; decisions: number; rejected: number; executed: number }
  cycleCount: number
  agentMode: string
  agentDegraded: boolean
  riskSummary: { total: number; blocked: number; passed: number; byCheck: Array<[string, number]> }
  drawdown: number
  cashBalance: number
  totalValue: number
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-blue-400" />
            AI Engine Activity
          </CardTitle>
          <CardDescription>
            {cycleCount} cycles · {agentMode} mode · {agentDegraded ? 'degraded' : 'stable'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Articles Analyzed", value: overview?.processedArticles ?? aiActivity.hypotheses, color: "bg-blue-500" },
            { label: "Signals Generated", value: aiActivity.decisions + aiActivity.rejected, color: "bg-purple-500" },
            { label: "Trades Executed", value: aiActivity.executed, color: "bg-emerald-500" },
            { label: "Signals Rejected", value: aiActivity.rejected, color: "bg-amber-500" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("h-2 w-2 rounded-full", color)} />
                <span className="text-sm text-zinc-300">{label}</span>
              </div>
              <span className="text-sm font-mono font-medium text-zinc-50">{value}</span>
            </div>
          ))}

          {overview && (
            <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
              <p className="text-xs text-zinc-500 mb-2">Lifetime (database)</p>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Total articles seen</span>
                <span className="text-zinc-300 font-mono">{overview.totalArticles}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Total analyses stored</span>
                <span className="text-zinc-300 font-mono">{overview.totalAnalyses}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Total trades in DB</span>
                <span className="text-zinc-300 font-mono">{overview.totalTrades}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-amber-400" />
            Risk Engine Summary
          </CardTitle>
          <CardDescription>
            {riskSummary.passed} passed / {riskSummary.blocked} blocked
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {riskSummary.byCheck.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">
              No risk blocks yet — engine hasn't executed trades.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500 mb-2">Most frequent block reasons:</p>
              {riskSummary.byCheck.map(([check, count]) => (
                <div key={check} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300 truncate">{check}</span>
                  <Badge variant="warning" className="text-xs ml-2 shrink-0">{count}x blocked</Badge>
                </div>
              ))}
            </>
          )}

          <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
            <p className="text-xs text-zinc-500 mb-2">Current risk state</p>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Drawdown from start</span>
              <span className={cn("font-mono", drawdown < -5 ? "text-red-400" : "text-zinc-300")}>
                {drawdown.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Cash reserve</span>
              <span className="text-zinc-300 font-mono">
                {totalValue > 0 ? ((cashBalance / totalValue) * 100).toFixed(1) : '100.0'}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
