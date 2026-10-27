import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/src/components/ui/card"
import { Button } from "@/src/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import {
  Key, Link, Shield, Bell, Plus, Trash2, X, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw,
  Wifi, WifiOff, Activity, DollarSign, PowerOff,
  Bot, Sparkles, Cpu, Wallet, RotateCcw, Eye, EyeOff, Save, Check, AlertCircle
} from "lucide-react"
import { cn } from "@/src/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"
import { api, type AiConfig, type AiProvider, type ModelOption } from "@/src/lib/api"
import { useAutoTrading } from "@/src/context/AutoTradingContext"

export function Settings() {
  const { isAutoTrading, setIsAutoTrading, engineTogglePending, killSwitchEngaged, liveExecutionAllowed, readinessEligible, agentStatuses } = useAutoTrading()

  // Broker state
  const [brokerStatus, setBrokerStatus]   = useState<any>(null)
  const [brokerConfig, setBrokerConfig]   = useState<any>(null)
  const [brokerModeInput, setBrokerModeInput] = useState<'simulation' | 'paper' | 'live'>('paper')
  const [alpacaKeyInput, setAlpacaKeyInput] = useState<string>('')
  const [alpacaSecretInput, setAlpacaSecretInput] = useState<string>('')
  const [showAlpacaSecret, setShowAlpacaSecret] = useState<boolean>(false)
  const [savingBroker, setSavingBroker]   = useState<boolean>(false)
  const [brokerSuccessMsg, setBrokerSuccessMsg] = useState<string | null>(null)
  const [brokerAccount, setBrokerAccount] = useState<any>(null)
  const [brokerOrders, setBrokerOrders]   = useState<any[]>([])
  const [testing, setTesting]             = useState(false)
  const [testResult, setTestResult]       = useState<{ ok: boolean; error?: string } | null>(null)
  const [killSwitchPending, setKillSwitchPending] = useState(false)
  const [readiness, setReadiness]         = useState<any>(null)
  const [controlPending, setControlPending] = useState(false)

  // Alerts state (local)
  const [alerts, setAlerts] = useState([
    { id: 1, asset: "TSLA",      condition: "Price Drop > 5%",          actions: ["System Log"],        lastTriggered: "Never" },
    { id: 2, asset: "PORTFOLIO", condition: "Daily Drawdown > 3%",       actions: ["System Log"],        lastTriggered: "Never" },
    { id: 3, asset: "NVDA",      condition: "RSI > 80 (Overbought)",     actions: ["System Log"],        lastTriggered: "Never" },
  ])
  const [isAddingAlert, setIsAddingAlert] = useState(false)
  const [newAlert, setNewAlert] = useState({ asset: "", type: "price", threshold: "", actions: ["System Log"] })
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null)

  // AI Provider & Budget State
  const [aiConfig, setAiConfig]                   = useState<AiConfig | null>(null)
  const [selectedProvider, setSelectedProvider]   = useState<AiProvider>('gemini')
  const [selectedModel, setSelectedModel]         = useState<string>('gemini-2.5-flash')
  const [apiKeyInput, setApiKeyInput]             = useState<string>('')
  const [showApiKey, setShowApiKey]               = useState<boolean>(false)
  const [budgetInput, setBudgetInput]             = useState<string>('10.00')
  const [availableModels, setAvailableModels]     = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels]         = useState<boolean>(false)
  const [isCustomModel, setIsCustomModel]         = useState<boolean>(false)
  const [savingAi, setSavingAi]                   = useState<boolean>(false)
  const [aiSuccessMsg, setAiSuccessMsg]           = useState<string | null>(null)
  const [aiTestResult, setAiTestResult]           = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
  const [testingAi, setTestingAi]                 = useState<boolean>(false)
  const [resettingSpend, setResettingSpend]       = useState<boolean>(false)

  const loadModels = async (prov: AiProvider, key?: string) => {
    setLoadingModels(true)
    const res = await api.getAiModels(prov, key)
    if (res?.models && res.models.length > 0) {
      setAvailableModels(res.models)
      setSelectedModel(prev => {
        if (isCustomModel) return prev
        if (res.models.some(m => m.id === prev)) return prev
        return res.models[0].id
      })
    }
    setLoadingModels(false)
  }

  useEffect(() => {
    const load = async () => {
      const [broker, gateStatus, aiCfg, brokerCfg] = await Promise.all([
        api.getBrokerStatus(),
        api.getReadinessStatus(),
        api.getAiConfig(),
        api.getBrokerConfig(),
      ])
      setBrokerStatus(broker)
      setReadiness(gateStatus)
      if (brokerCfg) {
        setBrokerConfig(brokerCfg)
        setBrokerModeInput(brokerCfg.mode)
      }
      if (broker?.connected) {
        api.getBrokerAccount().then(setBrokerAccount)
        api.getBrokerOrders('closed').then(orders => setBrokerOrders(orders?.slice(0, 10) ?? []))
      }
      if (aiCfg) {
        setAiConfig(aiCfg)
        setSelectedProvider(aiCfg.provider)
        setSelectedModel(aiCfg.model)
        setBudgetInput(String(aiCfg.budgetLimitUsd))
        loadModels(aiCfg.provider)
      }
    }

    load()
  }, [])

  const handleProviderChange = (newProvider: AiProvider) => {
    setSelectedProvider(newProvider)
    setApiKeyInput('')
    setAiTestResult(null)
    setAiSuccessMsg(null)
    loadModels(newProvider)
  }

  const handleSaveAiConfig = async () => {
    setSavingAi(true)
    setAiSuccessMsg(null)
    const limit = parseFloat(budgetInput)
    const updated = await api.saveAiConfig({
      provider: selectedProvider,
      model: selectedModel,
      apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
      budgetLimitUsd: isNaN(limit) ? 10.0 : limit,
    })
    if (updated?.config) {
      setAiConfig(updated.config)
      setApiKeyInput('')
      setAiSuccessMsg('AI Provider, Modell und Budget erfolgreich gespeichert!')
      setTimeout(() => setAiSuccessMsg(null), 4000)
    }
    setSavingAi(false)
  }

  const handleTestAi = async () => {
    setTestingAi(true)
    setAiTestResult(null)
    const res = await api.testAiConnection({
      provider: selectedProvider,
      model: selectedModel,
      apiKey: apiKeyInput.trim() || undefined,
    })
    setAiTestResult(res)
    setTestingAi(false)
  }

  const handleResetSpend = async () => {
    if (!window.confirm("Möchtest du den AI-Ausgabenzähler wirklich auf $0.00 zurücksetzen? Falls das Budgetlimit erreicht war, wird die Verarbeitung sofort wieder freigegeben.")) return
    setResettingSpend(true)
    const res = await api.resetAiSpend()
    if (res?.config) {
      setAiConfig(res.config)
      setAiSuccessMsg('Ausgabenzähler wurde auf $0.00 zurückgesetzt. Verarbeitung ist aktiv!')
      setTimeout(() => setAiSuccessMsg(null), 4000)
    }
    setResettingSpend(false)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await api.testBrokerConnection({
      mode: brokerModeInput,
      apiKey: alpacaKeyInput.trim() || undefined,
      apiSecret: alpacaSecretInput.trim() || undefined,
    })
    setTestResult(result ?? { ok: false, error: 'Keine Antwort vom Server' })
    if (result?.ok && result.account) setBrokerAccount(result.account)
    setTesting(false)
  }

  const handleSaveBrokerConfig = async () => {
    setSavingBroker(true)
    setBrokerSuccessMsg(null)
    const result = await api.saveBrokerConfig({
      mode: brokerModeInput,
      apiKey: alpacaKeyInput.trim() || undefined,
      apiSecret: alpacaSecretInput.trim() || undefined,
    })
    if (result?.config) {
      setBrokerConfig(result.config)
      setAlpacaKeyInput('')
      setAlpacaSecretInput('')
      setBrokerSuccessMsg('Alpaca Broker-Einstellungen erfolgreich gespeichert!')
      // Refresh status & account
      const [updatedStatus, gateStatus] = await Promise.all([
        api.getBrokerStatus(),
        api.getReadinessStatus(),
      ])
      setBrokerStatus(updatedStatus)
      setReadiness(gateStatus)
      if (updatedStatus?.connected) {
        api.getBrokerAccount().then(setBrokerAccount)
        api.getBrokerOrders('closed').then(orders => setBrokerOrders(orders?.slice(0, 10) ?? []))
      } else {
        setBrokerAccount(null)
        setBrokerOrders([])
      }
      setTimeout(() => setBrokerSuccessMsg(null), 4000)
    }
    setSavingBroker(false)
  }

  const handleKillSwitch = async () => {
    if (!window.confirm(
      `EMERGENCY STOP\n\nThis will:\n1. Stop the AI agent immediately\n2. ${brokerStatus?.connected ? 'Cancel all open Alpaca orders + close all positions' : 'Stop all pending operations'}\n\nAre you sure?`
    )) return
    setKillSwitchPending(true)
    setIsAutoTrading(false)
    const result = await api.setKillSwitch(true)
    if (result?.readiness) setReadiness(result.readiness)
    setKillSwitchPending(false)
  }

  const handleReleaseKillSwitch = async () => {
    setControlPending(true)
    const result = await api.setKillSwitch(false)
    if (result?.readiness) setReadiness(result.readiness)
    setControlPending(false)
  }

  const handleToggleLiveExecution = async (enabled: boolean) => {
    setControlPending(true)
    const result = await api.setLiveExecutionEnabled(enabled)
    if (result?.readiness) setReadiness(result.readiness)
    setControlPending(false)
  }

  const handleSetRolloutProfile = async (profile: 'paper' | 'limited_live' | 'full_live') => {
    setControlPending(true)
    const result = await api.setLiveRolloutProfile(profile)
    if (result?.readiness) setReadiness(result.readiness)
    setControlPending(false)
  }

  const handleStartAllAgents = async () => {
    await api.startAllAgents()
  }

  const handleStopAllAgents = async () => {
    await api.stopAllAgents()
  }

  const handleToggleAgent = async (name: string, running: boolean) => {
    if (running) await api.stopNamedAgent(name)
    else await api.startNamedAgent(name)
  }

  const handleAddAlert = () => {
    if (!newAlert.asset || !newAlert.threshold) return
    const condMap: Record<string, string> = {
      price: `Price Change > ${newAlert.threshold}%`,
      rsi:   `RSI > ${newAlert.threshold}`,
      drawdown: `Drawdown > ${newAlert.threshold}%`,
    }
    setAlerts([...alerts, {
      id: Date.now(),
      asset: newAlert.asset.toUpperCase(),
      condition: condMap[newAlert.type] ?? newAlert.threshold,
      actions: newAlert.actions,
      lastTriggered: "Never",
    }])
    setIsAddingAlert(false)
    setNewAlert({ asset: "", type: "price", threshold: "", actions: ["System Log"] })
  }

  const modeColor = (mode: string) =>
    mode === 'live' ? 'text-red-400' : mode === 'paper' ? 'text-amber-400' : 'text-zinc-400'

  const modeBadge = (mode: string) =>
    mode === 'live' ? 'destructive' : mode === 'paper' ? 'warning' : 'secondary'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-50">System Settings</h2>
        <p className="text-sm text-zinc-400">Broker connection, data sources, and agent configuration.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Broker Integration ───────────────────────────────────────── */}
        <Card className={cn(
          "md:col-span-2",
          brokerStatus?.mode === 'live' && "border-red-500/40"
        )}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link className="h-5 w-5 text-zinc-400" />
                  Alpaca Broker Konfiguration & Status
                  {brokerStatus && (
                    <Badge variant={modeBadge(brokerStatus.mode)} className="ml-2 uppercase text-xs">
                      {brokerStatus.mode}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {brokerStatus?.connected
                    ? `Verbunden mit Alpaca ${brokerStatus.mode === 'live' ? 'LIVE (Echtgeld)' : 'Paper Trading (Sandbox)'}`
                    : 'Wähle den Broker-Modus und hinterlege deine Alpaca API-Zugangsdaten direkt hier im Dashboard.'
                  }
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {brokerStatus?.connected ? (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 flex items-center gap-1.5 text-xs py-1">
                    <Wifi className="h-3.5 w-3.5" />
                    Verbunden
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-700 text-zinc-400 bg-zinc-900 flex items-center gap-1.5 text-xs py-1">
                    <WifiOff className="h-3.5 w-3.5" />
                    Simulation (Nicht verbunden)
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>1. Broker-Handelsmodus</span>
                <span className="text-[11px] text-zinc-500">Wähle zwischen Simulation und echter Alpaca-Anbindung</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  {
                    id: 'simulation',
                    title: 'Simulation (Lokal)',
                    desc: 'Nur internes Portfolio, keine Broker-Aufrufe',
                    badge: 'Kein Key',
                  },
                  {
                    id: 'paper',
                    title: 'Alpaca Paper Trading',
                    desc: 'Kostenlose Sandbox ohne finanzielles Risiko',
                    badge: 'Empfohlen',
                  },
                  {
                    id: 'live',
                    title: 'Alpaca Live Trading',
                    desc: 'Echtes Kapital — erfordert bestandene Gates',
                    badge: 'Echtgeld',
                  },
                ].map(m => {
                  const isSelected = brokerModeInput === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setBrokerModeInput(m.id as any)
                        setTestResult(null)
                        setBrokerSuccessMsg(null)
                      }}
                      className={cn(
                        "flex flex-col items-start p-3 rounded-lg border text-left transition-all",
                        isSelected
                          ? m.id === 'live'
                            ? "border-red-500 bg-red-500/10 text-zinc-100"
                            : "border-emerald-500 bg-emerald-500/10 text-zinc-100"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      )}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-xs font-semibold">{m.title}</span>
                        <Badge variant={m.id === 'live' ? 'destructive' : m.id === 'paper' ? 'success' : 'secondary'} className="text-[9px]">
                          {m.badge}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-zinc-500 leading-tight">{m.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Live Mode Caution Banner */}
            {brokerModeInput === 'live' && (
              <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                <div>
                  <span className="font-semibold text-red-300">Achtung: Live-Handel mit echtem Geld.</span>
                  <p className="text-red-300/80 mt-0.5">
                    Orders werden direkt an Alpaca Live übertragen. Live-Trades werden nur ausgeführt, wenn alle Sicherheits-Gates (Paper Track Record, Kill Switch gelöst, keine Daten-Degradation) grün sind.
                  </p>
                </div>
              </div>
            )}

            {/* Credentials Fields */}
            {brokerModeInput !== 'simulation' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* API Key ID */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                    <span>Alpaca API Key ID</span>
                    {brokerConfig?.maskedKey && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        Aktiv: {brokerConfig.maskedKey}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={alpacaKeyInput}
                    onChange={(e) => setAlpacaKeyInput(e.target.value)}
                    placeholder={
                      brokerConfig?.maskedKey
                        ? `Neuen Key eingeben (vorhanden: ${brokerConfig.maskedKey})`
                        : "PK..."
                    }
                    className="w-full h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 font-mono"
                  />
                  <p className="text-[11px] text-zinc-500">
                    Zu finden im Alpaca Dashboard unter <em>API Keys</em>.
                  </p>
                </div>

                {/* API Secret Key */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                    <span>Alpaca API Secret Key</span>
                    {brokerConfig?.hasSecret && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        Aktiv: {brokerConfig.maskedSecret || '••••••••'}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showAlpacaSecret ? "text" : "password"}
                      value={alpacaSecretInput}
                      onChange={(e) => setAlpacaSecretInput(e.target.value)}
                      placeholder={
                        brokerConfig?.hasSecret
                          ? "Neues Secret eingeben (bereits hinterlegt)"
                          : "Alpaca Secret Key eingeben..."
                      }
                      className="w-full h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 pr-9 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAlpacaSecret(!showAlpacaSecret)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      tabIndex={-1}
                    >
                      {showAlpacaSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Wird sicher in der lokalen Datenbank gespeichert.
                  </p>
                </div>
              </div>
            )}

            {/* Test result banner */}
            {testResult && (
              <div className={cn(
                "rounded-md p-3 text-xs flex items-center justify-between border",
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              )}>
                <div className="flex items-center gap-2">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                  )}
                  <span>
                    {testResult.ok
                      ? `Verbindung zu Alpaca (${testResult.account?.mode?.toUpperCase()}) erfolgreich hergestellt!`
                      : `Verbindungstest fehlgeschlagen: ${testResult.error}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setTestResult(null)}
                  className="text-zinc-500 hover:text-zinc-300 ml-2"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {brokerSuccessMsg && (
              <div className="rounded-md p-3 text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                {brokerSuccessMsg}
              </div>
            )}

            {/* Save & Test Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-zinc-800">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestConnection}
                disabled={testing}
                className="text-xs"
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Verbindung wird getestet...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Verbindung testen
                  </>
                )}
              </Button>

              <Button
                size="sm"
                onClick={handleSaveBrokerConfig}
                disabled={savingBroker}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                {savingBroker ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Wird gespeichert...
                  </>
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Broker-Einstellungen speichern
                  </>
                )}
              </Button>
            </div>

            {/* Account info when connected */}
            {brokerAccount && (
              <div className="border-t border-zinc-800/80 pt-3 space-y-2">
                <div className="text-xs font-medium text-zinc-400">Live Alpaca Konto-Übersicht</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Cash Balance',     value: `$${Number(brokerAccount.cash).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
                    { label: 'Portfolio Value',  value: `$${Number(brokerAccount.portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
                    { label: 'Buying Power',     value: `$${Number(brokerAccount.buyingPower).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
                    { label: 'Invested Value',   value: `$${Number(brokerAccount.longMarketValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-md bg-zinc-950/60 border border-zinc-800/60 px-3 py-2">
                      <div className="text-[11px] text-zinc-500">{label}</div>
                      <div className="text-sm font-bold text-zinc-100 font-mono mt-0.5">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Alpaca orders */}
            {brokerOrders.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
                <p className="text-xs text-zinc-400 font-medium">Letzte Alpaca Orders</p>
                {brokerOrders.slice(0, 5).map(o => (
                  <div key={o.id} className="flex items-center justify-between text-xs rounded px-3 py-2 bg-zinc-900/60 border border-zinc-800/40">
                    <div className="flex items-center gap-2">
                      <Badge variant={o.side === 'buy' ? 'success' : 'destructive'} className="text-[10px]">
                        {o.side.toUpperCase()}
                      </Badge>
                      <span className="font-medium text-zinc-100">{o.symbol}</span>
                      <span className="text-zinc-400">{o.qty} Aktien</span>
                      {o.filledAvgPrice && (
                        <span className="text-zinc-500 font-mono">@ ${Number(o.filledAvgPrice).toFixed(2)}</span>
                      )}
                    </div>
                    <Badge variant={o.status === 'filled' ? 'success' : 'secondary'} className="text-[10px] font-mono">
                      {o.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Data Sources ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-zinc-400" />
              Live Readiness Gate
            </CardTitle>
            <CardDescription>{readiness?.summary ?? 'Loading readiness gates...'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Eligible For Live', value: readinessEligible ? 'Yes' : 'No', ok: readinessEligible },
                { label: 'Live Execution', value: liveExecutionAllowed ? 'Enabled' : 'Locked', ok: liveExecutionAllowed },
                { label: 'Kill Switch', value: killSwitchEngaged ? 'Engaged' : 'Released', ok: !killSwitchEngaged },
                { label: 'Paper Track Record', value: `${readiness?.stats?.paperTrackRecordDays ?? 0}d`, ok: (readiness?.stats?.paperTrackRecordDays ?? 0) >= 28 },
              ].map(item => (
                <div key={item.label} className="rounded-md bg-zinc-900 px-3 py-2">
                  <div className="text-xs text-zinc-500">{item.label}</div>
                  <div className={cn("mt-1 text-sm font-semibold", item.ok ? "text-emerald-400" : "text-zinc-50")}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {(readiness?.gates ?? []).map((gate: any) => (
                <div key={gate.id} className="flex items-start justify-between rounded-md bg-zinc-900/50 px-3 py-2 text-sm">
                  <div className="pr-3">
                    <div className="font-medium text-zinc-50">{gate.label}</div>
                    <div className="text-xs text-zinc-500">{gate.detail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={gate.passed ? 'success' : 'warning'} className="text-[10px]">
                      {gate.value}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                {(['paper', 'limited_live', 'full_live'] as const).map(profile => (
                  <Button
                    key={profile}
                    size="sm"
                    variant={readiness?.controls?.liveRolloutProfile === profile ? 'default' : 'outline'}
                    disabled={controlPending}
                    onClick={() => handleSetRolloutProfile(profile)}
                  >
                    {profile.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => handleToggleLiveExecution(!readiness?.controls?.liveTradingEnabled)}
                disabled={controlPending || (!readinessEligible && !readiness?.controls?.liveTradingEnabled)}
                variant="outline"
              >
              {controlPending
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</>
                  : readiness?.controls?.liveTradingEnabled
                    ? 'Disable Live Execution'
                    : 'Enable Autonomous Live Execution'
                }
              </Button>
              {killSwitchEngaged && (
                <Button
                  onClick={handleReleaseKillSwitch}
                  disabled={controlPending}
                  variant="outline"
                >
                  Release Kill Switch
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-zinc-400" />
              Autonomous Rollout
            </CardTitle>
            <CardDescription>Execution is fully backend-driven. Operators can change limits or engage the kill switch, but not approve individual trades.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-zinc-900/50 p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Current Profile</span>
                <Badge variant="outline" className="capitalize">
                  {(readiness?.controls?.liveRolloutProfile ?? 'paper').replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Execution Model</span>
                <span className="text-xs text-zinc-400">Fully autonomous</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Per-Trade Intervention</span>
                <span className="text-xs text-zinc-400">Disabled</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Operator Role</span>
                <span className="text-xs text-zinc-400">Audit, limits, kill switch</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              Trade intent, risk checks, broker execution state, and realized outcomes remain visible in Reports and execution logs for post-decision review.
            </p>
          </CardContent>
        </Card>

        {/* ── AI Provider, Models & Global Budget ────────────────────────── */}
        <Card className={cn(aiConfig?.budgetBlocked && "border-red-500/50 bg-red-950/10")}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-5 w-5 text-emerald-400" />
                  AI Provider, Modelle & Globales Budget
                </CardTitle>
                <CardDescription>
                  Wähle den KI-Provider, lade Modelle dynamisch, hinterlege den API-Key und setze ein globales Budgetlimit.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {aiConfig?.budgetBlocked ? (
                  <Badge variant="destructive" className="flex items-center gap-1 animate-pulse">
                    <AlertTriangle className="h-3 w-3" />
                    Budget überschritten (Blockiert)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs">
                    Budget aktiv & überwacht
                  </Badge>
                )}
                <Badge variant="outline" className="uppercase font-mono text-[10px]">
                  {aiConfig?.provider ?? 'GEMINI'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Exceeded budget alert banner */}
            {aiConfig?.budgetBlocked && (
              <div className="rounded-lg border border-red-500/50 bg-red-950/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  AI-Budgetlimit erreicht (${aiConfig.totalSpendUsd.toFixed(4)} / ${aiConfig.budgetLimitUsd.toFixed(2)})
                </div>
                <p className="text-xs text-red-200/80 leading-relaxed">
                  Weitere KI-Aufrufe (Research Ingestion, News-Klassifizierung und Wissenskonsolidierung) sind <strong>automatisch blockiert</strong>, um Kosten zu vermeiden. Erhöhe das Budgetlimit oder setze den Ausgabenzähler zurück, um die Verarbeitung fortzusetzen.
                </p>
                <div className="pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/40 text-red-300 hover:bg-red-900/30 text-xs"
                    onClick={handleResetSpend}
                    disabled={resettingSpend}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {resettingSpend ? "Wird zurückgesetzt..." : "Ausgabenzähler jetzt auf $0.00 zurücksetzen"}
                  </Button>
                </div>
              </div>
            )}

            {/* Provider Selection Buttons */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>1. KI-Provider auswählen</span>
                <span className="text-[11px] text-zinc-500 font-normal">Modelle werden pro Provider automatisch abgefragt</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {[
                  { id: 'gemini',     name: 'Google Gemini', icon: '✨', keyName: 'gemini' },
                  { id: 'openai',     name: 'OpenAI',        icon: '⚡', keyName: 'openai' },
                  { id: 'anthropic',  name: 'Anthropic',     icon: '🧠', keyName: 'anthropic' },
                  { id: 'groq',       name: 'Groq Cloud',    icon: '🚀', keyName: 'groq' },
                  { id: 'openrouter', name: 'OpenRouter',    icon: '🌐', keyName: 'openrouter' },
                  { id: 'ollama',     name: 'Ollama (Lokal)',icon: '💻', keyName: 'ollama' },
                ].map(p => {
                  const isSelected = selectedProvider === p.id
                  const isConfigured = aiConfig?.apiKeysConfigured[p.id as AiProvider]
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id as AiProvider)}
                      className={cn(
                        "flex flex-col items-start p-2.5 rounded-lg border text-left transition-all",
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/10 text-zinc-50 shadow-sm"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      )}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-base">{p.icon}</span>
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isConfigured ? "bg-emerald-500" : p.id === 'ollama' ? "bg-blue-400" : "bg-zinc-600"
                        )} />
                      </div>
                      <span className="text-xs font-medium truncate w-full text-zinc-200">{p.name}</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">
                        {p.id === 'ollama' ? 'Kein Key nötig' : isConfigured ? 'Key hinterlegt' : 'Kein Key'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* API Key & Model Configuration Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* API Key Input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span>2. API-Key für {selectedProvider.toUpperCase()}</span>
                  {aiConfig?.maskedKeys[selectedProvider] && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      Aktiv: {aiConfig.maskedKeys[selectedProvider]}
                    </span>
                  )}
                </label>
                {selectedProvider === 'ollama' ? (
                  <div className="h-9 px-3 rounded-md border border-zinc-800 bg-zinc-900/50 flex items-center text-xs text-zinc-400">
                    Ollama verbindet lokal auf http://localhost:11434 (Kein Key erforderlich).
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={
                        aiConfig?.maskedKeys[selectedProvider]
                          ? `Neuen Key eingeben (vorhanden: ${aiConfig.maskedKeys[selectedProvider]})`
                          : `API Key für ${selectedProvider} eingeben...`
                      }
                      className="w-full h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 pr-9 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      tabIndex={-1}
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-zinc-500">
                  Wird verschlüsselt in der lokalen Datenbank gespeichert.
                </p>
              </div>

              {/* Model Dropdown (Auto-Loaded) / Custom Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <span>3. KI-Modell {isCustomModel ? "(Manuelle Eingabe)" : "(Auto-Loaded)"}</span>
                    {loadingModels && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCustomModel(!isCustomModel)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 underline decoration-zinc-700"
                    >
                      {isCustomModel ? "Aus Liste wählen" : "Eigenes Modell eingeben"}
                    </button>
                    {!isCustomModel && (
                      <button
                        type="button"
                        onClick={() => loadModels(selectedProvider, apiKeyInput || undefined)}
                        disabled={loadingModels}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                      >
                        <RefreshCw className={cn("h-3 w-3", loadingModels && "animate-spin")} />
                        Neu laden
                      </button>
                    )}
                  </div>
                </div>

                {isCustomModel ? (
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="z.B. claude-3-7-sonnet-latest, gpt-4o, gemini-2.5-pro, deepseek-r1..."
                    className="w-full h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 font-mono"
                  />
                ) : (
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger className="w-full h-9 text-xs bg-zinc-950 border-zinc-800 font-mono">
                      <SelectValue placeholder={loadingModels ? "Modelle werden geladen..." : "Modell auswählen..."} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 bg-zinc-950 border-zinc-800">
                      {availableModels.every(m => m.id !== selectedModel) && selectedModel && (
                        <SelectItem value={selectedModel} className="text-xs font-mono">
                          <span className="font-medium text-emerald-400">{selectedModel} (Benutzerdefiniert)</span>
                        </SelectItem>
                      )}
                      {availableModels.map(m => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          <div className="flex flex-col">
                            <span className="font-medium text-zinc-200 font-mono">{m.name}</span>
                            {m.description && (
                              <span className="text-[10px] text-zinc-500 truncate max-w-xs">{m.description}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <p className="text-[11px] text-zinc-500">
                  {availableModels.find(m => m.id === selectedModel)?.description || `Aktives Modell: ${selectedModel}`}
                </p>
              </div>
            </div>

            {/* Global Budget Section */}
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                    <Wallet className="h-4 w-4 text-emerald-400" />
                    Globales AI-Budget & Kostenstopp
                  </div>
                  <p className="text-xs text-zinc-400">
                    Gilt anbieterübergreifend für alle KI-Aufrufe. Bei Überschreitung blockiert das System deterministisch.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-400 whitespace-nowrap">Budgetlimit ($ USD):</label>
                  <div className="relative w-28">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                    <input
                      type="number"
                      step="1.00"
                      min="0.5"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      className="w-full h-8 rounded-md border border-zinc-800 bg-zinc-950 pl-6 pr-2 text-xs text-zinc-100 font-mono focus:border-zinc-700 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Budget Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">
                    Aktuelle Ausgaben: <strong className="text-zinc-200">${(aiConfig?.totalSpendUsd ?? 0).toFixed(4)}</strong>
                  </span>
                  <span className="font-mono text-zinc-400">
                    {aiConfig?.budgetLimitUsd ? `${(aiConfig.spendPercent ?? 0).toFixed(1)}% von $${aiConfig.budgetLimitUsd.toFixed(2)}` : 'Kein Limit'}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-300",
                      (aiConfig?.spendPercent ?? 0) >= 100
                        ? "bg-red-500"
                        : (aiConfig?.spendPercent ?? 0) >= 80
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min(100, aiConfig?.spendPercent ?? 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-0.5">
                  <span>Verbleibend: ${(aiConfig?.remainingBudgetUsd ?? 0).toFixed(4)}</span>
                  <span>{aiConfig?.totalRequests ?? 0} KI-Abfragen insgesamt</span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-zinc-800/60">
                <div className="p-2 rounded bg-zinc-950/40 border border-zinc-800/40 text-center">
                  <div className="text-[10px] text-zinc-500">Gesamtausgaben</div>
                  <div className="text-sm font-semibold font-mono text-zinc-100">${(aiConfig?.totalSpendUsd ?? 0).toFixed(4)}</div>
                </div>
                <div className="p-2 rounded bg-zinc-950/40 border border-zinc-800/40 text-center">
                  <div className="text-[10px] text-zinc-500">Tokens Input</div>
                  <div className="text-sm font-semibold font-mono text-zinc-100">{(aiConfig?.totalTokensInput ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-950/40 border border-zinc-800/40 text-center">
                  <div className="text-[10px] text-zinc-500">Tokens Output</div>
                  <div className="text-sm font-semibold font-mono text-zinc-100">{(aiConfig?.totalTokensOutput ?? 0).toLocaleString()}</div>
                </div>
                <div className="p-2 rounded bg-zinc-950/40 border border-zinc-800/40 text-center">
                  <div className="text-[10px] text-zinc-500">Status</div>
                  <div className={cn("text-xs font-semibold mt-0.5", aiConfig?.budgetBlocked ? "text-red-400" : "text-emerald-400")}>
                    {aiConfig?.budgetBlocked ? "Gesperrt" : "Bereit"}
                  </div>
                </div>
              </div>
            </div>

            {/* Test Connection Output Feedback */}
            {aiTestResult && (
              <div className={cn(
                "rounded-md p-3 text-xs flex items-center justify-between border",
                aiTestResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              )}>
                <div className="flex items-center gap-2">
                  {aiTestResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                  )}
                  <span>
                    {aiTestResult.ok
                      ? `Verbindungstest erfolgreich! Antwort erhalten in ${aiTestResult.latencyMs} ms.`
                      : `Verbindungstest fehlgeschlagen: ${aiTestResult.error}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAiTestResult(null)}
                  className="text-zinc-500 hover:text-zinc-300 ml-2"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {aiSuccessMsg && (
              <div className="rounded-md p-3 text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                {aiSuccessMsg}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestAi}
                  disabled={testingAi}
                  className="text-xs"
                >
                  {testingAi ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Test läuft...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-zinc-400" />
                      Verbindung testen
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetSpend}
                  disabled={resettingSpend}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Ausgaben zurücksetzen
                </Button>
              </div>

              <Button
                size="sm"
                onClick={handleSaveAiConfig}
                disabled={savingAi}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
              >
                {savingAi ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Wird gespeichert...
                  </>
                ) : (
                  <>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Konfiguration & Budget speichern
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Weitere Datenquellen ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4 text-zinc-400" />
              Weitere Datenquellen
            </CardTitle>
            <CardDescription>Marktdaten- und Filing-Provider</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { name: 'Polygon.io',        role: 'OHLCV + Live Prices + Screener', status: 'active', env: 'POLYGON_API_KEY' },
              { name: 'SEC EDGAR',         role: 'Fundamentals + 8-K Filings',     status: 'active', env: 'free (no key)' },
              { name: 'Yahoo Finance RSS', role: 'News Feed',                     status: 'active', env: 'free (no key)' },
              { name: 'FRED API',          role: 'Macro Regime & Yield Indicators',status: 'active', env: 'FRED_API_KEY' },
            ].map(src => (
              <div key={src.name} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-zinc-50">{src.name}</span>
                  <span className="text-zinc-500 ml-2 text-xs">{src.role}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-600 font-mono">{src.env}</span>
                  <Badge variant="success" className="text-[10px]">active</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Agent Status ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-zinc-400" />
              Agent Control
            </CardTitle>
            <CardDescription>Registry-backed agent lifecycle, cadence, and recent health.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleStartAllAgents}>
                Start All
              </Button>
              <Button size="sm" variant="outline" onClick={handleStopAllAgents}>
                Stop All
              </Button>
              <Button size="sm" variant={isAutoTrading ? "destructive" : "outline"} onClick={() => setIsAutoTrading(!isAutoTrading)} disabled={engineTogglePending}>
                {isAutoTrading ? "Stop Coordinator" : "Start Coordinator"}
              </Button>
            </div>
            <div className="space-y-2">
              {agentStatuses.map(agent => (
                <div key={agent.name} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-zinc-100">{agent.name}</div>
                      <div className="text-xs text-zinc-500">
                        {agent.sourceKey} · every {Math.round(agent.intervalMs / 60000)} min
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={agent.running ? 'success' : 'secondary'}>
                        {agent.running ? 'running' : 'stopped'}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => handleToggleAgent(agent.name, agent.running)}>
                        {agent.running ? 'Stop' : 'Start'}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    <div>Last run: {agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleString() : 'Never'}</div>
                    <div>Last success: {agent.lastSuccessAt ? new Date(agent.lastSuccessAt).toLocaleString() : 'Never'}</div>
                    <div>Last usable output: {agent.lastUsableOutputAt ? new Date(agent.lastUsableOutputAt).toLocaleString() : 'Never'}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={agent.cadenceStatus === 'on_time' ? 'success' : agent.cadenceStatus === 'late' ? 'warning' : agent.cadenceStatus === 'missed' ? 'destructive' : 'secondary'} className="text-[10px]">
                        cadence {agent.cadenceStatus ?? 'idle'}
                      </Badge>
                      <Badge variant={agent.freshnessStatus === 'fresh' ? 'success' : agent.freshnessStatus === 'stale' ? 'warning' : 'secondary'} className="text-[10px]">
                        freshness {agent.freshnessStatus ?? 'idle'}
                      </Badge>
                    </div>
                    <div>Errors: {agent.errorCount}</div>
                    <div className={agent.lastError ? 'text-red-400' : 'text-zinc-500'}>
                      {agent.lastError ? `Last error: ${agent.lastError}` : 'No recent error'}
                    </div>
                    <div className="col-span-2 text-zinc-500">
                      {agent.blockedDependencies && agent.blockedDependencies.length > 0
                        ? `Blocked by: ${agent.blockedDependencies.join(', ')}`
                        : 'No blocked dependencies'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Custom Alerts ─────────────────────────────────────────────── */}
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-zinc-400" />
                Custom Alerts
              </CardTitle>
              <CardDescription>Logged to engine_logs when triggered.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setIsAddingAlert(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </CardHeader>
          <CardContent>
            {isAddingAlert && (
              <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-4">
                <div className="flex justify-between">
                  <h4 className="text-sm font-medium text-zinc-50">New Alert</h4>
                  <button onClick={() => setIsAddingAlert(false)} className="text-zinc-400 hover:text-zinc-50">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <input type="text" placeholder="Symbol (e.g. NVDA)" value={newAlert.asset}
                    onChange={e => setNewAlert({ ...newAlert, asset: e.target.value })}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 focus:outline-none" />
                  <Select value={newAlert.type} onValueChange={value => setNewAlert({ ...newAlert, type: value })}>
                    <SelectTrigger className="text-sm text-zinc-50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price">Price Change %</SelectItem>
                      <SelectItem value="rsi">RSI Level</SelectItem>
                      <SelectItem value="drawdown">Portfolio Drawdown %</SelectItem>
                    </SelectContent>
                  </Select>
                  <input type="number" placeholder="Threshold" value={newAlert.threshold}
                    onChange={e => setNewAlert({ ...newAlert, threshold: e.target.value })}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 focus:outline-none" />
                  <Button size="sm" onClick={handleAddAlert} className="bg-zinc-100 text-zinc-900">
                    Save
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {alerts.map(a => (
                <div key={a.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm"
                  onClick={() => setExpandedAlert(expandedAlert === a.id ? null : a.id)}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="w-16 justify-center text-[10px]">{a.asset}</Badge>
                    <span className="text-zinc-300">{a.condition}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{a.lastTriggered}</span>
                    <button onClick={e => { e.stopPropagation(); setAlerts(alerts.filter(x => x.id !== a.id)); }}
                      className="text-zinc-600 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {alerts.length === 0 && !isAddingAlert && (
                <p className="text-center py-4 text-sm text-zinc-500">No alerts configured.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Danger Zone ───────────────────────────────────────────────── */}
        <Card className="md:col-span-2 border-red-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400">
              <Shield className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>Irreversible actions — use with care.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-red-900/30 bg-red-950/20 p-4">
              <div>
                <h4 className="text-sm font-medium text-zinc-50 flex items-center gap-2">
                  <PowerOff className="h-4 w-4 text-red-400" />
                  Emergency Kill Switch
                </h4>
                <p className="text-xs text-zinc-400 mt-1">
                  Stops the AI agent immediately.
                  {brokerStatus?.connected
                    ? ' Cancels all open orders and closes ALL positions via Alpaca.'
                    : ' No broker connected — only stops the simulation.'
                  }
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={handleKillSwitch}
                disabled={killSwitchPending}
                className="flex items-center gap-2 shrink-0 ml-4"
              >
                {killSwitchPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Executing...</>
                  : <><PowerOff className="h-4 w-4" /> Kill Switch</>
                }
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
