/**
 * AutoTradingContext — Phase 5
 *
 * The trading loop now runs entirely in the backend (server/agent.ts).
 * This context is a thin polling wrapper: it reads agent status + logs from
 * the backend every 5 seconds and exposes them to the UI.
 *
 * setIsAutoTrading(true)  → POST /api/agent/start
 * setIsAutoTrading(false) → POST /api/agent/stop
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, type AgentStatus } from '@/src/lib/api';

export interface EngineLog {
  id: string;
  timestamp: number;
  type: 'HYPOTHESIS' | 'DECISION' | 'RISK_CHECK' | 'MONITOR' | 'ERROR';
  asset: string;
  content: string;
  action: string;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'COMPLETED';
}

interface AutoTradingContextType {
  isAutoTrading: boolean;
  setIsAutoTrading: (val: boolean) => void;
  engineTogglePending: boolean;
  engineLogs: EngineLog[];
  clearLogs: () => void;
  agentStatuses: AgentStatus[];
  lastCycleTime: number | null;
  cycleCount: number;
  mode: string;
  degraded: boolean;
  killSwitchEngaged: boolean;
  liveExecutionAllowed: boolean;
  readinessEligible: boolean;
}

const AutoTradingContext = createContext<AutoTradingContextType | undefined>(undefined);

export const AutoTradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAutoTrading, setIsAutoTradingState] = useState(false);
  const [engineLogs, setEngineLogs]             = useState<EngineLog[]>([]);
  const [agentStatuses, setAgentStatuses]       = useState<AgentStatus[]>([]);
  const [lastCycleTime, setLastCycleTime]       = useState<number | null>(null);
  const [cycleCount, setCycleCount]             = useState(0);
  const [mode, setMode]                         = useState('paper');
  const [degraded, setDegraded]                 = useState(false);
  const [killSwitchEngaged, setKillSwitchEngaged] = useState(false);
  const [liveExecutionAllowed, setLiveExecutionAllowed] = useState(false);
  const [readinessEligible, setReadinessEligible] = useState(false);
  const [engineTogglePending, setEngineTogglePending] = useState(false);

  // Poll backend every 5 seconds for agent status + logs
  useEffect(() => {
    let mounted = true;

    const syncCoordinatorState = async () => {
      const [status, logs] = await Promise.all([
        api.getAgentStatus(),
        api.getAgentLogs(200),
      ]);
      const statuses = await api.getAgentStatuses();

      if (!mounted) return;

      setAgentStatuses(statuses ?? []);
      if (status) {
        setIsAutoTradingState(status.running);
        setLastCycleTime(status.lastCycleAt);
        setCycleCount(status.cycleCount);
        setMode(status.mode ?? 'paper');
        setDegraded(Boolean(status.degraded));
        setKillSwitchEngaged(Boolean(status.killSwitchEngaged));
        setLiveExecutionAllowed(Boolean(status.liveExecutionAllowed));
        setReadinessEligible(Boolean(status.readinessEligible));
      }

      if (logs && logs.length > 0) {
        setEngineLogs(logs.map((l: any) => ({
          id:        l.id,
          timestamp: l.timestamp,
          type:      (l.type || l.log_type) as EngineLog['type'],
          asset:     l.asset || 'SYSTEM',
          content:   l.content,
          action:    l.action || '',
          status:    (l.status || 'COMPLETED') as EngineLog['status'],
        })));
      }
    };

    syncCoordinatorState();
    const interval = setInterval(syncCoordinatorState, 5_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const setIsAutoTrading = async (val: boolean) => {
    if (engineTogglePending) return;
    const previous = isAutoTrading;
    setIsAutoTradingState(val);
    setEngineTogglePending(true);
    const response = val
      ? await api.startAgent()
      : await api.stopAgent();

    if (!response) {
      const status = await api.getAgentStatus();
      setIsAutoTradingState(status?.running ?? previous);
    }
    setEngineTogglePending(false);
  };

  const clearLogs = () => setEngineLogs([]);

  return (
    <AutoTradingContext.Provider value={{
      isAutoTrading, setIsAutoTrading, engineTogglePending, engineLogs, clearLogs, agentStatuses, lastCycleTime, cycleCount, mode, degraded, killSwitchEngaged, liveExecutionAllowed, readinessEligible,
    }}>
      {children}
    </AutoTradingContext.Provider>
  );
};

export const useAutoTrading = () => {
  const context = useContext(AutoTradingContext);
  if (context === undefined) {
    throw new Error('useAutoTrading must be used within an AutoTradingProvider');
  }
  return context;
};
