import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowDownLeft, ArrowUpRight, BriefcaseBusiness, RefreshCw, TrendingUp } from "lucide-react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Pill } from "@/src/components/ui/pill"
import { cn } from "@/src/lib/utils"
import { api, type CompanyRow, type HedgeFundChange, type HedgeFundHolding, type SmartMoneySummary } from "@/src/lib/api"

type SortKey = "manager" | "symbol" | "value" | "change"

export function SmartMoney() {
  const [summary, setSummary] = useState<SmartMoneySummary>({ topBuys: [], topSells: [] })
  const [changes, setChanges] = useState<HedgeFundChange[]>([])
  const [overlap, setOverlap] = useState<any[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>("")
  const [symbolHoldings, setSymbolHoldings] = useState<HedgeFundHolding[]>([])
  const [sortKey, setSortKey] = useState<SortKey>("value")
  const [ascending, setAscending] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [nextSummary, nextChanges, nextOverlap, nextCompanies] = await Promise.all([
      api.getSmartMoneySummary(),
      api.getHedgeFundChanges(undefined, 80),
      api.getHedgeFundOverlap(3),
      api.getCompanies(),
    ])
    setSummary(nextSummary)
    setChanges(nextChanges)
    setOverlap(nextOverlap)
    setCompanies(nextCompanies)
    const defaultSymbol = nextSummary.topBuys[0]?.ticker ?? nextChanges[0]?.ticker ?? ""
    setSelectedSymbol(current => current || defaultSymbol || "")
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!selectedSymbol) return
    api.getHedgeFundSymbol(selectedSymbol).then(setSymbolHoldings)
  }, [selectedSymbol])

  const companyBySymbol = useMemo(
    () => Object.fromEntries(companies.map(company => [company.symbol, company])),
    [companies],
  )

  const sectorFlow = useMemo(() => {
    const totals = new Map<string, number>()
    for (const change of changes) {
      if (!change.ticker) continue
      const sector = companyBySymbol[change.ticker]?.sector ?? "Other"
      const direction = change.change_type === "new" || change.change_type === "added" ? 1 : -1
      totals.set(sector, (totals.get(sector) ?? 0) + direction * Number(change.current_value_thousands ?? 0))
    }
    return [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] ?? ["Other", 0]
  }, [changes, companyBySymbol])

  const sortedChanges = useMemo(() => {
    const items = [...changes]
    items.sort((a, b) => {
      const direction = ascending ? 1 : -1
      if (sortKey === "manager") return direction * String(a.manager_name).localeCompare(String(b.manager_name))
      if (sortKey === "symbol") return direction * String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""))
      if (sortKey === "change") return direction * ((a.pct_change ?? 0) - (b.pct_change ?? 0))
      return direction * ((a.current_value_thousands ?? 0) - (b.current_value_thousands ?? 0))
    })
    return items
  }, [ascending, changes, sortKey])

  const sparklineData = useMemo(() => {
    const totals = new Map<string, number>()
    for (const holding of symbolHoldings) {
      const period = holding.period_of_report
      totals.set(period, (totals.get(period) ?? 0) + Number(holding.value_thousands ?? 0))
    }
    return [...totals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-4)
      .map(([period, value]) => ({
        period: period.slice(0, 7),
        value,
      }))
  }, [symbolHoldings])

  const holders = useMemo(() => {
    const latestPeriod = symbolHoldings[0]?.period_of_report
    return latestPeriod
      ? symbolHoldings.filter(holding => holding.period_of_report === latestPeriod)
      : []
  }, [symbolHoldings])

  const convictionAdds = summary.topBuys.filter(item => item.fund_count >= 3).length
  const convictionExits = summary.topSells.filter(item => item.fund_count >= 3).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Smart Money</h2>
          <p className="text-sm text-zinc-400">13F-driven conviction, overlap, and fund-level position changes.</p>
        </div>
        <Button onClick={load} variant="outline" className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Stocks Added By 3+ Funds"
          value={String(convictionAdds)}
          detail={summary.topBuys[0] ? `${summary.topBuys[0].ticker} leads this quarter` : "No conviction buys yet"}
          icon={<ArrowUpRight className="h-4 w-4 text-emerald-400" />}
        />
        <SummaryCard
          title="Stocks Exited By 3+ Funds"
          value={String(convictionExits)}
          detail={summary.topSells[0] ? `${summary.topSells[0].ticker} is the largest coordinated exit` : "No coordinated exits yet"}
          icon={<ArrowDownLeft className="h-4 w-4 text-red-400" />}
        />
        <SummaryCard
          title="Net Smart Money Sector"
          value={sectorFlow[0]}
          detail={`${sectorFlow[1] >= 0 ? "+" : "-"}$${Math.abs(Number(sectorFlow[1] ?? 0)).toLocaleString()}k notional tilt`}
          icon={<TrendingUp className="h-4 w-4 text-sky-400" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Significant Changes</CardTitle>
                <CardDescription>Quarterly adds, reductions, initiations, and exits across tracked managers.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <SortButton label="Manager" active={sortKey === "manager"} onClick={() => toggleSort("manager", sortKey, ascending, setSortKey, setAscending)} />
                <SortButton label="Symbol" active={sortKey === "symbol"} onClick={() => toggleSort("symbol", sortKey, ascending, setSortKey, setAscending)} />
                <SortButton label="Value" active={sortKey === "value"} onClick={() => toggleSort("value", sortKey, ascending, setSortKey, setAscending)} />
                <SortButton label="Change %" active={sortKey === "change"} onClick={() => toggleSort("change", sortKey, ascending, setSortKey, setAscending)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-zinc-900/70 text-zinc-400">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Manager</th>
                    <th className="px-4 py-3 text-left font-medium">Symbol</th>
                    <th className="px-4 py-3 text-left font-medium">Move</th>
                    <th className="px-4 py-3 text-right font-medium">Value</th>
                    <th className="px-4 py-3 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 bg-zinc-950/60">
                  {sortedChanges.slice(0, 18).map(change => (
                    <tr
                      key={`${change.manager_id}-${change.period_of_report}-${change.ticker}-${change.change_type}`}
                      className="cursor-pointer transition hover:bg-zinc-900/60"
                      onClick={() => change.ticker && setSelectedSymbol(change.ticker)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">{change.manager_name}</div>
                        <div className="text-xs uppercase text-zinc-500">{change.manager_style}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-100">{change.ticker ?? "N/A"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={change.change_type === "new" || change.change_type === "added" ? "success" : "destructive"}>
                          {change.change_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-200">${Number(change.current_value_thousands ?? 0).toLocaleString()}k</td>
                      <td className={cn("px-4 py-3 text-right font-medium", (change.pct_change ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {change.pct_change === null ? "New" : `${(change.pct_change * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BriefcaseBusiness className="h-5 w-5 text-zinc-400" />
                Symbol Detail
              </CardTitle>
              <CardDescription>{selectedSymbol || "Select a symbol from the table or conviction lists."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {summary.topBuys.slice(0, 5).map(item => (
                  <Pill
                    key={item.ticker}
                    onClick={() => setSelectedSymbol(item.ticker)}
                    active={selectedSymbol === item.ticker}
                    activeClassName="border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    className={selectedSymbol !== item.ticker ? "bg-zinc-900 text-zinc-300" : undefined}
                  >
                    {item.ticker}
                  </Pill>
                ))}
              </div>

              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparklineData}>
                    <XAxis dataKey="period" stroke="#71717a" />
                    <YAxis stroke="#71717a" tickFormatter={(value) => `$${Math.round(value / 1000)}M`} />
                    <Tooltip
                      contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12 }}
                      formatter={(value: number) => [`$${value.toLocaleString()}k`, "Total Value"]}
                    />
                    <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {holders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
                    No resolved holdings loaded for this symbol yet.
                  </div>
                ) : (
                  holders.map(holding => (
                    <div key={`${holding.manager_id}-${holding.period_of_report}`} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                      <div>
                        <div className="font-medium text-zinc-100">{holding.manager_name}</div>
                        <div className="text-xs uppercase text-zinc-500">{holding.manager_style}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-zinc-100">{Number(holding.shares).toLocaleString()} shares</div>
                        <div className="text-xs text-zinc-500">${Number(holding.value_thousands).toLocaleString()}k</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overlap Conviction</CardTitle>
              <CardDescription>Symbols held by at least three tracked managers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {overlap.slice(0, 8).map(item => (
                <button
                  key={item.ticker}
                  onClick={() => setSelectedSymbol(item.ticker)}
                  className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left transition hover:border-zinc-700"
                >
                  <div>
                    <div className="font-medium text-zinc-100">{item.ticker}</div>
                    <div className="text-xs text-zinc-500">{item.fund_count} funds</div>
                  </div>
                  <div className="text-sm text-zinc-300">${Number(item.total_value_thousands ?? 0).toLocaleString()}k</div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {icon}
        </div>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight text-zinc-50">{value}</div>
      </CardContent>
    </Card>
  )
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Pill onClick={onClick} active={active}>
      {label}
    </Pill>
  )
}

function toggleSort(
  nextKey: SortKey,
  currentKey: SortKey,
  ascending: boolean,
  setSortKey: (value: SortKey) => void,
  setAscending: (value: boolean) => void,
) {
  if (nextKey === currentKey) {
    setAscending(!ascending)
    return
  }
  setSortKey(nextKey)
  setAscending(false)
}
