import { useState, useEffect, useMemo } from "react"
import { usePaperTrading } from "@/src/context/PaperTradingContext"
import { useMarketData, type MarketData } from "@/src/context/MarketDataContext"
import { useAutoTrading } from "@/src/context/AutoTradingContext"
import {
  api,
  type DailyReport,
  type EarningsEvent,
  type FundamentalData,
  type TradeRecord,
  type RiskEventRecord,
  type OverviewStats,
  type KnowledgeProfile,
  type KnowledgeStatusRow,
  type ScreenerResultRow,
  type FilingRecordSummary,
  type SectorPerformanceRow,
  type WeeklySnapshot,
} from "@/src/lib/api"
import { ReportsOverview } from "./ReportsOverview"
import { ReportsEngineAndRisk } from "./ReportsEngineAndRisk"
import { ReportsExecutionPipeline } from "./ReportsExecutionPipeline"
import { ReportsOperations } from "./ReportsOperations"
import { ReportsDecisionTrail } from "./ReportsDecisionTrail"
import { ReportsScreener } from "./ReportsScreener"
import { ReportsFilings } from "./ReportsFilings"
import { ReportsKnowledge } from "./ReportsKnowledge"
import { ReportsMarketContext } from "./ReportsMarketContext"
import { ReportsPositions } from "./ReportsPositions"
import { ReportsRecentDecisions } from "./ReportsRecentDecisions"

export function Reports() {
  const { cashBalance, positions, getPortfolioValue, transactions } = usePaperTrading()
  const { marketData } = useMarketData()
  const { engineLogs, cycleCount } = useAutoTrading()

  const [backendTrades, setBackendTrades] = useState<TradeRecord[]>([])
  const [riskEvents, setRiskEvents] = useState<RiskEventRecord[]>([])
  const [upcomingEarnings, setUpcomingEarnings] = useState<EarningsEvent[]>([])
  const [fundamentals, setFundamentals] = useState<Record<string, FundamentalData>>({})
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [knowledgeProfiles, setKnowledgeProfiles] = useState<Record<string, KnowledgeProfile>>({})
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatusRow[]>([])
  const [screenerResults, setScreenerResults] = useState<ScreenerResultRow[]>([])
  const [recentFilings, setRecentFilings] = useState<FilingRecordSummary[]>([])
  const [sectorData, setSectorData] = useState<SectorPerformanceRow[]>([])
  const [weeklyData, setWeeklyData] = useState<Record<string, WeeklySnapshot | null>>({})
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      const [trades, events, earnings, funds, ov, profiles, kStatus, screener, filings, sectors, weekly, report] = await Promise.all([
        api.getTrades(),
        api.getRiskEvents(100),
        api.getUpcomingEarnings(30),
        api.getFundamentalsAll(),
        api.getOverview(),
        api.getKnowledgeProfiles(),
        api.getKnowledgeStatus(),
        api.getScreenerResults(),
        api.getRecentFilings(7),
        api.getSectorPerformance(),
        api.getWeeklySnapshots(),
        api.getDailyReport(),
      ])

      if (!active) return

      setBackendTrades(trades ?? [])
      setRiskEvents(events ?? [])
      setUpcomingEarnings(earnings ?? [])
      setFundamentals(funds ?? {})
      setOverview(ov)
      setKnowledgeProfiles(profiles ?? {})
      setKnowledgeStatus(kStatus ?? [])
      setScreenerResults(screener ?? [])
      setRecentFilings(filings ?? [])
      setSectorData(sectors ?? [])
      setWeeklyData(weekly ?? {})
      setDailyReport(report)
    }

    load()
    const interval = setInterval(load, 15_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  const currentPrices = useMemo(() => {
    const p: Record<string, number> = {}
    Object.values(marketData).forEach((d: MarketData) => { if (d?.price) p[d.symbol] = d.price })
    return p
  }, [marketData])

  const localTotalValue = getPortfolioValue(currentPrices)
  const totalValue = dailyReport?.metrics?.currentValue ?? localTotalValue
  const totalReturn = dailyReport?.metrics?.totalReturnPct ?? ((localTotalValue - 100_000) / 100_000) * 100
  const drawdown = dailyReport?.metrics?.maxDrawdownPct ?? Math.min(totalReturn, 0)

  const aiActivity = useMemo(() => {
    const hypotheses = engineLogs.filter(l => l.type === 'HYPOTHESIS').length
    const decisions = engineLogs.filter(l => l.type === 'DECISION').length
    const rejected = engineLogs.filter(l => l.status === 'REJECTED').length
    const executed = engineLogs.filter(l => l.status === 'EXECUTED').length
    return { hypotheses, decisions, rejected, executed }
  }, [engineLogs])

  const tradePerformance = useMemo(() => {
    const trades: Array<{ symbol: string; action?: string; type?: string; shares: number; price: number }> =
      backendTrades.length > 0 ? backendTrades : transactions.map(tx => ({
        symbol: tx.symbol, action: tx.type, shares: tx.shares, price: tx.price,
      }))

    const buys = trades.filter(t => (t.action || t.type) === 'BUY')
    const sells = trades.filter(t => (t.action || t.type) === 'SELL')

    const unrealizedPnL = positions.reduce((sum, pos) => {
      const currentPrice = currentPrices[pos.symbol] || pos.avgPrice
      return sum + (currentPrice - pos.avgPrice) * pos.shares
    }, 0)

    const symbolCount: Record<string, number> = {}
    for (const t of trades) {
      symbolCount[t.symbol] = (symbolCount[t.symbol] || 0) + 1
    }
    const topSymbols = Object.entries(symbolCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)

    return { totalTrades: trades.length, buys: buys.length, sells: sells.length, unrealizedPnL, topSymbols }
  }, [backendTrades, transactions, positions, currentPrices])

  const riskSummary = useMemo(() => {
    const blocked = riskEvents.filter(e => !e.allowed)
    const byCheck: Record<string, number> = {}
    for (const e of blocked) {
      const check = e.failed_check || 'Unknown'
      byCheck[check] = (byCheck[check] || 0) + 1
    }
    return {
      total: riskEvents.length,
      blocked: blocked.length,
      passed: riskEvents.filter(e => e.allowed).length,
      byCheck: Object.entries(byCheck).sort(([, a], [, b]) => b - a),
    }
  }, [riskEvents])

  const riskFromReport = dailyReport?.risk

  return (
    <div className="space-y-6">
      <ReportsOverview
        operatorSummary={dailyReport?.operatorSummary}
        totalValue={totalValue}
        totalReturn={totalReturn}
        unrealizedPnL={tradePerformance.unrealizedPnL}
        openPositions={positions.length}
        totalTrades={tradePerformance.totalTrades}
        buys={tradePerformance.buys}
        sells={tradePerformance.sells}
        riskBlocked={riskFromReport?.blocked ?? riskSummary.blocked}
        riskTotal={riskFromReport?.total ?? riskSummary.total}
      />

      <ReportsEngineAndRisk
        overview={overview}
        aiActivity={aiActivity}
        cycleCount={dailyReport?.agent?.cycleCount ?? cycleCount}
        agentMode={dailyReport?.agent?.mode ?? 'paper'}
        agentDegraded={dailyReport?.agent?.degraded ?? false}
        riskSummary={riskSummary}
        drawdown={drawdown}
        cashBalance={cashBalance}
        totalValue={totalValue}
      />

      <ReportsExecutionPipeline
        candidateFunnel={dailyReport?.candidateFunnel}
        candidates={dailyReport?.candidates ?? []}
        executionLifecycle={dailyReport?.executionSummary}
        executionAttempts={dailyReport?.executionAttempts ?? []}
        constructionSummary={dailyReport?.constructionSummary}
        executionOps={dailyReport?.executionOps}
        brokerOps={dailyReport?.brokerOps}
      />

      <ReportsOperations dataSources={dailyReport?.dataFreshness?.sources ?? []} />

      <ReportsDecisionTrail
        decisionTrail={dailyReport?.decisionTrail ?? []}
        blockedDecisions={dailyReport?.blockedDecisions ?? []}
        topBlockReasons={riskFromReport?.topBlockReasons ?? []}
        sourceAttribution={dailyReport?.metrics?.attribution?.bySource ?? []}
        executionQuality={dailyReport?.metrics?.executionQuality}
      />

      <ReportsScreener results={screenerResults} onResults={setScreenerResults} />

      <ReportsFilings filings={recentFilings} />

      <ReportsKnowledge
        profiles={knowledgeProfiles}
        status={knowledgeStatus}
        onUpdate={(profiles, status) => {
          setKnowledgeProfiles(profiles)
          setKnowledgeStatus(status)
        }}
      />

      <ReportsMarketContext sectorData={sectorData} weeklyData={weeklyData} />

      <ReportsPositions
        topSymbols={tradePerformance.topSymbols}
        fundamentals={fundamentals}
        currentPrices={currentPrices}
        upcomingEarnings={upcomingEarnings}
        positions={positions}
      />

      <ReportsRecentDecisions engineLogs={engineLogs} />
    </div>
  )
}
