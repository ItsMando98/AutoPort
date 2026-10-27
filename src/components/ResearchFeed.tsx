import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  BookOpenText,
  Building2,
  ChevronRight,
  Clock3,
  Filter,
  Globe2,
  Info,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/src/components/ui/card';
import { FilterSelect } from '@/src/components/ui/filter-select';
import { Pill } from '@/src/components/ui/pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { api, type ResearchEntityRow, type ResearchFeedResponse, type ResearchStory } from '@/src/lib/api';
import { cn } from '@/src/lib/utils';

type Scope = 'market' | 'sector' | 'stock';
type HoursBack = 24 | 72 | 168;
type Sentiment = 'all' | 'bullish' | 'bearish' | 'neutral';
type SourceType = 'all' | 'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest';

const EMPTY_FEED: ResearchFeedResponse = {
  overview: {
    generatedAt: Date.now(),
    hoursBack: 72,
    totalEventCount: 0,
    totalStoryCount: 0,
    actionableCount: 0,
    freshCount: 0,
    marketBias: 'neutral',
    marketPulseScore: 0,
    topSector: null,
    topSectorScore: null,
    topSymbol: null,
    topSymbolScore: null,
    macroRegime: 'neutral',
    rotationSummary: 'No significant rotation',
  },
  entities: {
    market: [],
    sectors: [],
    stocks: [],
  },
  stories: [],
  selectedEntity: {
    scope: 'market',
    entity: 'MARKET',
    label: 'Market',
    sector: null,
    score: 0,
    eventCount: 0,
    storyCount: 0,
    lastActivityAt: null,
    sentiment: 'neutral',
    actionableCount: 0,
    inPortfolio: false,
    linkedAction: null,
    latestCandidate: null,
    latestDecision: null,
    topSymbols: [],
    rotationSummary: null,
    macro: null,
  },
};

export function ResearchFeed() {
  const [scope, setScope] = useState<Scope>('market');
  const [entity, setEntity] = useState('MARKET');
  const [hoursBack, setHoursBack] = useState<HoursBack>(72);
  const [sentiment, setSentiment] = useState<Sentiment>('all');
  const [sourceType, setSourceType] = useState<SourceType>('all');
  const [actionableOnly, setActionableOnly] = useState(false);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [freshOnly, setFreshOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [feed, setFeed] = useState<ResearchFeedResponse>(EMPTY_FEED);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const next = await api.getResearchFeed({
      scope,
      entity,
      hoursBack,
      limit: 24,
      sentiment,
      sourceType,
      actionableOnly,
      portfolioOnly,
      freshOnly,
    });

    setFeed(next ?? EMPTY_FEED);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    void load(false);
  }, [scope, entity, hoursBack, sentiment, sourceType, actionableOnly, portfolioOnly, freshOnly]);

  useEffect(() => {
    const interval = setInterval(() => {
      void load(true);
    }, 20_000);
    return () => clearInterval(interval);
  }, [scope, entity, hoursBack, sentiment, sourceType, actionableOnly, portfolioOnly, freshOnly]);

  useEffect(() => {
    if (feed.selectedEntity.scope !== scope) setScope(feed.selectedEntity.scope);
    if (feed.selectedEntity.entity !== entity) setEntity(feed.selectedEntity.entity);
  }, [feed.selectedEntity.entity, feed.selectedEntity.scope]);

  useEffect(() => {
    if (feed.stories.length === 0) {
      setSelectedStoryId(null);
      return;
    }
    if (!selectedStoryId || !feed.stories.some(story => story.id === selectedStoryId)) {
      setSelectedStoryId(feed.stories[0].id);
    }
  }, [feed.stories, selectedStoryId]);

  const selectedStory = feed.stories.find(story => story.id === selectedStoryId) ?? null;

  const filteredEntities = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return feed.entities;

    const filterList = (rows: ResearchEntityRow[]) =>
      rows.filter(row =>
        row.label.toLowerCase().includes(query)
        || row.entity.toLowerCase().includes(query)
        || String(row.sector ?? '').toLowerCase().includes(query)
      );

    return {
      market: filterList(feed.entities.market),
      sectors: filterList(feed.entities.sectors),
      stocks: filterList(feed.entities.stocks),
    };
  }, [feed.entities, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-50">Research</h2>
          <p className="text-sm text-zinc-400">
            PM cockpit for market, sector, and stock research with story clustering and signal context.
          </p>
        </div>
        <Button variant="outline" className="gap-2 border-zinc-700" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={<Radar className="h-4 w-4 text-sky-400" />}
          title="Market Pulse"
          value={`${feed.overview.marketBias} · ${feed.overview.marketPulseScore}`}
          detail={`${feed.overview.macroRegime.toUpperCase()} regime`}
          tooltip="Market Pulse is a short-term news-sentiment signal (hours to days) — it can differ from the Macro Regime badge, which reflects medium-term conditions (VIX, yield curve, Fed funds, CPI) over weeks. Seeing them point different directions is expected, not a data error."
        />
        <SummaryCard
          icon={<Building2 className="h-4 w-4 text-amber-400" />}
          title="Top Sector"
          value={feed.overview.topSector ?? '—'}
          detail={feed.overview.topSectorScore !== null ? `Score ${feed.overview.topSectorScore}` : 'No active sector stories'}
        />
        <SummaryCard
          icon={<Target className="h-4 w-4 text-emerald-400" />}
          title="Top Symbol"
          value={feed.overview.topSymbol ?? '—'}
          detail={feed.overview.topSymbolScore !== null ? `Score ${feed.overview.topSymbolScore}` : 'No active symbol stories'}
        />
        <SummaryCard
          icon={<Sparkles className="h-4 w-4 text-fuchsia-400" />}
          title="Actionable"
          value={String(feed.overview.actionableCount)}
          detail={`${feed.overview.totalStoryCount} stories in scope`}
        />
        <SummaryCard
          icon={<Clock3 className="h-4 w-4 text-zinc-300" />}
          title="Freshness"
          value={`${feed.overview.freshCount} fresh`}
          detail={feed.overview.rotationSummary}
        />
      </div>

      <Card className="border-zinc-800/80 bg-zinc-950/80">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-zinc-500" />
              <FilterSelect value={scope} onChange={value => setScope(value as Scope)} options={[
                ['market', 'Market'],
                ['sector', 'Sector'],
                ['stock', 'Stock'],
              ]} />
              <FilterSelect value={String(hoursBack)} onChange={value => setHoursBack(Number(value) as HoursBack)} options={[
                ['24', '24h'],
                ['72', '72h'],
                ['168', '7d'],
              ]} />
              <FilterSelect value={sentiment} onChange={value => setSentiment(value as Sentiment)} options={[
                ['all', 'All Sentiment'],
                ['bullish', 'Bullish'],
                ['bearish', 'Bearish'],
                ['neutral', 'Neutral'],
              ]} />
              <FilterSelect value={sourceType} onChange={value => setSourceType(value as SourceType)} options={[
                ['all', 'All Sources'],
                ['news', 'News'],
                ['filing', 'Filings'],
                ['insider', 'Insiders'],
                ['hedge_fund', 'Hedge Funds'],
                ['options_flow', 'Options Flow'],
                ['short_interest', 'Short Interest'],
              ]} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Toggle label="Actionable only" active={actionableOnly} onClick={() => setActionableOnly(value => !value)} />
              <Toggle label="Portfolio only" active={portfolioOnly} onClick={() => setPortfolioOnly(value => !value)} />
              <Toggle label="Fresh only" active={freshOnly} onClick={() => setFreshOnly(value => !value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <Card className="border-zinc-800/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Research Universe</CardTitle>
            <CardDescription>Market, sectors, and tracked symbols in the active filter set.</CardDescription>
            <div className="relative pt-2">
              <Search className="absolute left-3 top-5 h-4 w-4 text-zinc-500" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search entities..."
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-700"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <EntityGroup
              title="Market"
              icon={<Globe2 className="h-4 w-4 text-sky-400" />}
              rows={filteredEntities.market}
              activeEntity={entity}
              activeScope={scope}
              onSelect={(nextScope, nextEntity) => {
                setScope(nextScope);
                setEntity(nextEntity);
              }}
            />
            <EntityGroup
              title="Sectors"
              icon={<Building2 className="h-4 w-4 text-amber-400" />}
              rows={filteredEntities.sectors}
              activeEntity={entity}
              activeScope={scope}
              onSelect={(nextScope, nextEntity) => {
                setScope(nextScope);
                setEntity(nextEntity);
              }}
            />
            <EntityGroup
              title="Stocks"
              icon={<BookOpenText className="h-4 w-4 text-emerald-400" />}
              rows={filteredEntities.stocks}
              activeEntity={entity}
              activeScope={scope}
              onSelect={(nextScope, nextEntity) => {
                setScope(nextScope);
                setEntity(nextEntity);
              }}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{feed.selectedEntity.label}</CardTitle>
                  <CardDescription>
                    {feed.selectedEntity.scope === 'market'
                      ? 'Top-down market context and market-wide catalysts.'
                      : feed.selectedEntity.scope === 'sector'
                        ? 'Sector-level clustering across tracked names plus market overlay.'
                        : 'Single-name story clusters with raw event drill-down.'}
                  </CardDescription>
                </div>
                {feed.selectedEntity.linkedAction && (
                  <Badge variant={actionVariant(feed.selectedEntity.linkedAction)}>
                    {feed.selectedEntity.linkedAction}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Score" value={String(feed.selectedEntity.score)} />
              <Metric label="Stories" value={String(feed.selectedEntity.storyCount)} />
              <Metric label="Events" value={String(feed.selectedEntity.eventCount)} />
              <Metric
                label="Last Activity"
                value={feed.selectedEntity.lastActivityAt ? relativeTime(feed.selectedEntity.lastActivityAt) : 'n/a'}
              />
            </CardContent>
          </Card>

          <div className="space-y-3">
            {loading ? (
              <Card>
                <CardContent className="py-16 text-center text-sm text-zinc-500">
                  Loading research feed...
                </CardContent>
              </Card>
            ) : feed.stories.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center text-sm text-zinc-500">
                  No clustered stories match the current filters.
                </CardContent>
              </Card>
            ) : feed.stories.map(story => (
              <div key={story.id}>
                <StoryCard
                  story={story}
                  active={story.id === selectedStoryId}
                  onClick={() => setSelectedStoryId(story.id)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Entity Detail</CardTitle>
              <CardDescription>Signal context, portfolio relevance, and cross-links.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Entity Sentiment</div>
                <div className="flex flex-wrap gap-2">
                <Badge variant={sentimentVariant(feed.selectedEntity.sentiment)}>
                  {feed.selectedEntity.sentiment}
                </Badge>
                {feed.selectedEntity.inPortfolio && <Badge variant="warning">In Portfolio</Badge>}
                {feed.selectedEntity.sector && <Badge variant="outline">{feed.selectedEntity.sector}</Badge>}
                {feed.selectedEntity.latestCandidate && (
                  <Badge variant={actionVariant(feed.selectedEntity.latestCandidate.decisionAction ?? feed.selectedEntity.latestCandidate.action)}>
                    Candidate {feed.selectedEntity.latestCandidate.decisionAction ?? feed.selectedEntity.latestCandidate.action}
                  </Badge>
                )}
                {feed.selectedEntity.latestDecision && feed.selectedEntity.latestDecision.action !== 'HOLD' && (
                  <Badge variant={actionVariant(feed.selectedEntity.latestDecision.action)}>
                    Decision {feed.selectedEntity.latestDecision.action}
                  </Badge>
                )}
                </div>
              </div>

              {feed.selectedEntity.macro && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="inline-flex cursor-help items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                        Macro Regime <Info className="h-3 w-3 text-zinc-600" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      Medium-term market backdrop (weeks), independent of this entity's short-term sentiment above — they can disagree.
                    </TooltipContent>
                  </Tooltip>
                  <div className="mt-1 text-sm font-medium text-zinc-100">{feed.selectedEntity.macro.regime.toUpperCase()}</div>
                  <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {feed.selectedEntity.macro.reasoning ?? 'No regime reasoning available.'}
                  </div>
                </div>
              )}

              {feed.selectedEntity.rotationSummary && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rotation</div>
                  <div className="mt-1">{feed.selectedEntity.rotationSummary}</div>
                </div>
              )}

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Top Symbols</div>
                <div className="space-y-2">
                  {feed.selectedEntity.topSymbols.length === 0 ? (
                    <div className="text-sm text-zinc-500">No related symbols in the current selection.</div>
                  ) : feed.selectedEntity.topSymbols.map(item => (
                    <button
                      key={item.symbol}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left transition hover:border-zinc-700"
                      onClick={() => {
                        setScope('stock');
                        setEntity(item.symbol);
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{item.symbol}</div>
                        <div className="text-xs text-zinc-500">{item.label}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-zinc-100">{item.score}</div>
                        <div className="text-[11px] text-zinc-500">{item.linkedAction ?? 'watch'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Story Detail</CardTitle>
              <CardDescription>Cluster summary, raw events, and linked articles.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedStory ? (
                <div className="text-sm text-zinc-500">Select a story to inspect the underlying events.</div>
              ) : (
                <>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={sentimentVariant(selectedStory.sentiment)}>{selectedStory.sentiment}</Badge>
                      <Badge variant="outline">Score {selectedStory.storyScore}</Badge>
                      {selectedStory.linkedAction && (
                        <Badge variant={actionVariant(selectedStory.linkedAction)}>{selectedStory.linkedAction}</Badge>
                      )}
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-zinc-50">{selectedStory.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                      {selectedStory.summary ?? 'No normalized summary available for this story cluster.'}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Metric label="Research" value={String(selectedStory.researchScore)} />
                    <Metric label="Confirmation" value={`+${selectedStory.confirmationBonus}`} />
                    <Metric label="Action" value={`+${selectedStory.actionBonus}`} />
                    <Metric label="Freshness" value={`${selectedStory.freshnessBonus >= 0 ? '+' : ''}${selectedStory.freshnessBonus}`} />
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Linked Articles</div>
                    <div className="space-y-2">
                      {selectedStory.relatedArticles.length === 0 ? (
                        <div className="text-sm text-zinc-500">No linked news articles in this cluster.</div>
                      ) : selectedStory.relatedArticles.map(article => (
                        <a
                          key={article.id}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 transition hover:border-zinc-700"
                        >
                          <div className="text-sm font-medium text-zinc-100">{article.title}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {article.source ?? 'Unknown source'}
                            {article.publishedAt ? ` · ${relativeTime(article.publishedAt)}` : ''}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Raw Events</div>
                    <div className="space-y-2">
                      {selectedStory.events.map(event => (
                        <div key={event.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{event.sourceType}</Badge>
                            <Badge variant={sentimentVariant(event.sentiment)}>{event.sentiment}</Badge>
                            <span className="text-xs text-zinc-500">{event.symbol}</span>
                            {event.action && <Badge variant={actionVariant(event.action)}>{event.action}</Badge>}
                          </div>
                          <div className="mt-2 text-sm font-medium text-zinc-100">{event.title}</div>
                          <div className="mt-1 text-xs leading-relaxed text-zinc-400">
                            {event.summary ?? 'No normalized event summary.'}
                          </div>
                          <div className="mt-2 text-[11px] text-zinc-500">
                            Importance {Math.round(event.importance * 100)} · {relativeTime(event.eventTimestamp)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, title, value, detail, tooltip }: { icon: ReactNode; title: string; value: string; detail: string; tooltip?: string }) {
  const titleEl = (
    <div className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1">
      {title}
      {tooltip && <Info className="h-3 w-3 text-zinc-600" />}
    </div>
  );
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          {tooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">{titleEl}</div>
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          ) : titleEl}
          <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
          <div className="mt-1 text-xs text-zinc-500">{detail}</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-zinc-100">{value}</div>
    </div>
  );
}

function EntityGroup({
  title,
  icon,
  rows,
  activeScope,
  activeEntity,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  rows: ResearchEntityRow[];
  activeScope: Scope;
  activeEntity: string;
  onSelect: (scope: Scope, entity: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {icon}
          {title}
        </div>
        <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-sm text-zinc-500">
          No entities in this filter set.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <button
            key={`${row.kind}-${row.entity}`}
            onClick={() => onSelect(row.kind, row.entity)}
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-left transition',
              activeScope === row.kind && activeEntity === row.entity
                ? 'border-zinc-600 bg-zinc-900'
                : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/60'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-100">{row.kind === 'stock' ? row.entity : row.label}</div>
                <div className="truncate text-xs text-zinc-500">{row.kind === 'stock' ? row.label : row.topStoryTitle ?? 'No story title'}</div>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={sentimentVariant(row.sentiment)}>{row.sentiment}</Badge>
              <Badge variant="outline">S {row.score}</Badge>
              <Badge variant="outline">E {row.eventCount}</Badge>
              {row.linkedAction && <Badge variant={actionVariant(row.linkedAction)}>{row.linkedAction}</Badge>}
              {row.inPortfolio && <Badge variant="warning">Portfolio</Badge>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StoryCard({ story, active, onClick }: { story: ResearchStory; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition',
        active ? 'border-zinc-600 bg-zinc-900/80' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/50'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={sentimentVariant(story.sentiment)}>{story.sentiment}</Badge>
        <Badge variant="outline">Score {story.storyScore}</Badge>
        <Badge variant="outline">{story.eventCount} events</Badge>
        {story.linkedAction && <Badge variant={actionVariant(story.linkedAction)}>{story.linkedAction}</Badge>}
        {story.topSymbol && <Badge variant="secondary">{story.topSymbol}</Badge>}
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-base font-semibold text-zinc-100">{story.title}</div>
          <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-400">
            {story.summary ?? 'No normalized summary available for this story cluster.'}
          </div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>{relativeTime(story.latestEventAt)}</div>
          <div className="mt-1">{story.sourceTypes.join(', ')}</div>
        </div>
      </div>
    </button>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Pill
      onClick={onClick}
      active={active}
      activeClassName="border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
      className="py-1.5"
    >
      {label}
    </Pill>
  );
}

function sentimentVariant(sentiment: string) {
  if (sentiment === 'bullish') return 'success' as const;
  if (sentiment === 'bearish') return 'destructive' as const;
  return 'outline' as const;
}

function actionVariant(action: string | null | undefined) {
  if (action === 'BUY' || action === 'ADD') return 'success' as const;
  if (action === 'SELL' || action === 'TRIM' || action === 'EXIT') return 'destructive' as const;
  return 'outline' as const;
}

function relativeTime(value: number) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}
