import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/src/lib/api';

export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  name: string;
}

interface MarketDataContextType {
  marketData: Record<string, MarketData>;
  isLoading: boolean;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

const SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'AMD', name: 'Advanced Micro Devices' },
  { symbol: 'INTC', name: 'Intel Corp.' },
  { symbol: 'CRWD', name: 'CrowdStrike' },
  { symbol: 'PLTR', name: 'Palantir Tech' },
];

export const MarketDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchMarketData = async () => {
      const snapshots = await api.getTechnicalAll();
      if (!mounted) return;

      const next: Record<string, MarketData> = {};
      for (const symbolInfo of SYMBOLS) {
        const snapshot = snapshots?.[symbolInfo.symbol];
        if (!snapshot) continue;

        next[symbolInfo.symbol] = {
          symbol: symbolInfo.symbol,
          name: symbolInfo.name,
          price: snapshot.currentPrice,
          change: snapshot.currentPrice * (snapshot.change1d / 100),
          changePercent: snapshot.change1d,
        };
      }

      setMarketData(prev => Object.keys(next).length > 0 ? next : prev);
      setIsLoading(false);
    };

    fetchMarketData();
    const interval = setInterval(fetchMarketData, 10_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <MarketDataContext.Provider value={{ marketData, isLoading }}>
      {children}
    </MarketDataContext.Provider>
  );
};

export const useMarketData = () => {
  const context = useContext(MarketDataContext);
  if (context === undefined) {
    throw new Error('useMarketData must be used within a MarketDataProvider');
  }
  return context;
};
