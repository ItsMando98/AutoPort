import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { ArrowDownRight, ArrowUpRight, DollarSign, TrendingUp, Activity, Target, BarChart3, Globe, Waves } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/src/lib/utils"
import { Skeleton } from "@/src/components/ui/skeleton"
import { usePaperTrading } from "@/src/context/PaperTradingContext"
import { useMarketData } from "@/src/context/MarketDataContext"
import { api, type AutonomyDecision } from "@/src/lib/api"
import { useMemo, useState, useEffect } from "react"

function isStaleDate(dateStr: string, maxAgeDays = 2) {
  const date = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(date)) return false;
  return Date.now() - date > maxAgeDays * 24 * 60 * 60 * 1000;
}

function formatCompactCurrency(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`
  if (abs >= 100_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${(value / 1_000).toFixed(1)}k`
}

export function Dashboard() {
  const { cashBalance, positions, getPortfolioValue } = usePaperTrading();
  const { marketData } = useMarketData();
  const [metrics, setMetrics] = useState<any>(null);
  const [history, setHistory]  = useState<{ time: string; value: number }[]>([]);
  const [macroRegime, setMacroRegime] = useState<{ regime: string; vixLevel: number | null; yieldCurve: number | null; reasoning: string | null } | null>(null);
  const [breadth, setBreadth] = useState<{ ad_ratio: number | null; hl_ratio: number | null; observation_date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [macroLoading, setMacroLoading] = useState(true);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [autonomyDecisions, setAutonomyDecisions] = useState<AutonomyDecision[]>([]);

  useEffect(() => {
    api.getPerformanceMetrics().then(m => { setMetrics(m); setLoading(false); });
    api.getPerformanceHistory().then(h => {
      if (h && h.length > 0) {
        setHistory(h.map((p: any) => ({ time: p.date, value: p.value })));
      }
    });
    api.getMacroRegime().then(r => { setMacroRegime(r); setMacroLoading(false); });
    api.getMarketBreadth(1).then(rows => { setBreadth(rows?.[0] ?? null); setBreadthLoading(false); });
    api.getAutonomyDecisions(undefined, 60).then(res => setAutonomyDecisions(res?.decisions ?? []));
  }, []);

  const decisionBySymbol = useMemo(() => {
    const map: Record<string, AutonomyDecision | undefined> = {};
    for (const decision of autonomyDecisions) {
      if (!map[decision.symbol]) map[decision.symbol] = decision;
    }
    return map;
  }, [autonomyDecisions]);

  const currentPrices = useMemo(() => {
    const prices: Record<string, number> = {};
    Object.values(marketData).forEach((data: any) => {
      prices[data.symbol] = data.price;
    });
    return prices;
  }, [marketData]);

  const totalValue   = metrics?.currentValue ?? getPortfolioValue(currentPrices);
  const totalReturn  = metrics?.totalReturnPct ?? ((totalValue - 100000) / 100000) * 100;

  const openPositionCount = metrics?.openPositions?.length ?? positions.length

  // Chart: use backend history if available, else keep an honest start vs now baseline.
  const chartData = useMemo(() => {
    if (history.length >= 2) return history;
    return [
      { time: 'Start', value: 100000 },
      { time: 'Now', value: Math.round(totalValue) },
    ];
  }, [history, totalValue]);

  const topHoldings = useMemo(() => {
    // Signal badge reflects the real committee decision (same source as the
    // "Committee" tab in Decision Engine), not a P&L-derived guess — a
    // position up 20% might still be a genuine BUY per the agent's thesis.
    const signalFor = (symbol: string) => decisionBySymbol[symbol]?.action ?? 'HOLD';

    // Prefer backend open positions with current prices
    const openPos = metrics?.openPositions ?? [];
    if (openPos.length > 0) {
      return openPos.map((p: any) => ({
        symbol:  p.symbol,
        name:    marketData[p.symbol]?.name ?? p.symbol,
        weight:  totalValue > 0 ? ((Math.abs(p.currentPrice * p.shares)) / totalValue * 100).toFixed(1) : '0.0',
        return:  p.unrealizedPct.toFixed(2),
        signal:  signalFor(p.symbol),
        side:    p.shares < 0 ? 'Short' : 'Long',
      }));
    }
    return positions.map(pos => {
      const cp     = currentPrices[pos.symbol] || pos.avgPrice;
      const weight = totalValue > 0 ? ((Math.abs(pos.shares * cp)) / totalValue * 100) : 0;
      const ret    = pos.shares < 0 ? ((pos.avgPrice - cp) / pos.avgPrice) * 100 : ((cp - pos.avgPrice) / pos.avgPrice) * 100;
      return {
        symbol:  pos.symbol,
        name:    marketData[pos.symbol]?.name ?? pos.symbol,
        weight:  weight.toFixed(1),
        return:  ret.toFixed(2),
        signal:  signalFor(pos.symbol),
        side:    pos.shares < 0 ? 'Short' : 'Long',
      };
    }).sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)).slice(0, 5);
  }, [metrics, positions, currentPrices, totalValue, marketData, decisionBySymbol]);

  const winRate     = metrics?.winRate ?? null;
  const sharpe      = metrics?.sharpeRatio ?? null;
  const alpha       = metrics?.alphaPct ?? null;
  const maxDD       = metrics?.maxDrawdownPct ?? Math.abs(Math.min(totalReturn, 0));
  const profitFactor = metrics?.profitFactor ?? null;

  return (
    <div className="space-y-6">
      {/* Row 1: Core metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Portfolio Value</CardTitle>
            <DollarSign className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-28" /> : (
              <div className="text-2xl font-bold text-zinc-50">${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            )}
            {loading ? <Skeleton className="mt-2 h-4 w-24" /> : (
              <p className={cn("mt-1 flex items-center text-sm", totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
                {totalReturn >= 0 ? <ArrowUpRight className="mr-1 h-4 w-4" /> : <ArrowDownRight className="mr-1 h-4 w-4" />}
                {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}% vs $100k
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Win Rate</CardTitle>
            <Target className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold text-zinc-50">
                {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
              </div>
            )}
            {loading ? <Skeleton className="mt-2 h-4 w-24" /> : (
              <p className="mt-1 text-sm text-zinc-400">
                {metrics?.totalTrades ?? 0} closed trades
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Sharpe Ratio</CardTitle>
            <TrendingUp className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-16" /> : (
              <div className={cn("text-2xl font-bold",
                sharpe === null ? "text-zinc-500"
                : sharpe >= 1 ? "text-emerald-400"
                : sharpe >= 0 ? "text-zinc-50"
                : "text-red-400"
              )}>
                {sharpe !== null ? sharpe.toFixed(2) : '—'}
              </div>
            )}
            {loading ? <Skeleton className="mt-2 h-4 w-24" /> : (
              <p className="mt-1 text-sm text-zinc-400">
                {sharpe === null ? 'Need 10+ snapshots' : 'Annualized'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Alpha vs SPY</CardTitle>
            <Activity className="h-4 w-4 text-zinc-400" />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-20" /> : (
              <div className={cn("text-2xl font-bold",
                alpha === null ? "text-zinc-500" : alpha >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {alpha !== null ? `${alpha >= 0 ? '+' : ''}${alpha.toFixed(1)}%` : '—'}
              </div>
            )}
            {loading ? <Skeleton className="mt-2 h-4 w-24" /> : (
              <p className="mt-1 text-sm text-zinc-400">
                {metrics?.spyReturnPct !== null && metrics?.spyReturnPct !== undefined
                  ? `SPY: ${metrics.spyReturnPct >= 0 ? '+' : ''}${metrics.spyReturnPct.toFixed(1)}%`
                  : 'vs S&P 500'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Secondary metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Max Drawdown', value: `${maxDD > 0 ? '-' : ''}${maxDD.toFixed(1)}%`, sub: 'from peak', bad: maxDD > 5 },
          { label: 'Profit Factor', value: profitFactor !== null ? profitFactor.toFixed(2) : '—', sub: '>1.0 = profitable', bad: false },
          { label: 'Open Positions', value: String(openPositionCount), sub: `${totalValue > 0 ? ((1 - cashBalance / totalValue) * 100).toFixed(1) : '0.0'}% invested`, bad: false },
        ].map(({ label, value, sub, bad }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-zinc-400 mb-1">{label}</div>
              <div className={cn("text-xl font-bold", bad ? "text-red-400" : "text-zinc-50")}>{value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 2b: Market context — macro regime & breadth */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-400">Macro Regime</span>
            </div>
            {macroLoading ? (
              <>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="mt-2 h-4 w-40" />
              </>
            ) : macroRegime ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xl font-bold capitalize",
                    macroRegime.regime === 'bull' ? "text-emerald-400" : macroRegime.regime === 'bear' ? "text-red-400" : "text-zinc-50"
                  )}>{macroRegime.regime}</span>
                  {macroRegime.vixLevel !== null && (
                    <Badge variant="outline" className="text-[10px]">VIX {macroRegime.vixLevel.toFixed(1)}</Badge>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 truncate" title={macroRegime.reasoning ?? undefined}>
                  {macroRegime.reasoning ?? (macroRegime.yieldCurve !== null ? `Yield curve ${macroRegime.yieldCurve.toFixed(2)}` : 'No reasoning available')}
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-zinc-500">—</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Waves className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-400">Market Breadth</span>
            </div>
            {breadthLoading ? (
              <>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="mt-2 h-4 w-28" />
              </>
            ) : breadth ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xl font-bold",
                    breadth.ad_ratio === null ? "text-zinc-500" : breadth.ad_ratio >= 1 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {breadth.ad_ratio !== null ? `${breadth.ad_ratio.toFixed(2)} A/D` : '—'}
                  </span>
                  {breadth.hl_ratio !== null && (
                    <Badge variant="outline" className="text-[10px]">H/L {breadth.hl_ratio.toFixed(2)}</Badge>
                  )}
                  {isStaleDate(breadth.observation_date) && (
                    <Badge variant="warning" className="text-[10px]">Stale</Badge>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{breadth.observation_date}</div>
              </>
            ) : (
              <div className="text-xl font-bold text-zinc-500">No data yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              Portfolio Value History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="time" 
                    stroke="#52525b" 
                    fontSize={12} 
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#52525b" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => formatCompactCurrency(value)}
                    domain={['dataMin - 1000', 'dataMax + 1000']}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#fafafa' }}
                    itemStyle={{ color: '#10b981' }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorValue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Top Holdings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topHoldings.length === 0 ? (
                <div className="text-sm text-zinc-500 text-center py-4">No active positions. Buy assets in the Market Monitor.</div>
              ) : topHoldings.map((holding) => (
                <div key={holding.symbol} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-50">{holding.symbol}</span>
                    <span className="text-xs text-zinc-400">{holding.name} • {holding.side}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-medium text-zinc-50">{holding.weight}%</span>
                      <span className={cn(
                        "text-xs flex items-center",
                        parseFloat(holding.return) >= 0 ? "text-emerald-400" : "text-red-400"
                      )}>
                        {parseFloat(holding.return) >= 0 ? <ArrowUpRight className="mr-1 h-3 w-3" /> : <ArrowDownRight className="mr-1 h-3 w-3" />}
                        {Math.abs(parseFloat(holding.return))}%
                      </span>
                    </div>
                    <Badge variant={
                      holding.signal === 'BUY' || holding.signal === 'ADD' ? 'success' :
                      holding.signal === 'SELL' || holding.signal === 'TRIM' || holding.signal === 'EXIT' ? 'destructive' : 'secondary'
                    }>
                      {holding.signal}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
