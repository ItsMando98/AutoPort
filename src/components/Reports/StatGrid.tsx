import type { ComponentType } from "react"
import { Card, CardContent } from "@/src/components/ui/card"
import { cn } from "@/src/lib/utils"

export interface StatGridItem {
  label: string
  value: string
  sub?: string
  icon?: ComponentType<{ className?: string }>
  ok?: boolean
}

/** Big card-wrapped stat row, e.g. the top-level Performance Overview. */
export function StatGrid({ items, columns = 4 }: { items: StatGridItem[]; columns?: 2 | 3 | 4 | 5 }) {
  const colsClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
    5: "sm:grid-cols-5",
  }[columns]

  return (
    <div className={cn("grid grid-cols-2 gap-3", colsClass)}>
      {items.map(({ label, value, sub, icon: Icon, ok = true }) => (
        <Card key={label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400">{label}</span>
              {Icon && <Icon className={cn("h-4 w-4", ok ? "text-emerald-500" : "text-red-400")} />}
            </div>
            <div className={cn("text-xl font-bold", ok ? "text-zinc-50" : "text-red-400")}>{value}</div>
            {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Compact inline stat boxes used inside other cards (Candidate Funnel, Execution Ops, Fill Quality, ...). */
export function MiniStatGrid({ items, columns = 4 }: { items: Array<{ label: string; value: string | number }>; columns?: 3 | 4 }) {
  return (
    <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-4")}>
      {items.map(item => (
        <div key={item.label} className="rounded-md bg-zinc-900/40 px-2 py-2 text-center">
          <div className="text-[10px] text-zinc-500">{item.label}</div>
          <div className="text-sm font-semibold text-zinc-50">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
