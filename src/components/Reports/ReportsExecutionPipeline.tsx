import { Cpu, AlertTriangle, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { DailyReport, SignalCandidate, ExecutionAttempt } from "@/src/lib/api"
import { actionVariant } from "./utils"
import { MiniStatGrid } from "./StatGrid"

export function ReportsExecutionPipeline({
  candidateFunnel,
  candidates,
  executionLifecycle,
  executionAttempts,
  constructionSummary,
  executionOps,
  brokerOps,
}: {
  candidateFunnel: DailyReport['candidateFunnel'] | undefined
  candidates: SignalCandidate[]
  executionLifecycle: DailyReport['executionSummary'] | undefined
  executionAttempts: ExecutionAttempt[]
  constructionSummary: DailyReport['constructionSummary'] | undefined
  executionOps: DailyReport['executionOps'] | undefined
  brokerOps: DailyReport['brokerOps'] | undefined
}) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-cyan-400" />
            Candidate Funnel
          </CardTitle>
          <CardDescription>
            {candidateFunnel
              ? `${candidateFunnel.total} total · ${candidateFunnel.executed} executed · ${candidateFunnel.blocked} blocked`
              : 'Latest deterministic trade candidates'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {candidateFunnel && (
            <div className="pb-2">
              <MiniStatGrid items={[
                { label: "New", value: candidateFunnel.new },
                { label: "In Flight", value: candidateFunnel.inFlight },
                { label: "Executed", value: candidateFunnel.executed },
                { label: "Blocked", value: candidateFunnel.blocked },
              ]} />
            </div>
          )}
          {candidates.length === 0 ? (
            <p className="text-sm text-zinc-500">No recent candidates yet.</p>
          ) : candidates.slice(0, 6).map(candidate => (
            <div key={candidate.id} className="flex items-center justify-between rounded-md bg-zinc-900/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-zinc-50">{candidate.symbol}</div>
                <div className="text-xs text-zinc-500 truncate max-w-44">{candidate.reasoning}</div>
              </div>
              <div className="text-right shrink-0">
                <Badge variant={actionVariant(candidate.decisionAction ?? candidate.action)} className="text-xs">
                  {candidate.decisionAction ?? candidate.action}
                </Badge>
                <div className="text-xs text-zinc-400 mt-1">{candidate.confidence}%</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-orange-400" />
            Execution Lifecycle
          </CardTitle>
          <CardDescription>
            {executionLifecycle
              ? `${executionLifecycle.filled} filled · ${executionLifecycle.partiallyFilled} partial · ${executionLifecycle.rejected} rejected · ${executionLifecycle.fillRate ?? '—'}% fill rate`
              : 'Persistent execution attempts and outcomes'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {executionAttempts.length === 0 ? (
            <p className="text-sm text-zinc-500">No execution attempts yet.</p>
          ) : executionAttempts.slice(0, 6).map(attempt => (
            <div key={attempt.id} className="flex items-center justify-between rounded-md bg-zinc-900/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-zinc-50">{attempt.symbol} {attempt.action}</div>
                <div className="text-xs text-zinc-500">
                  {attempt.mode} · {attempt.status}
                  {attempt.action === 'BUY' && attempt.baseTargetWeight !== null && attempt.baseTargetWeight !== undefined
                    ? ` · ${(attempt.baseTargetWeight * 100).toFixed(1)}% -> ${((attempt.adjustedTargetWeight ?? 0) * 100).toFixed(1)}%`
                    : ''}
                </div>
                {attempt.action === 'BUY' && attempt.constructionReason ? (
                  <div className="text-[11px] text-zinc-600">
                    {(attempt.constructionBand ?? 'clean')} · {attempt.constructionReason}
                  </div>
                ) : null}
              </div>
              <div className="text-right text-xs text-zinc-400">
                {attempt.fillPrice ? `$${attempt.fillPrice.toFixed(2)}` : attempt.error || 'pending'}
              </div>
            </div>
          ))}
          {constructionSummary ? (
            <div className="pt-2">
              <MiniStatGrid columns={3} items={[
                { label: 'Clean', value: constructionSummary.clean },
                { label: 'Reduced', value: constructionSummary.reduced },
                { label: 'Severe', value: constructionSummary.severe },
              ]} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4 text-blue-400" />
            Execution Ops
          </CardTitle>
          <CardDescription>
            {executionOps
              ? `${executionOps.active} active · ${executionOps.stale} stale · ${executionOps.autoRecoveryTagged} auto-recovery events`
              : 'Autonomous execution monitoring and recovery'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {executionOps && (
            <div className="pb-2">
              <MiniStatGrid columns={3} items={[
                { label: 'Submitted', value: executionOps.submitted },
                { label: 'Partial', value: executionOps.partiallyFilled },
                { label: 'Stale', value: executionOps.stale },
              ]} />
            </div>
          )}
          {executionOps?.items?.length ? executionOps.items.map(item => (
            <div key={item.id} className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm",
              item.stale ? "border border-amber-500/20 bg-amber-950/20" : "bg-zinc-900/40"
            )}>
              <div>
                <div className="font-medium text-zinc-50">{item.symbol} {item.action}</div>
                <div className="text-xs text-zinc-500">
                  {item.status} · {item.ageMinutes.toFixed(1)}m old
                  {item.filledShares ? ` · ${item.filledShares}/${item.plannedShares ?? item.filledShares} filled` : ''}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {(item.rolloutProfile || item.sessionRegime) ? `${item.rolloutProfile ?? 'legacy'} · ${item.sessionRegime ?? 'legacy'} · ` : ''}
                  {item.retryCount > 0 ? `${item.retryCount}/${item.maxResubmits} resubmits used` : `0/${item.maxResubmits} resubmits used`} · {item.policyReason}
                </div>
                <div className="text-[11px] text-zinc-600">
                  stale after {item.staleAfterMinutes.toFixed(1)}m · cooldown {item.resubmitCooldownMinutes.toFixed(1)}m · {item.recoveryTimingReason}
                </div>
                <div className="text-[11px] text-zinc-600">
                  resubmit size {item.resubmitSizePct}% · {item.allowPartialResubmit ? 'partial retries enabled' : 'stop after partial fill'} · {item.resubmitStrategyReason}
                </div>
              </div>
              <div className="text-right shrink-0 space-y-1">
                <div>
                  <Badge variant={item.stale ? "warning" : "secondary"} className="text-[10px]">
                    {item.stale ? 'stale' : 'active'}
                  </Badge>
                </div>
                <div>
                  <Badge
                    variant={item.policyBand === 'blocked' ? "destructive" : item.policyBand === 'loosened' ? "success" : item.policyBand === 'tightened' ? "warning" : "secondary"}
                    className="text-[10px]"
                  >
                    {item.policyBand}
                  </Badge>
                </div>
                <div>
                  <Badge
                    variant={item.recoveryTimingBand === 'extended' ? "warning" : item.recoveryTimingBand === 'accelerated' ? "success" : "secondary"}
                    className="text-[10px]"
                  >
                    {item.recoveryTimingBand}
                  </Badge>
                </div>
                <div>
                  <Badge
                    variant={item.resubmitStrategyBand === 'halt_partial' ? "destructive" : item.resubmitStrategyBand === 'reduced' ? "warning" : item.resubmitStrategyBand === 'aggressive' ? "success" : "secondary"}
                    className="text-[10px]"
                  >
                    {item.resubmitStrategyBand}
                  </Badge>
                </div>
              </div>
            </div>
          )) : (
            <p className="text-sm text-zinc-500">No in-flight execution attempts.</p>
          )}
          <div className="pt-3 border-t border-zinc-800 space-y-2">
            <div className="text-xs text-zinc-500">Worker heartbeat</div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Reconciliation</span>
              <span className="text-zinc-300">
                {brokerOps?.reconciliation?.lastSuccessAt
                  ? formatDistanceToNow(new Date(brokerOps.reconciliation.lastSuccessAt), { addSuffix: true })
                  : 'never'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Recovery</span>
              <span className="text-zinc-300">
                {brokerOps?.recovery?.lastSuccessAt
                  ? formatDistanceToNow(new Date(brokerOps.recovery.lastSuccessAt), { addSuffix: true })
                  : 'never'}
              </span>
            </div>
            {(brokerOps?.recovery?.lastError || brokerOps?.reconciliation?.lastError) && (
              <div className="text-[11px] text-red-300 leading-relaxed">
                {brokerOps?.recovery?.lastError ?? brokerOps?.reconciliation?.lastError}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
