import { ArrowUpRight, ArrowDownRight, Zap, TrendingUp as TrendUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DailyReport } from "@/src/lib/api"
import { actionVariant } from "./utils"

// `DailyReport.metrics` is untyped upstream (backend doesn't expose a fixed
// shape for it), so these two sections define their own minimal shape based
// on the fields they actually read.
interface SourceAttributionRow {
  key: string
  trades: number
  winRate: number | null
  realizedPnl: number
}

interface ExecutionQualitySummary {
  totalFillOutcomes: number
  resubmittedOutcomes: number
  avgLatencySeconds: number | null
  avgAbsSlippageBps: number | null
  firstPassAvgAbsSlippageBps: number | null
  resubmitAvgAbsSlippageBps: number | null
  worstCases: Array<{
    id: string
    symbol: string
    action: string
    status: string
    retryCount: number
    latencySeconds: number | null
    absSlippageBps: number | null
    filledShares: number | null
    plannedShares: number | null
  }>
}

type DecisionTrailRow = DailyReport['decisionTrail'][number]
type BlockedDecisionRow = DailyReport['blockedDecisions'][number]

export function ReportsDecisionTrail({
  decisionTrail,
  blockedDecisions,
  topBlockReasons,
  sourceAttribution,
  executionQuality,
}: {
  decisionTrail: DecisionTrailRow[]
  blockedDecisions: BlockedDecisionRow[]
  topBlockReasons: Array<{ reason: string; count: number }>
  sourceAttribution: SourceAttributionRow[]
  executionQuality: ExecutionQualitySummary | undefined
}) {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpRight className="h-4 w-4 text-emerald-400" />
              Why Bought / Sold
            </CardTitle>
            <CardDescription>Linked candidate reasoning, sources and execution outcome</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {decisionTrail.length === 0 ? (
              <p className="text-sm text-zinc-500">No linked decision trail yet.</p>
            ) : decisionTrail.slice(0, 6).map(row => {
              const displayAction = row.decisionAction ?? row.action
              return (
              <div key={row.candidateId} className="rounded-md bg-zinc-900/40 px-3 py-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-50">{row.symbol}</span>
                    <Badge variant={actionVariant(displayAction)} className="text-xs">
                      {displayAction}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">{row.confidence}%</Badge>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {formatDistanceToNow(new Date(row.updatedAt * 1000), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{row.reasoning}</p>
                {row.heldOutReason && (
                  <p className="text-[11px] text-amber-400">{row.heldOutReason}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {row.sourceTypes.map(source => (
                    <Badge key={source} variant="outline" className="text-[10px] uppercase">{source}</Badge>
                  ))}
                  <Badge variant="secondary" className="text-[10px]">{row.candidateStatus}</Badge>
                  {row.executionStatus && <Badge variant="secondary" className="text-[10px]">{row.executionStatus}</Badge>}
                </div>
                {row.eventTitles.length > 0 && (
                  <div className="text-[11px] text-zinc-500">{row.eventTitles.join(' • ')}</div>
                )}
              </div>
            )})}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDownRight className="h-4 w-4 text-red-400" />
              Blocked / Rejected
            </CardTitle>
            <CardDescription>Most recent candidates stopped by market, risk or execution checks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {blockedDecisions.length === 0 ? (
              <p className="text-sm text-zinc-500">No blocked decisions in the current report window.</p>
            ) : blockedDecisions.map(row => (
              <div key={row.candidateId} className="rounded-md border border-red-500/15 bg-red-950/20 px-3 py-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-50">{row.symbol}</span>
                    <Badge variant="destructive" className="text-xs">{row.executionStatus ?? row.candidateStatus}</Badge>
                  </div>
                  <span className="text-xs text-zinc-500">{row.confidence}%</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{row.reasoning}</p>
                {row.eventTitles.length > 0 && (
                  <div className="text-[11px] text-zinc-500">{row.eventTitles.join(' • ')}</div>
                )}
              </div>
            ))}

            {topBlockReasons.length > 0 && (
              <div className="pt-3 border-t border-zinc-800 space-y-2">
                <div className="text-xs text-zinc-500">Top block reasons</div>
                {topBlockReasons.map(item => (
                  <div key={item.reason} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400 truncate">{item.reason}</span>
                    <span className="text-zinc-300 font-mono">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {sourceAttribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-amber-400" />
              Realized P&L by Research Source
            </CardTitle>
            <CardDescription>Attribution from filled trades to dominant linked research source</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sourceAttribution.slice(0, 6).map(row => (
                <div key={row.key} className="flex items-center justify-between rounded-md bg-zinc-900/40 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-zinc-50">{row.key}</div>
                    <div className="text-xs text-zinc-500">{row.trades} trades · {row.winRate ?? '—'}% win rate</div>
                  </div>
                  <div className={cn("font-mono text-xs", row.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {row.realizedPnl >= 0 ? '+' : ''}${Math.abs(row.realizedPnl).toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {executionQuality && executionQuality.totalFillOutcomes > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendUp className="h-4 w-4 text-cyan-400" />
              Fill Quality
            </CardTitle>
            <CardDescription>
              {executionQuality.totalFillOutcomes} fill outcomes · {executionQuality.resubmittedOutcomes} via resubmit path
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Avg Latency', value: executionQuality.avgLatencySeconds !== null ? `${executionQuality.avgLatencySeconds}s` : '—' },
                { label: 'Avg |Slip|', value: executionQuality.avgAbsSlippageBps !== null ? `${executionQuality.avgAbsSlippageBps} bps` : '—' },
                { label: '1st Pass |Slip|', value: executionQuality.firstPassAvgAbsSlippageBps !== null ? `${executionQuality.firstPassAvgAbsSlippageBps} bps` : '—' },
                { label: 'Resubmit |Slip|', value: executionQuality.resubmitAvgAbsSlippageBps !== null ? `${executionQuality.resubmitAvgAbsSlippageBps} bps` : '—' },
              ].map(item => (
                <div key={item.label} className="rounded-md bg-zinc-900/40 px-3 py-2">
                  <div className="text-[10px] text-zinc-500">{item.label}</div>
                  <div className="text-sm font-semibold text-zinc-50">{item.value}</div>
                </div>
              ))}
            </div>
            {executionQuality.worstCases.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-zinc-500">Worst slippage / latency cases</div>
                {executionQuality.worstCases.slice(0, 4).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-md bg-zinc-900/40 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium text-zinc-50">{item.symbol} {item.action}</div>
                      <div className="text-xs text-zinc-500">
                        {item.status} · {item.retryCount > 0 ? `${item.retryCount} resubmit` : 'first pass'} · {item.latencySeconds}s
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-zinc-300">{item.absSlippageBps ?? '—'} bps</div>
                      <div className="text-zinc-500">{item.filledShares ?? 0}/{item.plannedShares ?? item.filledShares ?? 0} filled</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
