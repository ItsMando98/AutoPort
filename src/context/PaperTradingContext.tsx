/**
 * PaperTradingContext — Phase 5
 *
 * The backend (server/portfolio.ts) is now the single source of truth.
 * On mount, state is loaded from /api/portfolio/live.
 * Every 15 seconds, state is synced from the backend (picks up AI trades automatically).
 *
 * executeTrade: calls /api/portfolio/trade (backend) + updates local state optimistically.
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { api } from '@/src/lib/api';

export interface Position {
  symbol: string;
  shares: number;
  avgPrice: number;
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  shares: number;
  price: number;
  timestamp: number;
}

interface PaperTradingContextType {
  cashBalance: number;
  positions: Position[];
  transactions: Transaction[];
  executeTrade: (type: 'BUY' | 'SELL', symbol: string, shares: number, price: number) => Promise<boolean>;
  getPortfolioValue: (currentPrices: Record<string, number>) => number;
}

const PaperTradingContext = createContext<PaperTradingContextType | undefined>(undefined);

export const PaperTradingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cashBalance, setCashBalance]   = useState<number>(100_000);
  const [positions, setPositions]       = useState<Position[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const cashRef      = useRef(cashBalance);
  const positionsRef = useRef(positions);
  useEffect(() => { cashRef.current      = cashBalance; }, [cashBalance]);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

  // ── Sync state from backend ───────────────────────────────────────────────
  const syncFromBackend = async () => {
    const live = await api.getLivePortfolio();
    if (!live) return;
    setCashBalance(live.cash);
    setPositions(live.positions);
    // Transactions come from the trades table (shown in ExecutionLog via api.getTrades)
    // Keep local transactions for immediate UI feedback after manual trades
  };

  // On mount: load from backend first, then fall back to localStorage
  useEffect(() => {
    syncFromBackend().catch(() => {
      // Backend offline — fall back to localStorage
      const saved = localStorage.getItem('paperTradingState');
      if (saved) {
        try {
          const p = JSON.parse(saved);
          setCashBalance(p.cashBalance);
          setPositions(p.positions);
          setTransactions(p.transactions ?? []);
        } catch { /* ignore */ }
      }
    });
  }, []);

  // Poll backend every 15s — automatically picks up AI-executed trades
  useEffect(() => {
    const interval = setInterval(syncFromBackend, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Keep localStorage in sync as backup
  useEffect(() => {
    localStorage.setItem('paperTradingState', JSON.stringify({
      cashBalance, positions, transactions,
    }));
  }, [cashBalance, positions, transactions]);

  // ── Trade Execution ───────────────────────────────────────────────────────
  // Backend is the single source of truth. We send the trade to the backend,
  // then immediately re-sync so the UI reflects the new state without waiting
  // for the next 15s poll.
  const executeTrade = async (
    type: 'BUY' | 'SELL',
    symbol: string,
    shares: number,
    price: number
  ): Promise<boolean> => {
    const result = await api.manualTrade(type, symbol, shares, price);
    if (!result?.ok) return false;

    // Immediately refresh from backend so UI reflects the trade
    await syncFromBackend();

    // Add a local transaction record for immediate UI visibility in trade modals
    const tx: Transaction = {
      id:        Date.now().toString(),
      type,
      symbol,
      shares,
      price,
      timestamp: Date.now(),
    };
    setTransactions(prev => [tx, ...prev]);

    return true;
  };

  const getPortfolioValue = (currentPrices: Record<string, number>) =>
    cashBalance + positions.reduce(
      (sum, pos) => sum + pos.shares * (currentPrices[pos.symbol] || pos.avgPrice),
      0
    );

  return (
    <PaperTradingContext.Provider value={{
      cashBalance, positions, transactions, executeTrade, getPortfolioValue,
    }}>
      {children}
    </PaperTradingContext.Provider>
  );
};

export const usePaperTrading = () => {
  const context = useContext(PaperTradingContext);
  if (context === undefined) {
    throw new Error('usePaperTrading must be used within a PaperTradingProvider');
  }
  return context;
};
