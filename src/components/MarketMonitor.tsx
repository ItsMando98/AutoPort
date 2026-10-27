import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Search, Newspaper, Clock, ExternalLink, RefreshCw, ArrowRightLeft, Flame, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { useMarketData } from '@/src/context/MarketDataContext';
import { usePaperTrading } from '@/src/context/PaperTradingContext';
import { api, type AutonomyDecision, type FundamentalData, type ResearchEvent, type SignalCandidate, type StoredNewsArticle, type TechnicalSnapshot } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getFundamentalScore(fundamental: FundamentalData | undefined): number | null {
  if (!fundamental) return null;
  let score = 50;
  if ((fundamental.revenueGrowth ?? 0) > 0.15) score += 20;
  else if ((fundamental.revenueGrowth ?? 0) > 0.05) score += 10;
  if ((fundamental.profitMargin ?? 0) > 0.2) score += 15;
  if ((fundamental.peRatio ?? 0) > 0 && (fundamental.peRatio ?? 0) < 35) score += 10;
  if ((fundamental.peRatio ?? 0) > 60) score -= 10;
  return clamp(score, 0, 100);
}

function getIntentVariant(action?: 'BUY' | 'SELL' | 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | null) {
  if (action === 'BUY' || action === 'ADD') return 'success' as const;
  if (action === 'SELL' || action === 'TRIM' || action === 'EXIT') return 'destructive' as const;
  return 'outline' as const;
}

function isActionableIntent(action?: 'BUY' | 'SELL' | 'HOLD' | 'ADD' | 'TRIM' | 'EXIT' | null) {
  return action === 'BUY' || action === 'ADD' || action === 'SELL' || action === 'TRIM' || action === 'EXIT';
}

export function MarketMonitor() {
  const { marketData, isLoading } = useMarketData();
  const { cashBalance, executeTrade, positions } = usePaperTrading();

  const [query, setQuery] = useState('');
  const [newsSort, setNewsSort] = useState<'relevance' | 'recency'>('recency');
  const [newsFeed, setNewsFeed] = useState<StoredNewsArticle[]>([]);
  const [researchEvents, setResearchEvents] = useState<ResearchEvent[]>([]);
  const [signalCandidates, setSignalCandidates] = useState<SignalCandidate[]>([]);
  const [autonomyDecisions, setAutonomyDecisions] = useState<AutonomyDecision[]>([]);
  const [fundamentals, setFundamentals] = useState<Record<string, FundamentalData>>({});
  const [technicals, setTechnicals] = useState<Record<string, TechnicalSnapshot | null>>({});
  const [selectedNews, setSelectedNews] = useState<StoredNewsArticle | null>(null);
  const [squeezeCandidates, setSqueezeCandidates] = useState<any[]>([]);
  const [optionsFlow, setOptionsFlow] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; type: 'BUY' | 'SELL' }>({
    isOpen: false,
    symbol: '',
    type: 'BUY',
  });
  const [tradeShares, setTradeShares] = useState('1');

  const loadData = async () => {
    const [news, events, candidates, autonomy, fundData, techData, squeeze, options] = await Promise.all([
      api.getNews(50),
      api.getResearchEvents(150),
      api.getSignalCandidates(20),
      api.getAutonomyDecisions(undefined, 60),
      api.getFundamentalsAll(),
      api.getTechnicalAll(),
      api.getSqueezeCandidates(),
      api.getOptionsFlow(),
    ]);

    setNewsFeed(news ?? []);
    setResearchEvents(events ?? []);
    setSignalCandidates(candidates ?? []);
    setAutonomyDecisions(autonomy?.decisions ?? []);
    setFundamentals(fundData ?? {});
    setTechnicals(techData ?? {});
    setSqueezeCandidates(squeeze ?? []);
    setOptionsFlow(options ?? []);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15_000);
    return () => clearInterval(interval);
  }, []);

  const sentimentBySymbol = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    for (const event of researchEvents) {
      const score = event.sentiment === 'bullish' ? event.importance * 100 : event.sentiment === 'bearish' ? -event.importance * 100 : 0;
      if (!grouped[event.symbol]) grouped[event.symbol] = [];
      grouped[event.symbol].push(score);
    }

    const result: Record<string, number> = {};
    for (const [symbol, scores] of Object.entries(grouped)) {
      const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      result[symbol] = clamp(Math.round((avg + 100) / 2), 0, 100);
    }
    return result;
  }, [researchEvents]);

  const candidateBySymbol = useMemo(() => {
    const map: Record<string, SignalCandidate | undefined> = {};
    for (const candidate of signalCandidates) {
      if (!map[candidate.symbol]) map[candidate.symbol] = candidate;
    }
    return map;
  }, [signalCandidates]);

  const decisionBySymbol = useMemo(() => {
    const map: Record<string, AutonomyDecision | undefined> = {};
    for (const decision of autonomyDecisions) {
      if (!map[decision.symbol]) map[decision.symbol] = decision;
    }
    return map;
  }, [autonomyDecisions]);

  const assetRows = useMemo(() => {
    return (Object.values(marketData) as Array<(typeof marketData)[string]>)
      .filter(row =>
        row.symbol.toLowerCase().includes(query.toLowerCase()) ||
        row.name.toLowerCase().includes(query.toLowerCase())
      )
      .map(row => {
        const technical = technicals[row.symbol] ?? null;
        const fundamental = fundamentals[row.symbol];
        return {
          ...row,
          technical,
          fundamentalScore: getFundamentalScore(fundamental),
          sentimentScore: sentimentBySymbol[row.symbol] ?? null,
          candidate: candidateBySymbol[row.symbol],
          decision: decisionBySymbol[row.symbol],
        };
      })
      .sort((a, b) => Math.abs((b.decision?.score ?? b.candidate?.score ?? 0)) - Math.abs((a.decision?.score ?? a.candidate?.score ?? 0)));
  }, [marketData, query, technicals, fundamentals, sentimentBySymbol, candidateBySymbol, decisionBySymbol]);

  const notableOptionsFlow = useMemo(() => {
    const latestBySymbol = new Map<string, any>();
    for (const row of optionsFlow) {
      if (!latestBySymbol.has(row.symbol)) latestBySymbol.set(row.symbol, row);
    }
    return Array.from(latestBySymbol.values())
      .filter(row => row.sentiment === 'bullish' || row.sentiment === 'bearish')
      .sort((a, b) => Math.abs(1 - a.put_call_volume_ratio) < Math.abs(1 - b.put_call_volume_ratio) ? 1 : -1)
      .slice(0, 5);
  }, [optionsFlow]);

  const sortedNews = useMemo(() => {
    const rows = [...newsFeed];
    rows.sort((a, b) => {
      if (newsSort === 'relevance') {
        const aScore = a.relevantSymbols.filter(symbol => marketData[symbol]).length;
        const bScore = b.relevantSymbols.filter(symbol => marketData[symbol]).length;
        if (aScore !== bScore) return bScore - aScore;
      }
      return (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt);
    });
    return rows;
  }, [newsFeed, newsSort, marketData]);

  const selectedNewsEvents = useMemo(() => {
    if (!selectedNews) return [];
    return researchEvents.filter(event => event.sourceId === selectedNews.id);
  }, [researchEvents, selectedNews]);

  const handleRefreshNews = async () => {
    setIsRefreshing(true);
    await api.refreshNews();
    await loadData();
    setIsRefreshing(false);
  };

  const [tradeLoading, setTradeLoading] = useState(false);

  const handleTrade = async () => {
    const shares = parseFloat(tradeShares);
    if (Number.isNaN(shares) || shares <= 0) return;

    const price = marketData[tradeModal.symbol]?.price || 0;
    if (price === 0) return;

    setTradeLoading(true);
    const success = await executeTrade(tradeModal.type, tradeModal.symbol, shares, price);
    setTradeLoading(false);

    if (success) {
      toast.success(`${tradeModal.type} order filled`, {
        description: `${tradeShares} shares of ${tradeModal.symbol} at $${price.toFixed(2)}`,
      });
      setTradeModal({ isOpen: false, symbol: '', type: 'BUY' });
      setTradeShares('1');
    } else {
      toast.error('Trade rejected by backend', {
        description: tradeModal.type === 'BUY'
          ? 'Insufficient buying power or risk check failed.'
          : 'Shorting blocked or risk check failed.',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Market Monitor</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search symbols..."
              className="h-9 rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-4 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
            />
          </div>
          <Button variant="outline" className="border-zinc-700" onClick={handleRefreshNews} disabled={isRefreshing}>
            {isRefreshing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh News
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-zinc-800 bg-zinc-900/50 text-xs uppercase text-zinc-400">
                  <tr>
                    <th className="px-6 py-4 font-medium">Asset</th>
                    <th className="px-6 py-4 font-medium text-right">Price</th>
                    <th className="px-6 py-4 font-medium text-right">24h Change</th>
                    <th className="px-6 py-4 font-medium text-center">Research Bias</th>
                    <th className="px-6 py-4 font-medium text-center">Fundamental Score</th>
                    <th className="px-6 py-4 font-medium">Technical State</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Loading backend market data...</td>
                    </tr>
                  ) : assetRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">No matching symbols.</td>
                    </tr>
                  ) : assetRows.map(row => (
                    <tr key={row.symbol} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-50">{row.symbol}</span>
                          <span className="text-xs text-zinc-500">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-zinc-300">${row.price.toFixed(2)}</td>
                      <td className={cn('px-6 py-4 text-right font-mono', row.change >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {row.changePercent >= 0 ? '+' : ''}{row.changePercent.toFixed(2)}%
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full',
                                row.sentimentScore === null
                                  ? 'bg-zinc-700'
                                  : row.sentimentScore >= 60
                                    ? 'bg-emerald-500'
                                    : row.sentimentScore <= 40
                                      ? 'bg-red-500'
                                      : 'bg-amber-500'
                              )}
                              style={{ width: `${row.sentimentScore ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-400 w-6">{row.sentimentScore ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full',
                                row.fundamentalScore === null
                                  ? 'bg-zinc-700'
                                  : row.fundamentalScore >= 70
                                    ? 'bg-emerald-500'
                                    : row.fundamentalScore <= 45
                                      ? 'bg-red-500'
                                      : 'bg-amber-500'
                              )}
                              style={{ width: `${row.fundamentalScore ?? 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-400 w-6">{row.fundamentalScore ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-mono text-zinc-400">
                            {row.technical?.trend.replace(/_/g, ' ').toUpperCase() ?? 'NO DATA'}
                          </span>
                          {row.decision ? (
                            <Badge variant={getIntentVariant(row.decision.action)} className="w-fit text-[10px]">
                              {row.decision.action} {Math.round(row.decision.confidence * 100)}%
                            </Badge>
                          ) : row.candidate && (
                            <Badge variant={getIntentVariant(row.candidate.decisionAction ?? row.candidate.action)} className="w-fit text-[10px]">
                              {(row.candidate.decisionAction ?? row.candidate.action)} {row.candidate.confidence}%
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {(() => {
                          const intentAction = row.decision?.action ?? row.candidate?.decisionAction ?? row.candidate?.action ?? null;
                          const actionable = row.decision
                            ? isActionableIntent(row.decision.action)
                            : Boolean(row.candidate?.actionable);
                          const tradeType = intentAction === 'SELL' || intentAction === 'TRIM' || intentAction === 'EXIT' ? 'SELL' : 'BUY';

                          return (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-zinc-700 hover:bg-zinc-800"
                              onClick={() => setTradeModal({ isOpen: true, symbol: row.symbol, type: tradeType })}
                        >
                              {actionable ? 'Trade' : 'Manual'}
                        </Button>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          {(squeezeCandidates.length > 0 || notableOptionsFlow.length > 0) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-amber-400" />
                  Sentiment Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {squeezeCandidates.slice(0, 3).map(row => (
                  <div key={`squeeze-${row.symbol}`} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-200">{row.symbol}</span>
                    <Badge variant="destructive" className="text-[10px]">Squeeze risk — short ratio {Number(row.short_volume_ratio).toFixed(2)}</Badge>
                  </div>
                ))}
                {notableOptionsFlow.map(row => (
                  <div key={`opt-${row.symbol}`} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-200">{row.symbol}</span>
                    <span className={cn('flex items-center gap-1 text-xs', row.sentiment === 'bullish' ? 'text-emerald-400' : 'text-red-400')}>
                      {row.sentiment === 'bullish' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      PCR {Number(row.put_call_volume_ratio).toFixed(2)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="h-full">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Newspaper className="h-4 w-4 text-zinc-400" />
                Research Feed
              </CardTitle>
              <Select value={newsSort} onValueChange={value => setNewsSort(value as 'relevance' | 'recency')}>
                <SelectTrigger className="h-7 w-auto px-2 text-xs text-zinc-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">Relevance</SelectItem>
                  <SelectItem value="recency">Recency</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="space-y-4">
              {sortedNews.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 text-sm">No stored news yet. Start the backend agent or refresh the feed.</div>
              ) : sortedNews.map(news => (
                <div
                  key={news.id}
                  onClick={() => setSelectedNews(news)}
                  className="flex flex-col gap-2 border-b border-zinc-800/50 pb-4 last:border-0 last:pb-0 cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-[10px] text-zinc-500 font-mono">
                      <Clock className="mr-1 h-3 w-3" />
                      {new Date(news.publishedAt ?? news.createdAt).toLocaleString()}
                    </span>
                    <span className="text-[10px] font-medium text-zinc-400">{news.source ?? 'Unknown'}</span>
                  </div>
                  <h4 className="text-sm font-medium text-zinc-200 leading-snug group-hover:text-blue-400 transition-colors">
                    {news.title}
                  </h4>
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <div className="flex flex-wrap gap-1">
                      {news.relevantSymbols.length > 0 ? news.relevantSymbols.map(symbol => (
                        <Badge key={symbol} variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-zinc-900/50">
                          {symbol}
                        </Badge>
                      )) : (
                        <span className="text-[10px] text-zinc-600">Pending backend classification</span>
                      )}
                    </div>
                    {news.sentiment && news.sentiment !== 'neutral' && (
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          news.sentiment === 'bullish' ? 'bg-emerald-500' : 'bg-red-500'
                        )}
                        title={`Sentiment: ${news.sentiment}`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!selectedNews} onOpenChange={open => !open && setSelectedNews(null)}>
        <DialogContent className="max-w-2xl">
          {selectedNews && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedNews.title}</DialogTitle>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span>{selectedNews.source ?? 'Unknown source'}</span>
                  <span>•</span>
                  <span>{new Date(selectedNews.publishedAt ?? selectedNews.createdAt).toLocaleString()}</span>
                </div>
              </DialogHeader>
              <div className="px-6 pb-6 pt-4 space-y-6">
              <div>
                <h4 className="text-sm font-medium text-zinc-300 mb-2">Stored Summary</h4>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {selectedNews.summary ?? 'This article is stored but not yet classified by the backend agent.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <span className="text-xs text-zinc-500 block mb-1">Sentiment</span>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'h-2 w-2 rounded-full',
                      selectedNews.sentiment === 'bullish'
                        ? 'bg-emerald-500'
                        : selectedNews.sentiment === 'bearish'
                          ? 'bg-red-500'
                          : 'bg-zinc-500'
                    )} />
                    <span className="text-sm font-medium text-zinc-200 capitalize">{selectedNews.sentiment ?? 'pending'}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <span className="text-xs text-zinc-500 block mb-1">Mentioned Symbols</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedNews.relevantSymbols.length > 0 ? selectedNews.relevantSymbols.map(symbol => (
                      <Badge key={symbol} variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-zinc-950">{symbol}</Badge>
                    )) : <span className="text-sm text-zinc-400">None detected yet</span>}
                  </div>
                </div>
              </div>

              {selectedNewsEvents.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-zinc-300">Normalized Research Events</h4>
                  {selectedNewsEvents.map(event => (
                    <div key={event.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={event.sentiment === 'bullish' ? 'success' : event.sentiment === 'bearish' ? 'destructive' : 'outline'}>
                          {event.sentiment}
                        </Badge>
                        <span className="text-xs text-zinc-500">{event.eventType ?? 'general'}</span>
                      </div>
                      <p className="text-sm text-zinc-300 mt-2">{event.summary ?? event.title}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-4 flex justify-end items-center border-t border-zinc-800/50">
                <a href={selectedNews.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  Read full article <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={tradeModal.isOpen} onOpenChange={open => !open && setTradeModal({ isOpen: false, symbol: '', type: 'BUY' })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-emerald-500" />
              Trade {tradeModal.symbol}
            </DialogTitle>
            <p className="text-sm text-zinc-400">Current Price: ${marketData[tradeModal.symbol]?.price.toFixed(2)}</p>
          </DialogHeader>
          <div className="px-6 pb-6 pt-4 space-y-6">
              <div className="flex gap-2 p-1 bg-zinc-900 rounded-lg">
                <button
                  className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors', tradeModal.type === 'BUY' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}
                  onClick={() => setTradeModal(prev => ({ ...prev, type: 'BUY' }))}
                >
                  Buy
                </button>
                <button
                  className={cn('flex-1 py-2 text-sm font-medium rounded-md transition-colors', tradeModal.type === 'SELL' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}
                  onClick={() => setTradeModal(prev => ({ ...prev, type: 'SELL' }))}
                >
                  Sell
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-300">Shares</label>
                  <input
                    type="number"
                    min="1"
                    value={tradeShares}
                    onChange={event => setTradeShares(event.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-50 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700"
                  />
                </div>

                <div className="bg-zinc-900/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-zinc-400">
                    <span>Estimated Cost</span>
                    <span className="text-zinc-200">${((parseFloat(tradeShares) || 0) * (marketData[tradeModal.symbol]?.price || 0)).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Available Cash</span>
                    <span className="text-zinc-200">${cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Current Position</span>
                    <span className="text-zinc-200">{positions.find(position => position.symbol === tradeModal.symbol)?.shares || 0} shares</span>
                  </div>
                </div>
              </div>

              <Button
                className={cn('w-full text-white', tradeModal.type === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700')}
                onClick={handleTrade}
                disabled={tradeLoading}
              >
                {tradeLoading ? 'Submitting...' : `Confirm ${tradeModal.type}`}
              </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
