import { Fragment, useEffect, useMemo, useState } from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  RefreshCw,
  ShieldAlert,
} from "lucide-react"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import {
  api,
  type ExecutionHistoryResponse,
  type ExecutionQualitySummaryRow,
} from "@/src/lib/api"
import { cn } from "@/src/lib/utils"
import { FilterSelect } from "@/src/components/ui/filter-select"

type FilterState = {
  symbol: string
  status: string
  terminalPath: string
  retryBand: string
  degraded: string
  window: string
}

const DEFAULT_FILTERS: FilterState = {
  symbol: "",
  status: "",
  terminalPath: "",
  retryBand: "",
  degraded: "",
  window: "7d",
}

export function ExecutionLog() {
  const [history, setHistory] = useState<ExecutionHistoryResponse>({ total: 0, items: [] })
  const [qualitySummary, setQualitySummary] = useState<ExecutionQualitySummaryRow[]>([])
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const active = { value: true }
    setLoading(true)
    const poll = async () => {
      const result = await loadExecutionData(filters)
      if (!active.value) return
      setHistory(result.history)
      setQualitySummary(result.qualitySummary)
      setLoading(false)
      setRefreshing(false)
    }
    poll()
    const interval = setInterval(() => {
      poll()
    }, 15_000)
    return () => {
      active.value = false
      clearInterval(interval)
    }
  }, [filters.symbol, filters.status, filters.terminalPath, filters.retryBand, filters.degraded, filters.window])

  const filteredSummary = useMemo(() => {
    return qualitySummary.filter((row) => {
      if (filters.symbol && row.symbol !== filters.symbol.trim().toUpperCase()) return false
      if (filters.terminalPath && row.terminalPath !== filters.terminalPath) return false
      if (filters.retryBand && !matchesRetryBand(row.terminalPath, filters.retryBand)) return false
      return true
    })
  }, [qualitySummary, filters.symbol, filters.terminalPath, filters.retryBand])

  const stats = useMemo(() => {
    const items = history.items
    const degraded = items.filter((item) => item.degradedExecution).length
    const open = items.filter((item) => item.status === "submitted" || item.status === "partially_filled").length
    const completed = items.filter((item) => ["filled", "cancelled", "rejected"].includes(item.status)).length
    const avgCompletion = items.length > 0
      ? items.reduce((sum, item) => sum + (item.completionRatio ?? 0), 0) / items.length
      : null
    const avgRetries = items.length > 0
      ? items.reduce((sum, item) => sum + item.retryCount, 0) / items.length
      : null
    return { degraded, open, completed, avgCompletion, avgRetries }
  }, [history.items])

  const topOutcomePaths = useMemo(() => filteredSummary.slice(0, 5), [filteredSummary])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    const result = await loadExecutionData(filters)
    setHistory(result.history)
    setQualitySummary(result.qualitySummary)
    setRefreshing(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Execution History</h2>
          <p className="text-sm text-zinc-400">
            Attempt lineage for autonomous execution: target sizing, retries, degradation, and terminal outcome.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <input
            value={filters.symbol}
            onChange={(event) => setFilters((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))}
            placeholder="Symbol"
            className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <FilterSelect
            value={filters.status}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
            options={[
              ["", "All status"],
              ["planned", "Planned"],
              ["submitted", "Submitted"],
              ["partially_filled", "Partially filled"],
              ["filled", "Filled"],
              ["cancelled", "Cancelled"],
              ["rejected", "Rejected"],
            ]}
            className="h-10 text-sm text-zinc-100"
          />
          <FilterSelect
            value={filters.terminalPath}
            onChange={(value) => setFilters((prev) => ({ ...prev, terminalPath: value }))}
            options={[
              ["", "All paths"],
              ["first_fill", "First fill"],
              ["reduced_resubmit_fill", "Reduced resubmit fill"],
              ["halt_after_partial", "Halt after partial"],
              ["cancelled_no_fill", "Cancelled no fill"],
              ["cancelled_after_partial", "Cancelled after partial"],
              ["rejected", "Rejected"],
            ]}
            className="h-10 text-sm text-zinc-100"
          />
          <FilterSelect
            value={filters.retryBand}
            onChange={(value) => setFilters((prev) => ({ ...prev, retryBand: value }))}
            options={[
              ["", "All retry bands"],
              ["first_pass", "First pass"],
              ["resubmitted", "Resubmitted"],
              ["reduced", "Reduced strategy"],
              ["halt_partial", "Halt partial"],
            ]}
            className="h-10 text-sm text-zinc-100"
          />
          <FilterSelect
            value={filters.degraded}
            onChange={(value) => setFilters((prev) => ({ ...prev, degraded: value }))}
            options={[
              ["", "All degradation"],
              ["true", "Degraded only"],
              ["false", "Healthy only"],
            ]}
            className="h-10 text-sm text-zinc-100"
          />
          <FilterSelect
            value={filters.window}
            onChange={(value) => setFilters((prev) => ({ ...prev, window: value }))}
            options={[
              ["24h", "Last 24h"],
              ["7d", "Last 7d"],
              ["30d", "Last 30d"],
              ["all", "All time"],
            ]}
            className="h-10 text-sm text-zinc-100"
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attempts" value={history.total} detail={`${stats.completed} terminal`} />
        <StatCard label="In Flight" value={stats.open} detail="submitted or partial" />
        <StatCard label="Degraded" value={stats.degraded} detail="attempts under pressure" warning={stats.degraded > 0} />
        <StatCard
          label="Avg Completion"
          value={stats.avgCompletion !== null ? `${(stats.avgCompletion * 100).toFixed(0)}%` : "n/a"}
          detail={stats.avgRetries !== null ? `${stats.avgRetries.toFixed(1)} avg retries` : "no attempts"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Attempt Lineage</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/40 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="w-8 px-4 py-3"></th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Initial</th>
                  <th className="px-4 py-3 font-medium text-right">Final</th>
                  <th className="px-4 py-3 font-medium text-right">Filled</th>
                  <th className="px-4 py-3 font-medium">Retry</th>
                  <th className="px-4 py-3 font-medium text-right">Latency</th>
                  <th className="px-4 py-3 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center text-zinc-500">Loading execution history...</td>
                  </tr>
                ) : history.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-8 text-center text-zinc-500">No execution attempts match the current filters.</td>
                  </tr>
                ) : history.items.map((item) => {
                  const isExpanded = expanded.has(item.id)
                  return (
                    <Fragment key={item.id}>
                      <tr
                        onClick={() => toggleExpanded(item.id)}
                        className="cursor-pointer transition-colors hover:bg-zinc-900/30"
                      >
                        <td className="px-4 py-3 text-zinc-600">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          <div className="flex items-center gap-1.5">
                            <Clock3 className="h-3 w-3" />
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">{format(new Date(item.createdAt), "MMM d HH:mm:ss")}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-semibold text-zinc-50">
                            {item.action === "BUY" ? (
                              <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4 text-red-400" />
                            )}
                            {item.symbol}
                          </div>
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{item.mode}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <Badge variant={statusVariant(item.status)} className="w-fit text-[10px]">{item.status.replaceAll("_", " ")}</Badge>
                            {item.terminalPath ? (
                              <span className="text-[11px] text-zinc-500">{item.terminalPath.replaceAll("_", " ")}</span>
                            ) : null}
                            {item.degradedExecution ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                                <ShieldAlert className="h-3 w-3" /> degraded
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatQuantity(item.initialTargetShares)}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{formatQuantity(item.finalTargetShares)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-mono text-zinc-200">{formatQuantity(item.filledShares)}</div>
                          <div className="text-[11px] text-zinc-500">{item.completionRatio !== null ? `${(item.completionRatio * 100).toFixed(0)}%` : "n/a"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-zinc-200">{item.retryCount} retries</div>
                          <div className="text-[11px] text-zinc-500">
                            {[item.sizingBand, item.strategyBand, item.timingBand].filter(Boolean).join(" / ") || "base"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-300">{item.latencySeconds !== null ? `${item.latencySeconds}s` : "n/a"}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn(
                            "font-mono text-xs font-medium",
                            item.realizedPnl === null ? "text-zinc-500" : item.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                          )}>
                            {formatPnl(item.realizedPnl)}
                          </span>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${item.id}-detail`} className="bg-zinc-900/30">
                          <td colSpan={10} className="px-6 py-4">
                            <div className="grid gap-4 lg:grid-cols-3">
                              <DetailBlock
                                title="Lineage"
                                lines={[
                                  `Attempt: ${item.id}`,
                                  `Candidate: ${item.candidateId ?? "n/a"}`,
                                  `Trade: ${item.linkedTradeId ?? "n/a"}${item.linkedTradeStatus ? ` (${item.linkedTradeStatus})` : ""}`,
                                  `Broker orders: ${item.brokerOrderIds.length > 0 ? item.brokerOrderIds.join(", ") : item.brokerOrderId ?? "n/a"}`,
                                ]}
                              />
                              <DetailBlock
                                title="Sizing & Fill"
                                lines={[
                                  `Initial target: ${formatQuantity(item.initialTargetShares)} (${formatMoney(item.initialTargetValue)})`,
                                  `Final target: ${formatQuantity(item.finalTargetShares)} (${formatMoney(item.finalTargetValue)})`,
                                  `Target weight: ${formatWeight(item.baseTargetWeight)} -> ${formatWeight(item.adjustedTargetWeight)}`,
                                  `Construction: ${item.constructionBand ?? "clean"}${item.constructionReason ? ` · ${item.constructionReason}` : ""}`,
                                  `Filled: ${formatQuantity(item.filledShares)} @ ${formatMoney(item.linkedTradePrice)}`,
                                  `Slippage: ${item.slippageBps !== null ? `${item.slippageBps.toFixed(1)} bps` : "n/a"}`,
                                ]}
                              />
                              <DetailBlock
                                title="Control State"
                                lines={[
                                  `Sizing: ${item.sizingBand ?? "base"}${item.sizingMultiplier !== null ? ` (${item.sizingMultiplier.toFixed(2)}x)` : ""}`,
                                  `Strategy: ${item.strategyBand ?? "base"}`,
                                  `Timing: ${item.timingBand ?? "base"}`,
                                  `Segment: ${item.rolloutProfile ?? "n/a"} / ${item.sessionRegime ?? "n/a"}`,
                                ]}
                              />
                            </div>

                            {item.candidateReasoning ? (
                              <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Decision rationale</div>
                                <p className="text-sm leading-6 text-zinc-300">{item.candidateReasoning}</p>
                              </div>
                            ) : null}

                            {item.degradationReasons.length > 0 || item.error ? (
                              <div className="mt-4 rounded-md border border-amber-900/40 bg-amber-950/20 p-3">
                                <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-300">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  Pressure signals
                                </div>
                                {item.degradationReasons.length > 0 ? (
                                  <p className="text-sm text-amber-100/80">Signals: {item.degradationReasons.join(", ")}</p>
                                ) : null}
                                {item.error ? <p className="mt-1 text-sm text-amber-100/80">Last error: {item.error}</p> : null}
                              </div>
                            ) : null}

                            <div className="mt-4">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">State history</div>
                              <div className="space-y-2">
                                {item.stateHistory.length === 0 ? (
                                  <div className="text-sm text-zinc-500">No state transitions recorded.</div>
                                ) : item.stateHistory.map((state, index) => (
                                  <div key={`${item.id}-state-${index}`} className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300 md:flex-row md:items-center md:justify-between">
                                    <div className="flex items-center gap-2">
                                      <Badge variant={statusVariant(String(state.status ?? "planned"))} className="text-[10px]">
                                        {String(state.status ?? "planned").replaceAll("_", " ")}
                                      </Badge>
                                      <span>{state.detail ?? state.error ?? "State transition recorded."}</span>
                                    </div>
                                    <div className="text-[11px] text-zinc-500">
                                      {formatStateTimestamp(state.at)}
                                      {state.filledShares ? ` · filled ${state.filledShares}` : ""}
                                      {state.brokerOrderId ? ` · ${state.brokerOrderId}` : ""}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Outcome Segments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topOutcomePaths.length === 0 ? (
              <div className="text-sm text-zinc-500">No completed execution paths in the current summary window.</div>
            ) : topOutcomePaths.map((row) => (
              <div key={`${row.symbol}-${row.action}-${row.terminalPath}-${row.rolloutProfile}-${row.sessionRegime}`} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-zinc-100">{row.symbol} {row.action}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {row.terminalPath.replaceAll("_", " ")} · {row.rolloutProfile ?? row.mode} / {row.sessionRegime ?? "n/a"}
                    </div>
                  </div>
                  <Badge variant={row.degradedAttempts > 0 ? "secondary" : "outline"} className="text-[10px]">
                    {row.attempts} attempts
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                  <span>Completion</span>
                  <span className="text-right text-zinc-200">{row.avgCompletionRatio !== null ? `${(row.avgCompletionRatio * 100).toFixed(0)}%` : "n/a"}</span>
                  <span>Latency</span>
                  <span className="text-right text-zinc-200">{row.avgLatencySeconds !== null ? `${row.avgLatencySeconds.toFixed(0)}s` : "n/a"}</span>
                  <span>Abs slippage</span>
                  <span className="text-right text-zinc-200">{row.avgAbsSlippageBps !== null ? `${row.avgAbsSlippageBps.toFixed(1)} bps` : "n/a"}</span>
                  <span>Retries</span>
                  <span className="text-right text-zinc-200">{row.avgRetryCount !== null ? row.avgRetryCount.toFixed(1) : "0.0"}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


function StatCard({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string
  value: string | number
  detail: string
  warning?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-zinc-400">{label}</div>
        <div className={cn("mt-1 text-xl font-bold", warning ? "text-amber-300" : "text-zinc-50")}>{value}</div>
        <div className="mt-1 text-xs text-zinc-500">{detail}</div>
      </CardContent>
    </Card>
  )
}

function DetailBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="space-y-1.5 text-sm text-zinc-300">
        {lines.map((line) => (
          <div key={`${title}-${line}`}>{line}</div>
        ))}
      </div>
    </div>
  )
}

function getWindowStart(window: string, to: number): number | undefined {
  if (window === "24h") return to - 24 * 60 * 60 * 1000
  if (window === "7d") return to - 7 * 24 * 60 * 60 * 1000
  if (window === "30d") return to - 30 * 24 * 60 * 60 * 1000
  return undefined
}

function matchesRetryBand(terminalPath: string, retryBand: string): boolean {
  if (retryBand === "first_pass") return terminalPath === "first_fill"
  if (retryBand === "resubmitted") return terminalPath === "reduced_resubmit_fill"
  if (retryBand === "reduced") return terminalPath === "reduced_resubmit_fill"
  if (retryBand === "halt_partial") return terminalPath === "halt_after_partial"
  return true
}

function formatQuantity(value: number | null): string {
  if (value === null || value === undefined) return "n/a"
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatMoney(value: number | null): string {
  if (value === null || value === undefined) return "n/a"
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatWeight(value: number | null): string {
  if (value === null || value === undefined) return "n/a"
  return `${(value * 100).toFixed(1)}%`
}

function formatPnl(value: number | null): string {
  if (value === null || value === undefined) return "n/a"
  const sign = value >= 0 ? "+" : "-"
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatStateTimestamp(value: unknown): string {
  if (typeof value !== "number") return "unknown time"
  const millis = value > 1_000_000_000_000 ? value : value * 1000
  return format(new Date(millis), "MMM d HH:mm:ss")
}

function statusVariant(status: string): "success" | "destructive" | "secondary" | "outline" {
  if (status === "filled") return "success"
  if (status === "rejected" || status === "cancelled") return "destructive"
  if (status === "submitted" || status === "partially_filled") return "secondary"
  return "outline"
}

async function loadExecutionData(filters: FilterState): Promise<{
  history: ExecutionHistoryResponse
  qualitySummary: ExecutionQualitySummaryRow[]
}> {
  const to = Date.now()
  const from = getWindowStart(filters.window, to)
  const [history, qualitySummary] = await Promise.all([
    api.getExecutionHistory({
      symbol: filters.symbol.trim().toUpperCase() || undefined,
      status: filters.status || undefined,
      terminalPath: filters.terminalPath || undefined,
      retryBand: filters.retryBand || undefined,
      degraded: filters.degraded === "" ? undefined : filters.degraded === "true",
      from,
      to,
      limit: 200,
    }),
    api.getExecutionQualitySummary(100),
  ])

  return {
    history: history ?? { total: 0, items: [] },
    qualitySummary: qualitySummary ?? [],
  }
}
