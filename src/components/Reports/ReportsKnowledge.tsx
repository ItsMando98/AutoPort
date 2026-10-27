import { useState } from "react"
import { BookOpen, TrendingUp as TrendUp, TrendingDown, Zap, BarChart3, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { format } from "date-fns"
import { api, type KnowledgeProfile, type KnowledgeStatusRow } from "@/src/lib/api"
import { pollUntilChanged } from "./utils"

export function ReportsKnowledge({
  profiles,
  status,
  onUpdate,
}: {
  profiles: Record<string, KnowledgeProfile>
  status: KnowledgeStatusRow[]
  onUpdate: (profiles: Record<string, KnowledgeProfile>, status: KnowledgeStatusRow[]) => void
}) {
  const [consolidating, setConsolidating] = useState(false)

  const handleConsolidateAll = async () => {
    setConsolidating(true)
    const beforeSnapshot = JSON.stringify(status)
    await api.triggerConsolidation()
    const freshStatus = await pollUntilChanged(
      () => api.getKnowledgeStatus(),
      rows => JSON.stringify(rows) !== beforeSnapshot,
      { intervalMs: 1000, timeoutMs: 15000 }
    )
    const freshProfiles = await api.getKnowledgeProfiles()
    onUpdate(freshProfiles ?? {}, freshStatus ?? [])
    setConsolidating(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-indigo-400" />
              AI Knowledge Base
            </CardTitle>
            <CardDescription>
              Compound investment profiles built from accumulated analyses. Injected into every Gemini prompt.
            </CardDescription>
          </div>
          <button
            onClick={handleConsolidateAll}
            disabled={consolidating}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", consolidating && "animate-spin")} />
            {consolidating ? "Consolidating..." : "Consolidate All"}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {status.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-4">
            {status.slice(0, 4).map(s => (
              <div key={s.symbol} className={cn(
                "rounded-md px-3 py-2 text-xs",
                s.hasProfile ? "bg-indigo-950/40 border border-indigo-500/30" : "bg-zinc-900"
              )}>
                <div className="font-medium text-zinc-50">{s.symbol}</div>
                <div className="text-zinc-400">{s.analyses} analyses</div>
                <div className={cn("mt-0.5 font-medium", s.hasProfile ? "text-indigo-400" : "text-zinc-600")}>
                  {s.hasProfile ? `Profile v${s.lastConsolidated}` : s.analyses >= 5 ? "Ready to consolidate" : `${5 - s.analyses} more needed`}
                </div>
              </div>
            ))}
          </div>
        )}

        {Object.keys(profiles).length === 0 ? (
          <div className="text-center py-8 space-y-2">
            <BookOpen className="h-8 w-8 text-zinc-700 mx-auto" />
            <p className="text-sm text-zinc-400 font-medium">No profiles yet</p>
            <p className="text-xs text-zinc-500">
              Profiles build automatically after 5+ analyses per symbol.<br />
              Start the agent and let it run through several news cycles.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(profiles).map(([symbol, profile]) => (
              <div key={symbol} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-50 text-base">{symbol}</span>
                    <Badge variant="secondary" className="text-xs">
                      {profile.analysis_count} analyses
                    </Badge>
                    {profile.avg_confidence && (
                      <Badge variant={profile.avg_confidence >= 70 ? "success" : "warning"} className="text-xs">
                        avg {profile.avg_confidence.toFixed(0)}% conf
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-zinc-600">
                    Updated {format(new Date(profile.updated_at), 'MMM d')}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <TrendUp className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-zinc-300"><span className="text-emerald-400 font-medium">Bull: </span>{profile.bull_thesis}</p>
                  </div>
                  <div className="flex gap-2">
                    <TrendingDown className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-zinc-300"><span className="text-red-400 font-medium">Bear: </span>{profile.bear_thesis}</p>
                  </div>
                  <div className="flex gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-zinc-300"><span className="text-amber-400 font-medium">Sensitivity: </span>{profile.news_sensitivity}</p>
                  </div>
                  {profile.pattern_notes && (
                    <div className="flex gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-zinc-300"><span className="text-blue-400 font-medium">Patterns: </span>{profile.pattern_notes}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
