import { BarChart3, Target, Shield, TrendingUp } from "lucide-react"
import { Badge } from "@/src/components/ui/badge"
import { format } from "date-fns"
import { StatGrid } from "./StatGrid"

export function ReportsOverview({
  operatorSummary,
  totalValue,
  totalReturn,
  unrealizedPnL,
  openPositions,
  totalTrades,
  buys,
  sells,
  riskBlocked,
  riskTotal,
}: {
  operatorSummary: string | undefined
  totalValue: number
  totalReturn: number
  unrealizedPnL: number
  openPositions: number
  totalTrades: number
  buys: number
  sells: number
  riskBlocked: number
  riskTotal: number
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Reports</h2>
          <p className="text-sm text-zinc-400">
            {operatorSummary ?? `Performance summary • Generated ${format(new Date(), 'MMM d, yyyy HH:mm')}`}
          </p>
        </div>
        <Badge variant={totalReturn >= 0 ? 'success' : 'destructive'} className="text-sm px-3 py-1">
          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}% Total Return
        </Badge>
      </div>

      <StatGrid
        items={[
          {
            label: "Portfolio Value",
            value: `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            sub: `${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% vs $100k start`,
            icon: BarChart3, ok: totalReturn >= 0,
          },
          {
            label: "Unrealized P&L",
            value: `${unrealizedPnL >= 0 ? '+' : ''}$${Math.abs(unrealizedPnL).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            sub: `${openPositions} open positions`,
            icon: TrendingUp, ok: unrealizedPnL >= 0,
          },
          {
            label: "Total Trades",
            value: `${totalTrades}`,
            sub: `${buys} BUY / ${sells} SELL`,
            icon: Target, ok: true,
          },
          {
            label: "Risk Blocks",
            value: `${riskBlocked}`,
            sub: `of ${riskTotal} risk checks`,
            icon: Shield, ok: true,
          },
        ]}
      />
    </>
  )
}
