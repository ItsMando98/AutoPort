import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import {
  Play, TrendingUp, TrendingDown, Target, BarChart3,
  ArrowUpRight, ArrowDownRight, Clock, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle
} from "lucide-react"
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Legend, Line, ComposedChart
} from "recharts"
import { cn } from "@/src/lib/utils"
import { api } from "@/src/lib/api"
import { useState, useEffect } from "react"
import { format } from "date-fns"

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  positive?: boolean
  negative?: boolean
  neutral?: boolean
}
function MetricCard({ label, value, sub, positive, negative, neutral }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="text-xs text-zinc-400 mb-1">{label}</div>
        <div className={cn(
          "text-xl font-bold",
          positive ? "text-emerald-400" : negative ? "text-red-400" : "text-zinc-50"
        )}>{value}</div>
        {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function Backtest() {
  const [config, setConfig] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [error, setError]    = useState<string | null>(null)

  useEffect(() => {
    api.getReplayDefaultConfig().then(c => {
      if (c) setConfig(c)
    })
  }, [])

  const handleRun = async () => {
    if (!config) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const r = await api.runReplay(config)
      if (r) setResult(r)
      else setError('Replay returned no results')
    } catch {
      setError('Replay failed — check console')
    } finally {
      setRunning(false)
    }
  }

  const updateConfig = (key: string, value: any) =>
    setConfig((prev: any) => ({ ...prev, [key]: value }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Replay Engine</h2>
        <p className="text-sm text-zinc-400">
          Replay stored research events through the same candidate and sizing pipeline as the live agent.
        </p>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-zinc-400" />
            Strategy Configuration
          </CardTitle>
          <CardDescription>
            Mode: research replay · stored events to deterministic candidates to sizing to exits
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!config ? (
            <p className="text-sm text-zinc-500">Loading config...</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {/* Date range */}
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Start Date</label>
                <input type="date" value={config.startDate}
                  onChange={e => updateConfig('startDate', e.target.value)}
                  className="w-full rounded-md bg-zinc-800 border border-zinc-700 text-zinc-50 text-sm px-2 py-1.5 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">End Date</label>
                <input type="date" value={config.endDate}
                  onChange={e => updateConfig('endDate', e.target.value)}
                  className="w-full rounded-md bg-zinc-800 border border-zinc-700 text-zinc-50 text-sm px-2 py-1.5 focus:outline-none focus:border-zinc-500"
                />
              </div>
              {/* Sliders */}
              {[
                { key: 'stopLossPct',      label: 'Stop-Loss',        fmt: (v: number) => `${(v*100).toFixed(0)}%`,   min: -0.15, max: -0.03, step: 0.01 },
                { key: 'maxPositions',     label: 'Max Positions',    fmt: (v: number) => `${v}`,                     min: 3,     max: 15,   step: 1    },
                { key: 'researchWindowHours', label: 'Research Window', fmt: (v: number) => `${v}h`,                min: 24,    max: 168,  step: 12   },
                { key: 'minCandidateConfidence', label: 'Min Confidence', fmt: (v: number) => `${v}%`,              min: 50,    max: 85,   step: 5    },
              ].map(({ key, label, fmt, min, max, step }) => (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">{label}</span>
                    <span className="text-zinc-300 font-mono">{fmt(config[key])}</span>
                  </div>
                  <input type="range" min={min} max={max} step={step} value={config[key]}
                    onChange={e => updateConfig(key, parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={handleRun}
              disabled={running || !config}
              className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
            >
              {running
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Running...</>
                : <><Play className="h-4 w-4" /> Run Replay</>
              }
            </Button>
            {result && (
              <span className="text-xs text-zinc-500">
                Completed in {result.runDurationMs}ms · {result.tradingDays} days · {result.symbolsCovered} symbols · {result.researchEventsCovered} events · {result.candidateCount} candidates
              </span>
            )}
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Metrics row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <MetricCard
              label="Total Return"
              value={`${result.metrics.totalReturn >= 0 ? '+' : ''}${result.metrics.totalReturn.toFixed(1)}%`}
              sub="vs $100k start"
              positive={result.metrics.totalReturn > 0}
              negative={result.metrics.totalReturn < 0}
            />
            <MetricCard
              label="SPY Return"
              value={`${result.metrics.spyReturn >= 0 ? '+' : ''}${result.metrics.spyReturn.toFixed(1)}%`}
              sub="buy-and-hold"
            />
            <MetricCard
              label="Alpha"
              value={`${result.metrics.alpha >= 0 ? '+' : ''}${result.metrics.alpha.toFixed(1)}%`}
              sub="vs benchmark"
              positive={result.metrics.alpha > 0}
              negative={result.metrics.alpha < 0}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={result.metrics.sharpe !== null ? result.metrics.sharpe.toFixed(2) : '—'}
              sub={result.metrics.sharpe === null ? 'Need more data' : 'annualized'}
              positive={result.metrics.sharpe !== null && result.metrics.sharpe >= 1}
            />
            <MetricCard
              label="Win Rate"
              value={result.metrics.winRate !== null ? `${result.metrics.winRate.toFixed(0)}%` : '—'}
              sub={`of ${Math.floor(result.trades.filter((t: any) => t.action === 'SELL').length)} closes`}
              positive={result.metrics.winRate !== null && result.metrics.winRate >= 50}
            />
            <MetricCard
              label="Max Drawdown"
              value={`-${result.metrics.maxDrawdown.toFixed(1)}%`}
              sub="from peak"
              negative={result.metrics.maxDrawdown > 10}
            />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Profit Factor"
              value={result.metrics.profitFactor !== null ? result.metrics.profitFactor.toFixed(2) : '—'}
              sub="wins / losses"
              positive={result.metrics.profitFactor !== null && result.metrics.profitFactor > 1}
            />
            <MetricCard
              label="Total Trades"
              value={String(result.metrics.totalTrades)}
              sub={`${result.trades.filter((t: any) => t.action === 'BUY').length} buys · ${result.trades.filter((t: any) => t.action === 'SELL').length} sells`}
            />
            <MetricCard
              label="Avg Hold Days"
              value={result.metrics.avgHoldDays !== null ? `${result.metrics.avgHoldDays}d` : '—'}
              sub="per position"
            />
            {result.metrics.bestTrade && (
              <MetricCard
                label="Best Trade"
                value={`${result.metrics.bestTrade.symbol} +${result.metrics.bestTrade.returnPct}%`}
                sub="highest single return"
                positive
              />
            )}
          </div>

          {result.diagnostics && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-zinc-400" />
                  Replay Diagnostics
                </CardTitle>
                <CardDescription>Why replay candidates executed or were skipped</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {[
                    { label: 'Actionable', value: result.diagnostics.actionableCandidates },
                    { label: 'Low/Neutral', value: result.diagnostics.neutralOrLowConfidence },
                    { label: 'No Data', value: result.diagnostics.dataUnavailable },
                    { label: 'Pos Limits', value: result.diagnostics.blockedByPositionLimit },
                    { label: 'No Position', value: result.diagnostics.blockedByNoPosition },
                    { label: 'Sizing', value: result.diagnostics.blockedBySizing },
                    { label: 'Buy Fills', value: result.diagnostics.executedBuys },
                    { label: 'Sell Fills', value: result.diagnostics.executedSells },
                    { label: 'Stop-Losses', value: result.diagnostics.stopLossExits },
                  ].map(item => (
                    <div key={item.label} className="rounded-md bg-zinc-900/40 px-3 py-3">
                      <div className="text-[11px] text-zinc-500">{item.label}</div>
                      <div className="mt-1 text-lg font-semibold text-zinc-50">{item.value}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chart: Research Replay vs SPY */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-zinc-400" />
                Research Replay vs SPY — {result.config.startDate} to {result.config.endDate}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={result.dailyValues}>
                    <defs>
                      <linearGradient id="gradPortfolio" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradSPY" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      stroke="#52525b"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={d => d.slice(5)} // MM-DD
                      interval={Math.floor(result.dailyValues.length / 8)}
                    />
                    <YAxis
                      stroke="#52525b"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      domain={['dataMin - 2000', 'dataMax + 2000']}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#fafafa' }}
                      formatter={(value: number, name: string) => [
                        `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        name === 'value' ? 'Portfolio' : 'SPY',
                      ]}
                      labelFormatter={d => `Date: ${d}`}
                    />
                    <Legend
                      formatter={(v) => v === 'value' ? 'Portfolio' : 'SPY Buy & Hold'}
                      wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }}
                    />
                    <Area
                      type="monotone" dataKey="value"
                      stroke="#10b981" strokeWidth={2}
                      fill="url(#gradPortfolio)" fillOpacity={1}
                    />
                    <Line
                      type="monotone" dataKey="spyValue"
                      stroke="#6366f1" strokeWidth={1.5}
                      dot={false} strokeDasharray="4 2"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Trade History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trade History ({result.trades.length} total)</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-400 sticky top-0">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-4 py-2">Action</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Shares</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                    <th className="px-4 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {result.trades.map((t: any, i: number) => (
                    <tr key={i} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-1.5 text-zinc-400 font-mono text-xs">{t.date}</td>
                      <td className="px-4 py-1.5 font-bold text-zinc-50">{t.symbol}</td>
                      <td className="px-4 py-1.5">
                        <Badge variant={t.action === 'BUY' ? 'success' : 'destructive'} className="text-[10px]">
                          {t.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-zinc-300">${t.price.toFixed(2)}</td>
                      <td className="px-4 py-1.5 text-right text-zinc-400">{t.shares}</td>
                      <td className="px-4 py-1.5 text-right">
                        {t.returnPct !== undefined ? (
                          <span className={cn(
                            "font-mono text-xs font-medium",
                            t.returnPct >= 0 ? "text-emerald-400" : "text-red-400"
                          )}>
                            {t.returnPct >= 0 ? '+' : ''}{t.returnPct.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-zinc-500 text-xs truncate max-w-48">{t.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Empty state */}
      {!result && !running && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center space-y-3">
          <BarChart3 className="h-12 w-12 text-zinc-700 mx-auto" />
          <p className="text-zinc-400 font-medium">Configure and run your first research replay</p>
          <p className="text-sm text-zinc-600 max-w-md mx-auto">
            Replays normalized research events against historical price data using the shared
            candidate composition and sizing rules from the backend agent.
          </p>
        </div>
      )}
    </div>
  )
}
