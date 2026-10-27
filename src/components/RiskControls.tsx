import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import {
  ShieldAlert, AlertCircle, TrendingDown, Wallet, PieChart,
  AlertTriangle, CheckCircle2, XCircle, PowerOff, RefreshCw, Calendar
} from "lucide-react"
import { cn } from "@/src/lib/utils"
import { usePaperTrading } from "@/src/context/PaperTradingContext"
import { useMarketData } from "@/src/context/MarketDataContext"
import { useAutoTrading } from "@/src/context/AutoTradingContext"
import { api } from "@/src/lib/api"
import { useState, useEffect, useMemo } from "react"
import { formatDistanceToNow } from "date-fns"

// Risk limits (must match server/risk.ts LIMITS)
const LIMITS = {
  maxPositionPct:    0.15,
  maxSectorPct:      0.30,
  maxInvestedPct:    0.90,
  minCashReservePct: 0.10,
  dailyLossLimit:   -0.03,
  portfolioDrawdown:-0.15,
  stopLossPct:      -0.08,
  startingCapital:   100_000,
}

const SECTORS: Record<string, string> = {
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology',
  GOOGL: 'Technology', META: 'Technology', AMD: 'Technology',
  INTC: 'Technology', CRWD: 'Technology',
  AMZN: 'Consumer Discretionary', TSLA: 'Consumer Discretionary',
  PLTR: 'Technology',
}

function GaugeBar({
  label, value, limit, format = (v: number) => `${v.toFixed(1)}%`, danger = false
}: {
  label: string; value: number; limit: number;
  format?: (v: number) => string; danger?: boolean;
}) {
  const pct = Math.min((value / limit) * 100, 100)
  const isOver = value > limit
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className={cn("font-mono", isOver ? "text-red-400" : "text-zinc-400")}>
          {format(value)} <span className="text-zinc-600">/ {format(limit)}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full transition-all", danger || isOver ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-blue-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function RiskControls() {
  const { cashBalance, positions } = usePaperTrading()
  const { marketData } = useMarketData()
  const { isAutoTrading, setIsAutoTrading, engineTogglePending } = useAutoTrading()
  const [riskEvents, setRiskEvents] = useState<any[]>([])
  const [upcomingEarnings, setUpcomingEarnings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getRiskEvents(20),
      api.getUpcomingEarnings(21),
    ]).then(([events, earnings]) => {
      setRiskEvents(events ?? [])
      setUpcomingEarnings(earnings ?? [])
      setLoading(false)
    })
  }, [])

  // ── Live portfolio metrics ─────────────────────────────────────────────────
  const currentPrices = useMemo(() => {
    const p: Record<string, number> = {}
    Object.values(marketData).forEach((d: any) => { if (d?.price) p[d.symbol] = d.price })
    return p
  }, [marketData])

  const totalValue = useMemo(() => {
    const invested = positions.reduce((sum, p) => {
      return sum + p.shares * (currentPrices[p.symbol] || p.avgPrice)
    }, 0)
    return cashBalance + invested
  }, [positions, cashBalance, currentPrices])

  const investedValue = totalValue - cashBalance
  const investedPct   = totalValue > 0 ? (investedValue / totalValue) * 100 : 0
  const cashPct       = totalValue > 0 ? (cashBalance  / totalValue) * 100 : 100
  const drawdown      = ((totalValue - LIMITS.startingCapital) / LIMITS.startingCapital) * 100
  const killActive    = drawdown <= LIMITS.portfolioDrawdown * 100

  // Sector exposures from real positions
  const sectorExposures = useMemo(() => {
    const map: Record<string, number> = {}
    for (const pos of positions) {
      const sector = SECTORS[pos.symbol] ?? 'Other'
      const val = pos.shares * (currentPrices[pos.symbol] || pos.avgPrice)
      map[sector] = (map[sector] ?? 0) + val
    }
    return Object.entries(map).map(([sector, val]) => ({
      sector,
      pct: totalValue > 0 ? (val / totalValue) * 100 : 0,
      limit: 30,
    })).sort((a, b) => b.pct - a.pct)
  }, [positions, currentPrices, totalValue])

  // Position-level risk: stop-loss proximity
  const positionRisks = useMemo(() => {
    return positions.map(pos => {
      const price = currentPrices[pos.symbol] || pos.avgPrice
      const pnlPct = ((price - pos.avgPrice) / pos.avgPrice) * 100
      const positionPct = totalValue > 0 ? ((pos.shares * price) / totalValue) * 100 : 0
      const stopLossTriggered = pnlPct <= LIMITS.stopLossPct * 100
      const nearStopLoss = pnlPct > LIMITS.stopLossPct * 100 && pnlPct < -4
      return { ...pos, price, pnlPct, positionPct, stopLossTriggered, nearStopLoss }
    })
  }, [positions, currentPrices, totalValue])

  const blockedTrades = riskEvents.filter((e: any) => !e.allowed).length
  const totalChecks   = riskEvents.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Risk Controls</h2>
          <p className="text-sm text-zinc-400">Live risk state — all limits enforced deterministically.</p>
        </div>
        <Button
          onClick={() => setIsAutoTrading(false)}
          disabled={!isAutoTrading || engineTogglePending}
          className={cn(
            "flex items-center gap-2",
            isAutoTrading
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          )}
        >
          <PowerOff className="h-4 w-4" />
          {isAutoTrading ? "Emergency Stop" : "Engine Stopped"}
        </Button>
      </div>

      {/* Kill switch warning */}
      {killActive && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/50 bg-red-950/30 p-4">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-300">Kill Switch Active</p>
            <p className="text-xs text-red-400/80">
              Portfolio drawdown {Math.abs(drawdown).toFixed(1)}% exceeds 15% limit. No new BUY orders.
            </p>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Portfolio Drawdown",
            value: `${drawdown >= 0 ? '+' : ''}${drawdown.toFixed(1)}%`,
            sub: `Limit: -15%`,
            ok: drawdown > -15,
            icon: TrendingDown,
          },
          {
            label: "Cash Reserve",
            value: `${cashPct.toFixed(1)}%`,
            sub: `Min: 10%`,
            ok: cashPct >= 10,
            icon: Wallet,
          },
          {
            label: "Total Invested",
            value: `${investedPct.toFixed(1)}%`,
            sub: `Max: 90%`,
            ok: investedPct <= 90,
            icon: PieChart,
          },
          {
            label: "Risk Blocks",
            value: `${blockedTrades}`,
            sub: `of ${totalChecks} checks`,
            ok: true,
            icon: ShieldAlert,
          },
        ].map(({ label, value, sub, ok, icon: Icon }) => (
          <Card key={label} className={cn("", !ok && "border-red-500/40")}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-400">{label}</span>
                <Icon className={cn("h-4 w-4", ok ? "text-zinc-500" : "text-red-400")} />
              </div>
              <div className={cn("text-xl font-bold", ok ? "text-zinc-50" : "text-red-400")}>{value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Portfolio Limits */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Portfolio Limits (Live)
            </CardTitle>
            <CardDescription>Current utilization vs. hard limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <GaugeBar
              label="Cash Reserve" value={cashPct}
              limit={LIMITS.minCashReservePct * 100}
              danger={cashPct < LIMITS.minCashReservePct * 100}
            />
            <GaugeBar
              label="Total Invested" value={investedPct}
              limit={LIMITS.maxInvestedPct * 100}
            />
            <GaugeBar
              label="Portfolio Drawdown" value={Math.abs(Math.min(drawdown, 0))}
              limit={Math.abs(LIMITS.portfolioDrawdown * 100)}
              danger={killActive}
            />
          </CardContent>
        </Card>

        {/* Sector Exposure */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              Sector Exposure (Actual)
            </CardTitle>
            <CardDescription>Max 30% per sector</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sectorExposures.length === 0 ? (
              <div className="space-y-3">
                {['Technology', 'Consumer Discretionary'].map(s => (
                  <div key={s}><GaugeBar label={s} value={0} limit={30} /></div>
                ))}
              </div>
            ) : sectorExposures.map(({ sector, pct, limit }) => (
              <div key={sector}><GaugeBar label={sector} value={pct} limit={limit} /></div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Position-level risk */}
      {positionRisks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-zinc-400" />
              Open Positions — Stop-Loss Status
            </CardTitle>
            <CardDescription>Auto-sell triggered at -8% from avg entry</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {positionRisks.map(pos => (
                <div key={pos.symbol}
                  className={cn(
                    "flex items-center justify-between rounded-md px-3 py-2 text-sm",
                    pos.stopLossTriggered ? "bg-red-950/40 border border-red-500/30"
                    : pos.nearStopLoss ? "bg-amber-950/30 border border-amber-500/20"
                    : "bg-zinc-900/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {pos.stopLossTriggered ? (
                      <XCircle className="h-4 w-4 text-red-400" />
                    ) : pos.nearStopLoss ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    <span className="font-medium text-zinc-50">{pos.symbol}</span>
                    <span className="text-zinc-400">{pos.shares} shares @ ${pos.avgPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-400 font-mono text-xs">{pos.positionPct.toFixed(1)}% of portfolio</span>
                    <span className={cn(
                      "font-mono font-medium",
                      pos.pnlPct >= 0 ? "text-emerald-400" : pos.stopLossTriggered ? "text-red-400" : "text-amber-400"
                    )}>
                      {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct.toFixed(1)}%
                    </span>
                    <Badge variant={
                      pos.stopLossTriggered ? "destructive" : pos.nearStopLoss ? "warning" : "success"
                    }>
                      {pos.stopLossTriggered ? "STOP-LOSS" : pos.nearStopLoss ? "NEAR LIMIT" : "OK"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Earnings Calendar */}
      {upcomingEarnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-purple-400" />
              Upcoming Earnings (next 21 days)
            </CardTitle>
            <CardDescription>BUYs blocked 1 day before earnings, warned 3 days before</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcomingEarnings.map((e: any) => {
                const isHeld = positions.some(p => p.symbol === e.symbol)
                return (
                  <div key={e.symbol + e.earningsDate}
                    className={cn(
                      "flex items-center justify-between rounded-md px-3 py-2 text-sm",
                      e.daysUntil <= 1 ? "bg-red-950/40 border border-red-500/30"
                      : e.daysUntil <= 3 ? "bg-amber-950/30 border border-amber-500/20"
                      : "bg-zinc-900/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-zinc-50 w-12">{e.symbol}</span>
                      <span className="text-zinc-400">
                        {new Date(e.earningsDate).toLocaleDateString()}
                      </span>
                      {isHeld && (
                        <Badge variant="warning" className="text-xs">held</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {e.epsEstimate && (
                        <span className="text-zinc-400 text-xs font-mono">EPS est. ${e.epsEstimate.toFixed(2)}</span>
                      )}
                      <Badge variant={e.daysUntil <= 1 ? "destructive" : e.daysUntil <= 3 ? "warning" : "secondary"}>
                        {e.daysUntil === 0 ? "Today" : `${e.daysUntil}d`}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Risk Engine Decisions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-zinc-400" />
              Risk Engine Audit Log
            </span>
            <span className="text-xs text-zinc-500 font-normal">Last 20 checks</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-4">Loading...</p>
          ) : riskEvents.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">
              No risk engine events yet. Start the engine to begin trading.
            </p>
          ) : (
            <div className="space-y-1.5">
              {riskEvents.map((e: any) => (
                <div key={e.id}
                  className={cn(
                    "flex items-center justify-between rounded px-3 py-2 text-xs",
                    e.allowed ? "bg-zinc-900" : "bg-red-950/30"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {e.allowed
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                      : <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                    }
                    <span className="font-medium text-zinc-300">{e.symbol ?? '—'}</span>
                    <span className={cn(e.action === 'BUY' ? 'text-emerald-400' : 'text-red-400')}>
                      {e.action}
                    </span>
                    <span className="text-zinc-500 truncate">{e.reason}</span>
                  </div>
                  <span className="text-zinc-600 shrink-0 ml-3">
                    {formatDistanceToNow(new Date(e.created_at * 1000), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
