/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useMemo, useState } from "react"
import { Toaster } from "sonner"
import { Sidebar } from "@/src/components/Sidebar"
import { TooltipProvider } from "@/src/components/ui/tooltip"
import { PaperTradingProvider } from "@/src/context/PaperTradingContext"
import { MarketDataProvider } from "@/src/context/MarketDataContext"
import { AutoTradingProvider } from "@/src/context/AutoTradingContext"

const Dashboard = lazy(() => import("@/src/components/Dashboard").then((module) => ({ default: module.Dashboard })))
const ResearchFeed = lazy(() => import("@/src/components/ResearchFeed").then((module) => ({ default: module.ResearchFeed })))
const ThemeLab = lazy(() => import("@/src/components/ThemeLab").then((module) => ({ default: module.ThemeLab })))
const MarketMonitor = lazy(() => import("@/src/components/MarketMonitor").then((module) => ({ default: module.MarketMonitor })))
const SmartMoney = lazy(() => import("@/src/components/SmartMoney").then((module) => ({ default: module.SmartMoney })))
const Autonomy = lazy(() => import("@/src/components/Autonomy").then((module) => ({ default: module.Autonomy })))
const DecisionEngine = lazy(() => import("@/src/components/DecisionEngine").then((module) => ({ default: module.DecisionEngine })))
const RiskControls = lazy(() => import("@/src/components/RiskControls").then((module) => ({ default: module.RiskControls })))
const ExecutionLog = lazy(() => import("@/src/components/ExecutionLog").then((module) => ({ default: module.ExecutionLog })))
const Reports = lazy(() => import("@/src/components/Reports").then((module) => ({ default: module.Reports })))
const Backtest = lazy(() => import("@/src/components/Backtest").then((module) => ({ default: module.Backtest })))
const Settings = lazy(() => import("@/src/components/Settings").then((module) => ({ default: module.Settings })))

type TabId =
  | "dashboard"
  | "research"
  | "themes"
  | "market"
  | "smartMoney"
  | "autonomy"
  | "engine"
  | "risk"
  | "execution"
  | "reports"
  | "backtest"
  | "settings"

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard")

  const activeView = useMemo(() => {
    if (activeTab === "dashboard") return <Dashboard />
    if (activeTab === "research") return <ResearchFeed />
    if (activeTab === "themes") return <ThemeLab />
    if (activeTab === "market") return <MarketMonitor />
    if (activeTab === "smartMoney") return <SmartMoney />
    if (activeTab === "autonomy") return <Autonomy />
    if (activeTab === "engine") return <DecisionEngine />
    if (activeTab === "risk") return <RiskControls />
    if (activeTab === "execution") return <ExecutionLog />
    if (activeTab === "reports") return <Reports />
    if (activeTab === "backtest") return <Backtest />
    return <Settings />
  }, [activeTab])

  return (
    <MarketDataProvider>
      <PaperTradingProvider>
        <AutoTradingProvider>
          <TooltipProvider delayDuration={200}>
            <div className="flex h-screen w-full overflow-hidden bg-zinc-950 font-sans text-zinc-50">
              <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

              <main className="flex-1 overflow-y-auto p-8">
                <div className="mx-auto max-w-6xl">
                  <Suspense fallback={<TabFallback tab={activeTab} />}>
                    {activeView}
                  </Suspense>
                </div>
              </main>
              <Toaster
                theme="dark"
                position="bottom-right"
                toastOptions={{
                  classNames: {
                    toast: '!bg-zinc-900 !border !border-zinc-800 !text-zinc-50',
                    description: '!text-zinc-400',
                  },
                }}
              />
            </div>
          </TooltipProvider>
        </AutoTradingProvider>
      </PaperTradingProvider>
    </MarketDataProvider>
  )
}

function TabFallback({ tab }: { tab: TabId }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="text-lg font-semibold text-zinc-50">Loading {tabLabel(tab)}...</div>
      <div className="mt-2 text-sm text-zinc-500">
        View code is loaded on demand so the initial UI bundle stays smaller and chart-heavy screens do not block startup.
      </div>
    </div>
  )
}

function tabLabel(tab: TabId): string {
  if (tab === "dashboard") return "Dashboard"
  if (tab === "research") return "Research"
  if (tab === "themes") return "Theme Lab"
  if (tab === "market") return "Market Monitor"
  if (tab === "smartMoney") return "Smart Money"
  if (tab === "autonomy") return "Autonomy"
  if (tab === "engine") return "Decision Engine"
  if (tab === "risk") return "Risk Controls"
  if (tab === "execution") return "Execution History"
  if (tab === "reports") return "Reports"
  if (tab === "backtest") return "Replay Engine"
  return "Settings"
}
