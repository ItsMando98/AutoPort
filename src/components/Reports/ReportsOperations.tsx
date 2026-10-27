import { RefreshCw, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { cn } from "@/src/lib/utils"
import type { DataSourceStatus } from "@/src/lib/api"

const RECOVERY_NOTES = [
  'Submitted orders older than about 2 minutes are treated as stale.',
  'If thesis and limits still pass, stale orders are autonomously resubmitted on the remaining quantity.',
  'Partially filled orders older than about 5 minutes are either resubmitted on the remainder or cancelled and preserved as partial outcomes.',
]

export function ReportsOperations({ dataSources }: { dataSources: DataSourceStatus[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4 text-blue-400" />
            Data Freshness
          </CardTitle>
          <CardDescription>Backend data-source heartbeat</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {dataSources.length === 0 ? (
            <p className="text-sm text-zinc-500">No data-source telemetry yet.</p>
          ) : dataSources.slice(0, 8).map(source => (
            <div key={source.source} className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">{source.source}</span>
              <span className={cn(
                "text-xs font-medium",
                source.status === 'ok' ? "text-emerald-400" : source.status === 'error' ? "text-red-400" : "text-amber-400"
              )}>
                {source.status}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-yellow-400" />
            Recovery Notes
          </CardTitle>
          <CardDescription>Autonomous safeguards for stuck broker execution</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-300">
          {RECOVERY_NOTES.map(line => (
            <div key={line} className="rounded-md bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
              {line}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
