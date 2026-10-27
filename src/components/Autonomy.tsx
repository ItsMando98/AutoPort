import { useEffect, useMemo, useState, type ReactNode } from "react"
import { formatDistanceToNow } from "date-fns"
import {
  BrainCircuit,
  Clock3,
  Crosshair,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { EmptyState } from "@/src/components/ui/empty-state"
import { Pill } from "@/src/components/ui/pill"
import {
  api,
  type AutonomyCalibrationResponse,
  type AutonomyDecision,
  type AutonomyDecisionResponse,
  type AutonomyForecastResponse,
  type AutonomyForecastRow,
  type AutonomyLineage,
  type AutonomyThesis,
} from "@/src/lib/api"
import { cn } from "@/src/lib/utils"

interface NormalizedForecast {
  id: string
  symbol: string
  scope: string
  target: string
  direction: string
  probability: number
  confidence: number
  status: string
  reasoning: string | null
  windowStartAt: number | null
  windowEndAt: number | null
  actualDirection: string | null
}

export function Autonomy() {
  const [symbolInput, setSymbolInput] = useState("")
  const [activeSymbol, setActiveSymbol] = useState("")
  const [decisionData, setDecisionData] = useState<AutonomyDecisionResponse>({ decisions: [], intents: [] })
  const [theses, setTheses] = useState<AutonomyThesis[]>([])
  const [forecastData, setForecastData] = useState<AutonomyForecastResponse>({ eventForecasts: [], marketForecasts: [] })
  const [calibration, setCalibration] = useState<AutonomyCalibrationResponse>({
    calibration: { bySource: [], overall: { totalResolved: 0, hitRate: null, brierScore: null } },
    freshness: [],
  })
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null)
  const [lineage, setLineage] = useState<AutonomyLineage | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (symbol = activeSymbol) => {
    const normalizedSymbol = symbol.trim().toUpperCase()
    const fetcher = async () => {
      const [nextDecisions, nextTheses, nextForecasts, nextCalibration] = await Promise.all([
        api.getAutonomyDecisions(normalizedSymbol || undefined, 60),
        api.getAutonomyTheses(normalizedSymbol || undefined, 120, true),
        api.getAutonomyForecasts(120),
        api.getAutonomyCalibration(),
      ])
      setDecisionData(nextDecisions)
      setTheses(nextTheses)
      setForecastData(nextForecasts)
      setCalibration(nextCalibration)
      if (normalizedSymbol !== activeSymbol) {
        setActiveSymbol(normalizedSymbol)
      }
    }

    if (loading) {
      await fetcher()
      setLoading(false)
      return
    }

    setRefreshing(true)
    await fetcher()
    setRefreshing(false)
  }

  useEffect(() => {
    void load(activeSymbol)
    const interval = setInterval(() => {
      void load(activeSymbol)
    }, 30_000)
    return () => clearInterval(interval)
  }, [activeSymbol])

  useEffect(() => {
    if (decisionData.decisions.length === 0) {
      setSelectedDecisionId(null)
      setLineage(null)
      return
    }
    if (!selectedDecisionId || !decisionData.decisions.some(decision => decision.id === selectedDecisionId)) {
      setSelectedDecisionId(decisionData.decisions[0]?.id ?? null)
    }
  }, [decisionData.decisions, selectedDecisionId])

  useEffect(() => {
    if (!selectedDecisionId) {
      setLineage(null)
      return
    }
    api.getAutonomyLineage(selectedDecisionId).then(setLineage)
  }, [selectedDecisionId])

  const normalizedForecasts = useMemo(() => {
    const rows = [...forecastData.eventForecasts, ...forecastData.marketForecasts]
    return rows
      .map(normalizeForecastRow)
      .sort((a, b) => (b.windowEndAt ?? 0) - (a.windowEndAt ?? 0))
  }, [forecastData])

  const openForecasts = normalizedForecasts.filter(item => item.status === "open")
  const resolvedForecasts = normalizedForecasts.filter(item => item.status === "resolved")
  const actionableDecisions = decisionData.decisions.filter(decision => decision.action !== "HOLD")
  const disagreementCount = decisionData.decisions.filter(decision => decision.disagreementPenalty >= 0.35).length
  const selectedDecision = decisionData.decisions.find(decision => decision.id === selectedDecisionId) ?? null

  const topSymbols = useMemo(() => {
    const symbols = new Set<string>()
    for (const decision of decisionData.decisions) {
      if (decision.symbol) symbols.add(decision.symbol)
      if (symbols.size >= 8) break
    }
    return [...symbols]
  }, [decisionData.decisions])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Autonomy</h2>
          <p className="text-sm text-zinc-400">
            Committee decisions, thesis coverage, forecast calendar, and calibration for the multi-agent PM layer.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            {topSymbols.map(symbol => (
              <Pill
                key={symbol}
                onClick={() => {
                  setSymbolInput(symbol)
                  void load(symbol)
                }}
                active={activeSymbol === symbol}
                activeClassName="border-sky-400/60 bg-sky-400/10 text-sky-200"
                className={activeSymbol !== symbol ? "bg-zinc-900 text-zinc-300" : undefined}
              >
                {symbol}
              </Pill>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(symbolInput)
              }}
              placeholder="Filter by symbol"
              className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-700"
            />
            <Button variant="outline" onClick={() => void load(symbolInput)} className="gap-2">
              <Crosshair className="h-4 w-4" />
              Apply
            </Button>
            <Button variant="outline" onClick={() => {
              setSymbolInput("")
              void load("")
            }} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Actionable Intents"
          value={String(actionableDecisions.length)}
          detail={actionableDecisions[0] ? `${actionableDecisions[0].symbol} is the top live committee action` : "No buy, add, trim, or exit decision yet"}
          icon={<Target className="h-4 w-4 text-sky-300" />}
        />
        <MetricCard
          title="Fresh Theses"
          value={String(theses.length)}
          detail={theses[0] ? `${theses[0].symbol} has ${Math.round(theses[0].confidence * 100)}% thesis confidence` : "No fresh symbol theses published yet"}
          icon={<BrainCircuit className="h-4 w-4 text-violet-300" />}
        />
        <MetricCard
          title="Open Forecasts"
          value={String(openForecasts.length)}
          detail={openForecasts[0] ? `${openForecasts[0].symbol} ${openForecasts[0].direction.toUpperCase()} forecast is next to resolve` : "No open forecasts waiting for resolution"}
          icon={<Sparkles className="h-4 w-4 text-emerald-300" />}
        />
        <MetricCard
          title="Resolved Accuracy"
          value={formatPct(calibration.calibration.overall.hitRate)}
          detail={
            calibration.calibration.overall.totalResolved > 0
              ? `${calibration.calibration.overall.totalResolved} resolved forecasts, Brier ${formatMaybe(calibration.calibration.overall.brierScore)}`
              : "No resolved forecasts yet"
          }
          icon={<ShieldCheck className="h-4 w-4 text-amber-300" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Manager Committee</CardTitle>
            <CardDescription>
              Latest decision batches with confidence, disagreement, and coverage gating.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-zinc-900/70 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Symbol</th>
                    <th className="px-4 py-3 text-left font-medium">Intent</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                    <th className="px-4 py-3 text-right font-medium">Conf.</th>
                    <th className="px-4 py-3 text-right font-medium">Coverage</th>
                    <th className="px-4 py-3 text-right font-medium">Disagree</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950/60">
                  {decisionData.decisions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-zinc-500">
                        No decision batches available yet.
                      </td>
                    </tr>
                  ) : decisionData.decisions.map(decision => (
                    <tr
                      key={decision.id}
                      onClick={() => setSelectedDecisionId(decision.id)}
                      className={cn(
                        "cursor-pointer transition hover:bg-zinc-900/60",
                        selectedDecisionId === decision.id && "bg-zinc-900/80"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">{decision.symbol}</div>
                        <div className="text-xs text-zinc-500">
                          {decision.macroRegime.toUpperCase()} · {relativeTime(decision.createdAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={decision.action} />
                      </td>
                      <td className={cn("px-4 py-3 text-right font-mono", decision.score >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {decision.score.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-200">{Math.round(decision.confidence * 100)}%</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{decision.coverage}</td>
                      <td className={cn(
                        "px-4 py-3 text-right font-mono",
                        decision.disagreementPenalty >= 0.5 ? "text-red-300" : decision.disagreementPenalty >= 0.25 ? "text-amber-300" : "text-emerald-300"
                      )}>
                        {(decision.disagreementPenalty * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision Lineage</CardTitle>
            <CardDescription>
              Contribution weights, linked theses, and trade lineage for the selected batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedDecision ? (
              <EmptyState label="Select a decision batch to inspect lineage." />
            ) : (
              <>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-xl font-semibold text-zinc-50">{selectedDecision.symbol}</div>
                        <ActionBadge action={selectedDecision.action} />
                      </div>
                      <div className="mt-2 text-sm leading-relaxed text-zinc-300">
                        {selectedDecision.decisionReason}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>{Math.round(selectedDecision.confidence * 100)}% confidence</div>
                      <div>{selectedDecision.coverage} agents</div>
                    </div>
                  </div>
                  {selectedDecision.heldOutReason && (
                    <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      {selectedDecision.heldOutReason}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {(lineage?.decision?.contributions ?? selectedDecision.contributions)
                    .slice()
                    .sort((a, b) => Math.abs(b.weightedScore) - Math.abs(a.weightedScore))
                    .map(contribution => (
                      <div key={`${contribution.agentName}-${contribution.thesisId ?? contribution.sourceKey}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px] uppercase">{contribution.agentName}</Badge>
                              <Badge variant={contribution.stance === "BUY" ? "success" : contribution.stance === "SELL" ? "destructive" : "secondary"} className="text-[10px]">
                                {contribution.stance}
                              </Badge>
                            </div>
                            <div className="mt-2 text-sm text-zinc-200 line-clamp-2">{contribution.thesis}</div>
                          </div>
                          <div className="text-right text-xs text-zinc-400">
                            <div>W {contribution.weight.toFixed(2)}</div>
                            <div>S {contribution.weightedScore.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>

                {lineage?.trades?.length ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="mb-2 text-sm font-medium text-zinc-100">Linked Trades</div>
                    <div className="space-y-2 text-sm text-zinc-300">
                      {lineage.trades.slice(0, 3).map((trade: any) => (
                        <div key={trade.id} className="flex items-center justify-between rounded-lg bg-zinc-950/60 px-3 py-2">
                          <div>
                            <div className="font-medium text-zinc-100">{trade.action} {trade.symbol}</div>
                            <div className="text-xs text-zinc-500">{relativeTime((trade.created_at ?? 0) * 1000)}</div>
                          </div>
                          <div className="text-right">
                            <div>{Number(trade.shares ?? 0).toLocaleString()} shares</div>
                            <div className="text-xs text-zinc-500">@ ${Number(trade.price ?? 0).toFixed(2)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Latest Symbol Theses</CardTitle>
            <CardDescription>
              Fresh agent-level buy, sell, and hold views feeding the PM committee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {theses.length === 0 ? (
              <EmptyState label="No fresh theses available for the current filter." />
            ) : theses.slice(0, 14).map(thesis => (
              <div key={thesis.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-zinc-50">{thesis.symbol}</div>
                      <Badge variant="outline" className="text-[10px] uppercase">{thesis.agentName}</Badge>
                      <Badge variant={thesis.stance === "BUY" ? "success" : thesis.stance === "SELL" ? "destructive" : "secondary"} className="text-[10px]">
                        {thesis.stance}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-zinc-300">{thesis.thesis}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>{thesis.horizon}</span>
                      <span>•</span>
                      <span>{Math.round(thesis.confidence * 100)}% confidence</span>
                      <span>•</span>
                      <span>{Math.round(thesis.freshnessScore * 100)}% freshness</span>
                      {thesis.catalyst ? (
                        <>
                          <span>•</span>
                          <span>{thesis.catalyst}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-zinc-500">
                    <div>{relativeTime(thesis.createdAt)}</div>
                    <div>{expiryLabel(thesis.expiresAt)}</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Forecast Calendar</CardTitle>
            <CardDescription>
              Open and recently resolved event or market-direction forecasts generated by the agent stack.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {normalizedForecasts.length === 0 ? (
              <EmptyState label="No forecasts published yet." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <ForecastBucket
                    label="Open"
                    value={String(openForecasts.length)}
                    detail={openForecasts[0] ? `${openForecasts[0].symbol} resolves ${relativeTime(openForecasts[0].windowEndAt)}` : "No open window"}
                  />
                  <ForecastBucket
                    label="Resolved"
                    value={String(resolvedForecasts.length)}
                    detail={resolvedForecasts[0]?.actualDirection ? `Latest outcome ${resolvedForecasts[0].actualDirection}` : "No outcomes yet"}
                  />
                </div>

                <div className="space-y-2">
                  {normalizedForecasts.slice(0, 10).map(forecast => (
                    <div key={forecast.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] uppercase">{forecast.scope}</Badge>
                            <div className="font-medium text-zinc-100">{forecast.symbol}</div>
                            <DirectionBadge direction={forecast.direction} />
                          </div>
                          <div className="mt-2 text-sm text-zinc-300">{forecast.target}</div>
                          {forecast.reasoning ? (
                            <div className="mt-2 text-xs leading-relaxed text-zinc-500 line-clamp-2">{forecast.reasoning}</div>
                          ) : null}
                        </div>
                        <div className="text-right text-xs text-zinc-400">
                          <div>{Math.round(forecast.probability * 100)}%</div>
                          <div>{forecast.status}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                        <span>{relativeTime(forecast.windowEndAt)}</span>
                        {forecast.actualDirection ? <span>actual {forecast.actualDirection}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Calibration By Source</CardTitle>
            <CardDescription>
              Resolved forecast accuracy and adaptive PM weighting per upstream source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calibration.calibration.bySource.length === 0 ? (
              <EmptyState label="Calibration will populate after forecasts resolve." />
            ) : calibration.calibration.bySource.map(source => (
              <div key={source.sourceKey} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-100">{source.sourceKey}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {source.sampleSize} resolved · avg confidence {formatPct(source.avgConfidence)}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-zinc-50">{formatPct(source.hitRate)}</div>
                    <div className="text-xs text-zinc-500">weight {source.weight.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-400">
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Hit Rate</div>
                    <div className="mt-1 font-semibold text-zinc-100">{formatPct(source.hitRate)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Brier Score</div>
                    <div className="mt-1 font-semibold text-zinc-100">{formatMaybe(source.brierScore)}</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cadence And Freshness</CardTitle>
            <CardDescription>
              Agent heartbeat quality for dependency-aware PM gating.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calibration.freshness.map(agent => (
              <div key={agent.sourceKey} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-zinc-100">{agent.agentName}</div>
                    <div className="mt-1 text-xs text-zinc-500">{agent.sourceKey}</div>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill label={agent.cadenceStatus} />
                    <StatusPill label={agent.freshnessStatus} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-400">
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Cadence</div>
                    <div className="mt-1 font-semibold text-zinc-100">{formatInterval(agent.cadenceMs)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Freshness TTL</div>
                    <div className="mt-1 font-semibold text-zinc-100">{formatInterval(agent.freshnessTtlMs)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Last Run</div>
                    <div className="mt-1 font-semibold text-zinc-100">{relativeTime(agent.lastRunAt)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/70 px-3 py-2">
                    <div className="text-zinc-500">Last Usable Output</div>
                    <div className="mt-1 font-semibold text-zinc-100">{relativeTime(agent.lastUsableOutputAt)}</div>
                  </div>
                </div>
              </div>
            ))}

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-300">
              {disagreementCount} symbols currently sit in the disagreement watchlist with elevated committee conflict.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricCard({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</div>
            <div className="mt-3 text-3xl font-semibold text-zinc-50">{value}</div>
            <div className="mt-2 text-sm leading-relaxed text-zinc-400">{detail}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ForecastBucket({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-zinc-50">{value}</div>
      <div className="mt-2 text-xs leading-relaxed text-zinc-400">{detail}</div>
    </div>
  )
}


function ActionBadge({ action }: { action: string }) {
  if (action === "BUY" || action === "ADD") return <Badge variant="success">{action}</Badge>
  if (action === "TRIM" || action === "EXIT") return <Badge variant="destructive">{action}</Badge>
  return <Badge variant="secondary">{action}</Badge>
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "up") {
    return <Badge variant="success" className="gap-1"><TrendingUp className="h-3 w-3" />UP</Badge>
  }
  if (direction === "down") {
    return <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" />DOWN</Badge>
  }
  return <Badge variant="secondary">FLAT</Badge>
}

function StatusPill({ label }: { label: string }) {
  const variant = label === "fresh" || label === "on_time"
    ? "success"
    : label === "stale" || label === "late"
      ? "warning"
      : label === "missed"
        ? "destructive"
        : "secondary"
  return <Badge variant={variant}>{label.replace(/_/g, " ")}</Badge>
}

function normalizeForecastRow(row: AutonomyForecastRow): NormalizedForecast {
  return {
    id: row.id,
    symbol: String(row.symbol ?? row.scope ?? row.market_topic ?? "MARKET").toUpperCase(),
    scope: row.scope ?? (row.event_type ? "event" : "market"),
    target: row.target_variable ?? row.target ?? row.event_type ?? "forecast",
    direction: row.direction ?? row.predicted_direction ?? "flat",
    probability: Number(row.probability ?? 0),
    confidence: Number(row.confidence ?? 0),
    status: row.status ?? "open",
    reasoning: row.reasoning ?? null,
    windowStartAt: normalizeTimestamp(row.window_start_at ?? row.resolution_window_start ?? row.prediction_timestamp ?? row.created_at ?? null),
    windowEndAt: normalizeTimestamp(row.window_end_at ?? row.resolution_window_end ?? null),
    actualDirection: row.actual_direction ?? null,
  }
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (!value) return null
  return value > 10_000_000_000 ? value : value * 1000
}

function relativeTime(value: number | null | undefined): string {
  if (!value) return "n/a"
  return formatDistanceToNow(new Date(value), { addSuffix: true })
}

function expiryLabel(value: number | null): string {
  if (!value) return "no expiry"
  return `expires ${relativeTime(value)}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a"
  return `${Math.round(value * 100)}%`
}

function formatMaybe(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a"
  return value.toFixed(2)
}

function formatInterval(value: number | null | undefined): string {
  if (!value) return "n/a"
  const minutes = Math.round(value / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
