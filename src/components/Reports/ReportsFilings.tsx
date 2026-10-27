import { FileText } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import type { FilingRecordSummary } from "@/src/lib/api"

export function ReportsFilings({ filings }: { filings: FilingRecordSummary[] }) {
  if (filings.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-orange-400" />
          Recent SEC 8-K Filings (Material Events)
        </CardTitle>
        <CardDescription>Official company disclosures — analyzed by the agent as priority news</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {filings.map(f => (
            <div key={f.id} className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm",
              f.processed ? "bg-zinc-900/30" : "bg-orange-950/30 border border-orange-500/20"
            )}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-bold text-zinc-50 w-12">{f.symbol}</span>
                <Badge variant={f.processed ? "secondary" : "warning"} className="text-xs">
                  {f.form}
                </Badge>
                <span className="text-zinc-300 text-xs truncate">{f.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-zinc-500 text-xs">{f.filed}</span>
                <Badge variant={f.processed ? "secondary" : "default"} className="text-xs">
                  {f.processed ? "analyzed" : "pending"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
