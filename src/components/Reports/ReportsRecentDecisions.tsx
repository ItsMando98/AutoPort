import { FileText } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { EngineLog } from "@/src/context/AutoTradingContext"

export function ReportsRecentDecisions({ engineLogs }: { engineLogs: EngineLog[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-zinc-400" />
          Recent AI Decisions
        </CardTitle>
        <CardDescription>Last 10 engine log entries</CardDescription>
      </CardHeader>
      <CardContent>
        {engineLogs.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-4">
            No decisions yet. Enable auto-trading in Decision Engine.
          </p>
        ) : (
          <div className="space-y-2">
            {engineLogs.slice(0, 10).map(log => (
              <div key={log.id} className={cn(
                "rounded px-3 py-2 text-xs space-y-1",
                log.status === 'EXECUTED' ? "bg-emerald-950/30 border border-emerald-500/20"
                : log.status === 'REJECTED' ? "bg-red-950/30 border border-red-500/20"
                : "bg-zinc-900/50"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      log.type === 'DECISION' ? 'success'
                      : log.type === 'RISK_CHECK' ? 'warning'
                      : log.type === 'HYPOTHESIS' ? 'default'
                      : 'secondary'
                    } className="text-[10px]">
                      {log.type}
                    </Badge>
                    <span className="font-medium text-zinc-300">{log.asset}</span>
                  </div>
                  <span className="text-zinc-600">
                    {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-zinc-400 leading-relaxed">{log.content}</p>
                {log.action && <p className="text-zinc-500 italic">{log.action}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
