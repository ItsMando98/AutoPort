import { useEffect, useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import {
  Play, Square, AlertCircle, ChevronDown, ChevronRight, ArrowRight, Clock
} from "lucide-react"
import { useAutoTrading } from "@/src/context/AutoTradingContext"
import { api, type ResearchEvent, type SignalCandidate, type DailyReport, type AutonomyDecision } from "@/src/lib/api"
import { cn } from "@/src/lib/utils"
import { formatDistanceToNow } from "date-fns"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning"

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'executed': case 'filled': return 'success'
    case 'blocked': case 'rejected': case 'cancelled': return 'destructive'
    case 'in_flight': case 'submitted': case 'partially_filled': return 'warning'
    default: return 'outline'
  }
}

function actionVariant(action?: 'BUY' | 'SELL' | 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | null): BadgeVariant {
  if (action === 'BUY' || action === 'ADD') return 'success'
  if (action === 'SELL' || action === 'TRIM' || action === 'EXIT') return 'destructive'
  return 'outline'
}

type TabKey = 'pipeline' | 'events' | 'candidates' | 'committee'

export function DecisionEngine() {
  const {
    isAutoTrading, setIsAutoTrading, engineTogglePending, cycleCount, mode, degraded, killSwitchEngaged,
  } = useAutoTrading()

  const [report, setReport]             = useState<DailyReport | null>(null)
  const [researchEvents, setResearchEvents] = useState<ResearchEvent[]>([])
  const [candidates, setCandidates]     = useState<SignalCandidate[]>([])
  const [decisions, setDecisions]       = useState<AutonomyDecision[]>([])
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab]       = useState<TabKey>('pipeline')

  const loadData = async () => {
    const [rep, events, cands, autonomy] = await Promise.all([
      api.getDailyReport(),
      api.getResearchEvents(100),
      api.getSignalCandidates(50),
      api.getAutonomyDecisions(undefined, 50),
    ])
    if (rep) setReport(rep)
    setResearchEvents(events ?? [])
    setCandidates(cands ?? [])
    setDecisions(autonomy?.decisions ?? [])
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 15_000)
    return () => clearInterval(interval)
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const funnel        = report?.candidateFunnel
  const execSummary   = report?.executionSummary
  const decisionTrail = report?.decisionTrail ?? []
  const blockedCount  = report?.blockedDecisions?.length ?? 0

  const tabs: Array<{ key: TabKey; label: string }> = useMemo(() => [
    { key: 'pipeline',   label: `Decision Trail (${decisionTrail.length})` },
    { key: 'events',     label: `Research Events (${researchEvents.length})` },
    { key: 'candidates', label: `Signal Candidates (${candidates.length})` },
    { key: 'committee',  label: `Committee (${decisions.length})` },
  ], [decisionTrail.length, researchEvents.length, candidates.length, decisions.length])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Decision Engine</h2>
          <p className="text-sm text-zinc-400">Research pipeline — Events → Candidates → Execution</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {degraded && (
            <Badge variant="destructive" className="text-[10px]">
              <AlertCircle className="mr-1 h-3 w-3" />Degraded
            </Badge>
          )}
          {killSwitchEngaged && (
            <Badge variant="destructive" className="text-[10px]">KILL SWITCH</Badge>
          )}
          <Badge variant="outline" className="text-[10px] bg-zinc-900/50 font-mono">
            {mode.toUpperCase()} · {cycleCount} cycles
          </Badge>
          <button
            onClick={() => setIsAutoTrading(!isAutoTrading)}
            disabled={engineTogglePending}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border disabled:cursor-not-allowed disabled:opacity-60',
              isAutoTrading
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20'
            )}
          >
            {isAutoTrading
              ? <><Square className="h-4 w-4 fill-current" />Stop Engine</>
              : <><Play className="h-4 w-4 fill-current" />Start Engine</>}
          </button>
          <Badge variant="outline" className="bg-zinc-900/50">
            <span className={cn('flex h-2 w-2 rounded-full mr-2', isAutoTrading ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500')} />
            {isAutoTrading ? 'Running' : 'Idle'}
          </Badge>
        </div>
      </div>

      {/* Funnel Stats */}
      {funnel && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'Research Events', value: researchEvents.length },
            { label: 'Candidates',       value: funnel.total },
            { label: 'High Confidence',  value: funnel.highConfidence },
            { label: 'In Flight',        value: funnel.inFlight },
            { label: 'Filled',           value: execSummary?.filled ?? 0 },
            { label: 'Rejected',         value: execSummary?.rejected ?? 0 },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-3">
                <div className="text-xs text-zinc-400 mb-1">{label}</div>
                <div className="text-xl font-bold text-zinc-50">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-zinc-800">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === key
                ? 'border-zinc-50 text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Decision Trail ── */}
      {activeTab === 'pipeline' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Candidate → Execution chain
              {blockedCount > 0 && (
                <span className="ml-3 text-xs font-normal text-zinc-500">+ {blockedCount} blocked</span>
              )}
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3 w-4"></th>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium text-right">Score</th>
                  <th className="px-4 py-3 font-medium text-right">Conf.</th>
                  <th className="px-4 py-3 font-medium">Candidate</th>
                  <th className="px-4 py-3 font-medium">Execution</th>
                  <th className="px-4 py-3 font-medium">Sources</th>
                  <th className="px-4 py-3 font-medium text-right">P&L %</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {decisionTrail.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-zinc-500">
                      No decision trail yet. Start the engine and let it run a few cycles.
                    </td>
                  </tr>
                ) : decisionTrail.map(item => {
                  const isExpanded = expanded.has(item.candidateId)
                  const displayAction = item.decisionAction ?? item.action
                  return [
                    <tr
                      key={item.candidateId}
                      onClick={() => toggleExpand(item.candidateId)}
                      className="cursor-pointer hover:bg-zinc-900/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-zinc-600">
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </td>
                      <td className="px-4 py-3 font-bold text-zinc-50">{item.symbol}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={actionVariant(displayAction)}
                          className="text-[10px]"
                        >
                          {displayAction}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{item.score.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{item.confidence}%</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(item.candidateStatus)} className="text-[10px]">
                          {item.candidateStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {item.executionStatus
                          ? <Badge variant={statusVariant(item.executionStatus)} className="text-[10px]">{item.executionStatus}</Badge>
                          : <span className="text-xs text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.sourceTypes.map(t => (
                            <Badge key={t} variant="secondary" className="text-[9px] px-1">{t}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.pnl !== null
                          ? <span className={cn('font-mono text-xs', item.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {item.pnl >= 0 ? '+' : ''}{item.pnl.toFixed(1)}%
                            </span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatDistanceToNow(new Date(item.createdAt * 1000), { addSuffix: true })}
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={item.candidateId + '-detail'} className="bg-zinc-900/40">
                        <td colSpan={10} className="px-8 py-3 space-y-2">
                          <div>
                            <span className="text-xs font-medium text-blue-400 mr-2">Reasoning:</span>
                            <span className="text-xs text-zinc-300">{item.reasoning}</span>
                          </div>
                          {item.heldOutReason && (
                            <div>
                              <span className="text-xs font-medium text-amber-400 mr-2">Committee note:</span>
                              <span className="text-xs text-zinc-300">{item.heldOutReason}</span>
                            </div>
                          )}
                          {item.eventTitles.length > 0 && (
                            <div>
                              <span className="text-xs font-medium text-zinc-400 mr-2">Source Events:</span>
                              <div className="mt-1 space-y-0.5">
                                {item.eventTitles.map((title, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-xs text-zinc-500">
                                    <ArrowRight className="h-3 w-3 shrink-0" />{title}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {item.exitReason && (
                            <div>
                              <span className="text-xs font-medium text-red-400 mr-2">Exit Reason:</span>
                              <span className="text-xs text-zinc-300">{item.exitReason}</span>
                            </div>
                          )}
                          <div className="flex gap-6 text-xs text-zinc-500">
                            {item.plannedShares != null && <span>Planned: {item.plannedShares} shares</span>}
                            {item.filledShares != null && (
                              <span>Filled: {item.filledShares} shares{item.fillPrice != null ? ` @ $${item.fillPrice.toFixed(2)}` : ''}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Research Events ── */}
      {activeTab === 'events' && (
        <div className="space-y-3">
          {researchEvents.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">No research events yet.</div>
          ) : researchEvents.map(event => (
            <Card
              key={event.id}
              className={cn(
                'border-l-4',
                event.sentiment === 'bullish' ? 'border-l-emerald-600'
                  : event.sentiment === 'bearish' ? 'border-l-red-600'
                  : 'border-l-zinc-700'
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                        {event.sourceType.toUpperCase()}
                      </Badge>
                      <span className="font-bold text-zinc-50 text-sm">{event.symbol}</span>
                      <Badge
                        variant={event.sentiment === 'bullish' ? 'success' : event.sentiment === 'bearish' ? 'destructive' : 'outline'}
                        className="text-[10px]"
                      >
                        {event.sentiment}
                      </Badge>
                      {event.eventType && (
                        <span className="text-[10px] text-zinc-500 font-mono">{event.eventType}</span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-300 leading-snug">{event.title}</p>
                    {event.summary && (
                      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{event.summary}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-zinc-400 font-medium tabular-nums">
                      Imp. {Math.round(event.importance * 100)}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-1 flex items-center gap-1 justify-end">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Signal Candidates ── */}
      {activeTab === 'candidates' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3 w-4"></th>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium text-right">Score</th>
                  <th className="px-4 py-3 font-medium text-right">Confidence</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Source Events</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {candidates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-zinc-500">No signal candidates yet.</td>
                  </tr>
                ) : candidates.map(cand => {
                  const isExpanded = expanded.has(cand.id)
                  const hasDetail = cand.reasoning || Object.keys(cand.factorBreakdown).length > 0
                  const displayAction = cand.decisionAction ?? cand.action
                  return [
                    <tr
                      key={cand.id}
                      onClick={() => hasDetail && toggleExpand(cand.id)}
                      className={cn('hover:bg-zinc-900/30 transition-colors', hasDetail && 'cursor-pointer')}
                    >
                      <td className="px-4 py-3 text-zinc-600">
                        {hasDetail ? (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                      </td>
                      <td className="px-4 py-3 font-bold text-zinc-50">{cand.symbol}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={actionVariant(displayAction)}
                          className="text-[10px]"
                        >
                          {displayAction}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{cand.score.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{cand.confidence}%</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(cand.status)} className="text-[10px]">{cand.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{cand.sourceEventIds.length} events</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatDistanceToNow(new Date(cand.updatedAt), { addSuffix: true })}
                      </td>
                    </tr>,
                    isExpanded && hasDetail && (
                      <tr key={cand.id + '-detail'} className="bg-zinc-900/40">
                        <td colSpan={8} className="px-8 py-3 space-y-2">
                          {cand.reasoning && (
                            <div>
                              <span className="text-xs font-medium text-blue-400 mr-2">Reasoning:</span>
                              <span className="text-xs text-zinc-300">{cand.reasoning}</span>
                            </div>
                          )}
                          {Object.keys(cand.factorBreakdown).length > 0 && (
                            <div>
                              <span className="text-xs font-medium text-zinc-400 mr-2">Factor Breakdown:</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {Object.entries(cand.factorBreakdown).map(([factor, scoreRaw]) => {
                                  const score = scoreRaw as number;
                                  return (
                                    <span
                                      key={factor}
                                      className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded"
                                    >
                                      {factor}: {score > 0 ? '+' : ''}{score.toFixed(1)}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Committee ── */}
      {activeTab === 'committee' && (
        <div className="space-y-3">
          {decisions.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">No committee decisions yet.</div>
          ) : decisions.map(decision => {
            const isExpanded = expanded.has(decision.id)
            return (
              <Card key={decision.id}>
                <CardContent
                  className="p-4 cursor-pointer"
                  onClick={() => toggleExpand(decision.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />}
                      <span className="font-bold text-zinc-50">{decision.symbol}</span>
                      <Badge variant={actionVariant(decision.action)} className="text-[10px]">{decision.action}</Badge>
                      {!decision.requiredCoverageMet && (
                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">Coverage gap</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-400">
                      <span>Score <span className="font-mono text-zinc-200">{decision.score.toFixed(0)}</span></span>
                      <span>Conf. <span className="font-mono text-zinc-200">{Math.round(decision.confidence * 100)}%</span></span>
                      <span>Coverage <span className="font-mono text-zinc-200">{decision.coverage}</span></span>
                      <span>Disagreement <span className={cn('font-mono', decision.disagreementPenalty >= 0.5 ? 'text-amber-400' : 'text-zinc-200')}>{Math.round(decision.disagreementPenalty * 100)}%</span></span>
                      <Badge variant="outline" className="text-[10px] font-mono">{decision.macroRegime}</Badge>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t border-zinc-800 pt-3">
                      <div>
                        <span className="text-xs font-medium text-blue-400 mr-2">Decision reason:</span>
                        <span className="text-xs text-zinc-300">{decision.decisionReason}</span>
                      </div>
                      {decision.heldOutReason && (
                        <div>
                          <span className="text-xs font-medium text-amber-400 mr-2">Held out:</span>
                          <span className="text-xs text-zinc-300">{decision.heldOutReason}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-xs font-medium text-zinc-400 mb-2 block">Per-agent contributions:</span>
                        <div className="space-y-1.5">
                          {decision.contributions.map((c, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 text-xs bg-zinc-900/50 rounded px-2 py-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge variant={c.stance === 'BUY' ? 'success' : c.stance === 'SELL' ? 'destructive' : 'outline'} className="text-[9px] shrink-0">
                                  {c.stance}
                                </Badge>
                                <span className="text-zinc-300 font-mono shrink-0">{c.sourceKey}</span>
                                <span className="text-zinc-500 truncate">{c.thesis}</span>
                              </div>
                              <span className="text-zinc-500 font-mono shrink-0">
                                w={c.weight.toFixed(2)} · conf={Math.round(c.confidence * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
