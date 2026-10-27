import { Activity, BarChart2, BookOpenText, BrainCircuit, BriefcaseBusiness, FileText, FlaskConical, LayoutDashboard, Settings, ShieldAlert, Sparkles, Target } from "lucide-react"
import { cn } from "@/src/lib/utils"
import { useAutoTrading } from "@/src/context/AutoTradingContext"
import { formatDistanceToNow } from "date-fns"

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { isAutoTrading, lastCycleTime, cycleCount, mode, degraded, killSwitchEngaged, liveExecutionAllowed } = useAutoTrading()

  const navItems = [
    { id: "dashboard",  label: "Dashboard",       icon: LayoutDashboard },
    { id: "research",   label: "Research",        icon: BookOpenText },
    { id: "themes",     label: "Theme Lab",       icon: Target },
    { id: "market",     label: "Market Monitor",  icon: BarChart2 },
    { id: "smartMoney", label: "Smart Money",     icon: BriefcaseBusiness },
    { id: "autonomy",   label: "Autonomy",        icon: Sparkles },
    { id: "engine",     label: "Decision Engine", icon: BrainCircuit },
    { id: "risk",       label: "Risk Controls",   icon: ShieldAlert },
    { id: "execution",  label: "Execution Log",   icon: Activity },
    { id: "reports",    label: "Reports",         icon: FileText },
    { id: "backtest",   label: "Backtest",        icon: FlaskConical },
    { id: "settings",   label: "Settings",        icon: Settings },
  ]

  const statusColor = killSwitchEngaged ? "bg-red-500" : degraded ? "bg-amber-500" : isAutoTrading ? "bg-emerald-500" : "bg-zinc-600"
  const statusLabel = killSwitchEngaged
    ? `Kill Switch Engaged (${mode})`
    : degraded
    ? `Degraded (${mode})`
    : isAutoTrading
      ? `Engine Running (${mode})`
      : `Engine Stopped (${mode})`

  // Label text is a width+opacity transition (not conditional rendering) so the
  // expand/collapse reads as a slide rather than a pop-in/out.
  const label = "ml-3 max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-in-out group-hover/sidebar:ml-3 group-hover/sidebar:max-w-[12rem] group-hover/sidebar:opacity-100"
  const labelNoIndent = "max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 ease-in-out group-hover/sidebar:max-w-[12rem] group-hover/sidebar:opacity-100"

  return (
    <div className="group/sidebar flex h-full w-16 shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950 px-3 py-4 transition-[width] duration-200 ease-in-out hover:w-64">
      <div className="mb-8 flex items-center px-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-50 text-zinc-950">
          <BrainCircuit size={20} />
        </div>
        <span className={cn("text-lg font-bold tracking-tight text-zinc-50", label)}>AutoPort</span>
      </div>

      <div className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-50"
              )}
            >
              <Icon size={18} className="shrink-0" />
              <span className={label}>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between">
          <span className={cn("text-xs font-medium text-zinc-400", labelNoIndent)}>System Status</span>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor, isAutoTrading && "animate-pulse")} />
        </div>
        <div className="grid grid-rows-[0fr] transition-all duration-200 ease-in-out group-hover/sidebar:grid-rows-[1fr]">
          <div className="overflow-hidden">
            <div className="mt-2 text-sm font-medium text-zinc-50 whitespace-nowrap">{statusLabel}</div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">
              {lastCycleTime
                ? `Last cycle ${formatDistanceToNow(new Date(lastCycleTime), { addSuffix: true })}`
                : cycleCount > 0
                  ? `${cycleCount} cycles run`
                  : "No cycles yet"
              }
            </div>
            {cycleCount > 0 && (
              <div className="text-xs text-zinc-600 mt-0.5 whitespace-nowrap">{cycleCount} total cycles</div>
            )}
            {mode === 'live' && (
              <div className="text-xs text-zinc-600 mt-0.5 whitespace-nowrap">
                {liveExecutionAllowed ? 'Live execution unlocked' : 'Live execution locked'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
