import db from './db.js';
import { getLatestDecisionBatches } from './autonomy.js';
import { getLatestMacroRegime } from './macro.js';
import { getState as getPortfolioState } from './portfolio.js';
import {
  getSignalCandidates,
  scoreResearchEvents,
  type ResearchEvent,
  type ResearchSentiment,
  type ResearchSourceType,
  type SignalCandidate,
} from './research.js';
import { calculateSectorPerformance, getRotationSummary } from './sectorrotation.js';
import { ALL_SYMBOLS, COMPANY_INFO, getCompanyName, getSector } from './universe.js';

export type ResearchFeedScope = 'market' | 'sector' | 'stock';
export type ResearchFeedSentimentFilter = 'all' | ResearchSentiment;
export type ResearchFeedSourceFilter = 'all' | ResearchSourceType;

export interface ResearchStoryEvent {
  id: string;
  sourceType: ResearchSourceType;
  sourceId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  title: string;
  summary: string | null;
  sentiment: ResearchSentiment;
  eventType: string | null;
  importance: number;
  url: string | null;
  eventTimestamp: number;
  createdAt: number;
  ageHours: number;
  inPortfolio: boolean;
  action: string | null;
  linkedArticle: {
    id: string;
    title: string;
    url: string;
    source: string | null;
    publishedAt: number | null;
  } | null;
}

export interface ResearchStory {
  id: string;
  scope: ResearchFeedScope;
  entity: string;
  title: string;
  summary: string | null;
  sentiment: ResearchSentiment;
  storyScore: number;
  researchScore: number;
  confirmationBonus: number;
  actionBonus: number;
  freshnessBonus: number;
  eventCount: number;
  sourceTypes: ResearchSourceType[];
  symbols: string[];
  topSymbol: string | null;
  sector: string | null;
  actionable: boolean;
  linkedAction: string | null;
  latestEventAt: number;
  sourceEventIds: string[];
  relatedArticles: Array<{
    id: string;
    title: string;
    url: string;
    source: string | null;
    publishedAt: number | null;
  }>;
  events: ResearchStoryEvent[];
}

export interface ResearchEntityRow {
  kind: 'market' | 'sector' | 'stock';
  entity: string;
  label: string;
  sector: string | null;
  score: number;
  eventCount: number;
  storyCount: number;
  lastActivityAt: number | null;
  sentiment: ResearchSentiment;
  actionable: boolean;
  linkedAction: string | null;
  inPortfolio: boolean;
  freshness: 'fresh' | 'stale';
  topStoryTitle: string | null;
}

export interface ResearchOverview {
  generatedAt: number;
  hoursBack: number;
  totalEventCount: number;
  totalStoryCount: number;
  actionableCount: number;
  freshCount: number;
  marketBias: ResearchSentiment;
  marketPulseScore: number;
  topSector: string | null;
  topSectorScore: number | null;
  topSymbol: string | null;
  topSymbolScore: number | null;
  macroRegime: string;
  rotationSummary: string;
}

export interface ResearchSelectedEntity {
  scope: ResearchFeedScope;
  entity: string;
  label: string;
  sector: string | null;
  score: number;
  eventCount: number;
  storyCount: number;
  lastActivityAt: number | null;
  sentiment: ResearchSentiment;
  actionableCount: number;
  inPortfolio: boolean;
  linkedAction: string | null;
  latestCandidate: SignalCandidate | null;
  latestDecision: Record<string, any> | null;
  topSymbols: Array<{
    symbol: string;
    label: string;
    score: number;
    linkedAction: string | null;
    inPortfolio: boolean;
  }>;
  rotationSummary: string | null;
  macro: {
    regime: string;
    reasoning: string | null;
    computedAt: number | null;
  } | null;
}

export interface ResearchFeedResponse {
  overview: ResearchOverview;
  entities: {
    market: ResearchEntityRow[];
    sectors: ResearchEntityRow[];
    stocks: ResearchEntityRow[];
  };
  stories: ResearchStory[];
  selectedEntity: ResearchSelectedEntity;
}

export interface ResearchFeedParams {
  scope?: string;
  entity?: string;
  hoursBack?: number;
  limit?: number;
  sentiment?: string;
  sourceType?: string;
  actionableOnly?: boolean;
  portfolioOnly?: boolean;
  freshOnly?: boolean;
}

interface CompanyMeta {
  symbol: string;
  name: string;
  sector: string;
}

interface NewsArticleLink {
  id: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: number | null;
}

interface FeedContext {
  now: number;
  hoursBack: number;
  limit: number;
  actionableOnly: boolean;
  freshOnly: boolean;
  portfolioOnly: boolean;
  companyBySymbol: Map<string, CompanyMeta>;
  candidateBySymbol: Map<string, SignalCandidate>;
  decisionBySymbol: Map<string, Record<string, any>>;
  articleById: Map<string, NewsArticleLink>;
  portfolioSymbols: Set<string>;
}

interface StoryInput {
  scope: ResearchFeedScope;
  entity: string;
  events: ResearchEvent[];
}

export function getResearchFeed(params: ResearchFeedParams = {}): ResearchFeedResponse {
  const now = Date.now();
  const hoursBack = normalizeHoursBack(params.hoursBack);
  const limit = normalizeLimit(params.limit);
  const scope = normalizeScope(params.scope);
  const sentiment = normalizeSentiment(params.sentiment);
  const sourceType = normalizeSourceType(params.sourceType);
  const actionableOnly = Boolean(params.actionableOnly);
  const portfolioOnly = Boolean(params.portfolioOnly);
  const freshOnly = Boolean(params.freshOnly);

  const portfolioSymbols = new Set(getPortfolioState().positions.map(position => position.symbol.toUpperCase()));
  const companyBySymbol = loadCompanyMetadata();
  const candidateBySymbol = getLatestCandidatesBySymbol();
  const decisionBySymbol = getLatestActionableDecisionsBySymbol();
  const trackedSymbols = new Set<string>([...ALL_SYMBOLS, ...companyBySymbol.keys(), ...portfolioSymbols, ...candidateBySymbol.keys(), ...decisionBySymbol.keys()]);

  const cutoff = Math.floor((now - hoursBack * 60 * 60 * 1000) / 1000);
  const rows = db.prepare(`
    SELECT *
    FROM research_events
    WHERE event_timestamp >= ?
    ORDER BY event_timestamp DESC, created_at DESC
  `).all(cutoff) as any[];

  const events = rows
    .map(rowToResearchEvent)
    .filter(event => event.symbol === 'MARKET' || trackedSymbols.has(event.symbol))
    .filter(event => sentiment === 'all' ? true : event.sentiment === sentiment)
    .filter(event => sourceType === 'all' ? true : event.sourceType === sourceType)
    .filter(event => portfolioOnly ? event.symbol === 'MARKET' || portfolioSymbols.has(event.symbol) : true);

  const articleById = loadArticlesForEvents(events);
  const context: FeedContext = {
    now,
    hoursBack,
    limit,
    actionableOnly,
    freshOnly,
    portfolioOnly,
    companyBySymbol,
    candidateBySymbol,
    decisionBySymbol,
    articleById,
    portfolioSymbols,
  };

  const marketEvents = events.filter(event => event.symbol === 'MARKET');
  const stockEvents = events.filter(event => event.symbol !== 'MARKET');
  const sectorPerformance = calculateSectorPerformance();
  const rotationSummary = getRotationSummary(sectorPerformance);
  const macro = getLatestMacroRegime();

  const stockStoriesBySymbol = new Map<string, ResearchStory[]>();
  for (const [symbol, symbolEvents] of groupBy(stockEvents, event => event.symbol)) {
    const stories = buildStories({ scope: 'stock', entity: symbol, events: symbolEvents }, context);
    if (stories.length > 0) stockStoriesBySymbol.set(symbol, stories);
  }

  const stockEntities = [...stockStoriesBySymbol.entries()]
    .map(([symbol, stories]) => buildEntityRow('stock', symbol, stories, stockEvents.filter(event => event.symbol === symbol), context))
    .filter(Boolean) as ResearchEntityRow[];

  const sectorEventsBySector = new Map<string, ResearchEvent[]>();
  for (const event of stockEvents) {
    const sector = getCompanySector(event.symbol, companyBySymbol);
    if (!sectorEventsBySector.has(sector)) sectorEventsBySector.set(sector, []);
    sectorEventsBySector.get(sector)!.push(event);
  }

  const sectorStoriesByName = new Map<string, ResearchStory[]>();
  for (const [sector, symbolEvents] of sectorEventsBySector.entries()) {
    const stories = buildStories({ scope: 'sector', entity: sector, events: [...symbolEvents, ...marketEvents] }, context);
    if (stories.length > 0) sectorStoriesByName.set(sector, stories);
  }

  const sectorEntities = [...sectorStoriesByName.entries()]
    .map(([sector, stories]) => buildEntityRow('sector', sector, stories, [...(sectorEventsBySector.get(sector) ?? []), ...marketEvents], context))
    .filter(Boolean) as ResearchEntityRow[];

  const marketStories = buildStories({ scope: 'market', entity: 'MARKET', events: marketEvents }, context);
  const marketEntities = buildEntityRow('market', 'MARKET', marketStories, marketEvents, context)
    ? [buildEntityRow('market', 'MARKET', marketStories, marketEvents, context)!]
    : [];

  const filteredEntities = {
    market: filterEntityRows(marketEntities, context),
    sectors: filterEntityRows(sortEntities(sectorEntities), context),
    stocks: filterEntityRows(sortEntities(stockEntities), context),
  };

  const selection = normalizeSelection({
    requestedScope: scope,
    requestedEntity: normalizeEntity(params.entity),
    entities: filteredEntities,
  });

  const stories = selection.scope === 'market'
    ? marketStories
    : selection.scope === 'sector'
      ? (sectorStoriesByName.get(selection.entity) ?? [])
      : (stockStoriesBySymbol.get(selection.entity) ?? []);

  const selectedStories = filterStories(stories, context).slice(0, limit);
  const selectedEntity = buildSelectedEntity({
    scope: selection.scope,
    entity: selection.entity,
    entityRows: filteredEntities,
    stockStoriesBySymbol,
    sectorStoriesByName,
    sectorEventsBySector,
    stockEntities: filteredEntities.stocks,
    marketStories,
    macro,
    rotationSummary,
    context,
  });

  const overview: ResearchOverview = {
    generatedAt: now,
    hoursBack,
    totalEventCount: events.length,
    totalStoryCount: filteredEntities.market.reduce((sum, row) => sum + row.storyCount, 0)
      + filteredEntities.sectors.reduce((sum, row) => sum + row.storyCount, 0)
      + filteredEntities.stocks.reduce((sum, row) => sum + row.storyCount, 0),
    actionableCount: [
      ...filteredEntities.market,
      ...filteredEntities.sectors,
      ...filteredEntities.stocks,
    ].filter(row => row.actionable).length,
    freshCount: [
      ...filteredEntities.market,
      ...filteredEntities.sectors,
      ...filteredEntities.stocks,
    ].filter(row => row.freshness === 'fresh').length,
    marketBias: marketEntities[0]?.sentiment ?? 'neutral',
    marketPulseScore: marketEntities[0]?.score ?? 0,
    topSector: filteredEntities.sectors[0]?.label ?? null,
    topSectorScore: filteredEntities.sectors[0]?.score ?? null,
    topSymbol: filteredEntities.stocks[0]?.entity ?? null,
    topSymbolScore: filteredEntities.stocks[0]?.score ?? null,
    macroRegime: macro.regime,
    rotationSummary,
  };

  return {
    overview,
    entities: filteredEntities,
    stories: selectedStories,
    selectedEntity,
  };
}

function loadCompanyMetadata(): Map<string, CompanyMeta> {
  const companyBySymbol = new Map<string, CompanyMeta>();
  for (const symbol of ALL_SYMBOLS) {
    companyBySymbol.set(symbol, {
      symbol,
      name: COMPANY_INFO[symbol]?.name ?? getCompanyName(symbol),
      sector: COMPANY_INFO[symbol]?.sector ?? getSector(symbol),
    });
  }

  const rows = db.prepare(`
    SELECT symbol, name, sector
    FROM companies
  `).all() as any[];

  for (const row of rows) {
    const symbol = String(row.symbol ?? '').toUpperCase();
    if (!symbol) continue;
    companyBySymbol.set(symbol, {
      symbol,
      name: row.name ?? companyBySymbol.get(symbol)?.name ?? symbol,
      sector: row.sector ?? companyBySymbol.get(symbol)?.sector ?? 'Other',
    });
  }

  return companyBySymbol;
}

function getLatestCandidatesBySymbol(): Map<string, SignalCandidate> {
  const rows = getSignalCandidates(500);
  const map = new Map<string, SignalCandidate>();
  for (const row of rows) {
    if (!map.has(row.symbol)) map.set(row.symbol, row);
  }
  return map;
}

function getLatestActionableDecisionsBySymbol(): Map<string, Record<string, any>> {
  const rows = getLatestDecisionBatches(500);
  const map = new Map<string, Record<string, any>>();
  for (const row of rows) {
    if (map.has(row.symbol)) continue;
    map.set(row.symbol, row);
  }
  return map;
}

function loadArticlesForEvents(events: ResearchEvent[]): Map<string, NewsArticleLink> {
  const ids = [...new Set(events.filter(event => event.sourceType === 'news').map(event => event.sourceId))];
  if (ids.length === 0) return new Map();

  const rows = db.prepare(`
    SELECT id, title, url, source, published_at
    FROM news_articles
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as any[];

  const map = new Map<string, NewsArticleLink>();
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      title: row.title,
      url: row.url,
      source: row.source ?? null,
      publishedAt: row.published_at ? row.published_at * 1000 : null,
    });
  }
  return map;
}

function buildStories(input: StoryInput, context: FeedContext): ResearchStory[] {
  const clusters = new Map<string, ResearchEvent[]>();
  const dedupe = new Map<string, Set<string>>();

  for (const event of input.events.sort((a, b) => b.eventTimestamp - a.eventTimestamp)) {
    const bucket = Math.floor(event.eventTimestamp / (24 * 60 * 60 * 1000));
    const clusterKey = `${input.scope}|${input.entity}|${normalizeClusterTopic(event)}|${bucket}`;
    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, []);
      dedupe.set(clusterKey, new Set<string>());
    }

    const uniqueKey = `${event.sourceType}:${event.sourceId}:${event.symbol}`;
    if (dedupe.get(clusterKey)!.has(uniqueKey)) continue;
    dedupe.get(clusterKey)!.add(uniqueKey);
    clusters.get(clusterKey)!.push(event);
  }

  return [...clusters.entries()]
    .map(([clusterId, events]) => buildStory(clusterId, input.scope, input.entity, events, context))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.storyScore !== a.storyScore) return b.storyScore - a.storyScore;
      return b.latestEventAt - a.latestEventAt;
    })
    .slice(0, Math.max(context.limit * 2, 12));
}

function buildStory(
  clusterId: string,
  scope: ResearchFeedScope,
  entity: string,
  events: ResearchEvent[],
  context: FeedContext,
): ResearchStory | null {
  if (events.length === 0) return null;

  const sorted = [...events].sort((a, b) => b.eventTimestamp - a.eventTimestamp);
  const strengthByEvent = sorted.map(event => ({ event, value: getWeightedEventStrength(event, scope) }));
  const strongest = strengthByEvent.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  const relatedSymbols = [...new Set(sorted.filter(event => event.symbol !== 'MARKET').map(event => event.symbol))];
  const sourceTypes = [...new Set(sorted.map(event => event.sourceType))];
  const sourceEventIds = [...new Set(sorted.map(event => event.id))];
  const aggregate = scoreResearchEvents(sorted.filter(event => scope !== 'sector' || event.symbol !== 'MARKET').length > 0
    ? sorted.filter(event => scope !== 'sector' || event.symbol !== 'MARKET')
    : sorted);
  const rawResearchScore = Math.round(strengthByEvent.reduce((sum, entry) => sum + entry.value, 0));
  const confirmationBonus = sourceTypes.length > 1 ? Math.min(9, (sourceTypes.length - 1) * 3) : 0;
  const linkedAction = getPreferredAction(relatedSymbols, context);
  const actionBonus = linkedAction ? 10 : 0;
  const freshnessBonus = getFreshnessBonus(context.now - sorted[0].eventTimestamp);
  const storyScore = Math.max(0, Math.round(Math.abs(rawResearchScore) + confirmationBonus + actionBonus + freshnessBonus));
  const sentiment = rawResearchScore > 0 ? 'bullish' : rawResearchScore < 0 ? 'bearish' : 'neutral';
  const topSymbol = relatedSymbols[0] ?? null;
  const sector = topSymbol ? getCompanySector(topSymbol, context.companyBySymbol) : null;
  const relatedArticles = [...new Map(
    sorted
      .filter(event => event.sourceType === 'news')
      .map(event => [event.sourceId, context.articleById.get(event.sourceId)])
      .filter((entry): entry is [string, NewsArticleLink] => Boolean(entry[1]))
  ).values()];

  if (context.actionableOnly && !linkedAction) return null;
  if (context.freshOnly && sorted[0].eventTimestamp < context.now - 24 * 60 * 60 * 1000) return null;

  return {
    id: clusterId,
    scope,
    entity,
    title: strongest?.event.title ?? sorted[0].title,
    summary: strongest?.event.summary ?? sorted[0].summary ?? null,
    sentiment,
    storyScore,
    researchScore: rawResearchScore === 0 ? aggregate.score : rawResearchScore,
    confirmationBonus,
    actionBonus,
    freshnessBonus,
    eventCount: sorted.length,
    sourceTypes,
    symbols: relatedSymbols,
    topSymbol,
    sector,
    actionable: Boolean(linkedAction),
    linkedAction,
    latestEventAt: sorted[0].eventTimestamp,
    sourceEventIds,
    relatedArticles,
    events: sorted.map(event => mapStoryEvent(event, context)),
  };
}

function mapStoryEvent(event: ResearchEvent, context: FeedContext): ResearchStoryEvent {
  const symbol = event.symbol.toUpperCase();
  const linkedArticle = event.sourceType === 'news' ? context.articleById.get(event.sourceId) ?? null : null;
  return {
    id: event.id,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    symbol,
    companyName: symbol === 'MARKET' ? 'Market' : getCompanyNameFromMap(symbol, context.companyBySymbol),
    sector: symbol === 'MARKET' ? null : getCompanySector(symbol, context.companyBySymbol),
    title: event.title,
    summary: event.summary ?? null,
    sentiment: event.sentiment,
    eventType: event.eventType ?? null,
    importance: event.importance,
    url: event.url ?? null,
    eventTimestamp: event.eventTimestamp,
    createdAt: event.createdAt,
    ageHours: Math.max(0, Math.round((context.now - event.eventTimestamp) / (60 * 60 * 1000))),
    inPortfolio: context.portfolioSymbols.has(symbol),
    action: symbol === 'MARKET' ? null : getPreferredAction([symbol], context),
    linkedArticle,
  };
}

function buildEntityRow(
  kind: 'market' | 'sector' | 'stock',
  entity: string,
  stories: ResearchStory[],
  events: ResearchEvent[],
  context: FeedContext,
): ResearchEntityRow | null {
  const visibleStories = filterStories(stories, context);
  if (visibleStories.length === 0) return null;
  const latestEventAt = Math.max(...events.map(event => event.eventTimestamp));
  const aggregate = scoreResearchEvents(events.filter(event => event.symbol !== 'MARKET').length > 0
    ? events.filter(event => event.symbol !== 'MARKET')
    : events);
  const linkedAction = kind === 'stock'
    ? getPreferredAction([entity], context)
    : visibleStories.find(story => story.linkedAction)?.linkedAction ?? null;
  const sentiment = aggregate.score > 0 ? 'bullish' : aggregate.score < 0 ? 'bearish' : 'neutral';
  const score = Math.round(visibleStories.slice(0, 3).reduce((sum, story, index) => sum + story.storyScore / (index + 1), 0));

  return {
    kind,
    entity,
    label: kind === 'market'
      ? 'Market'
      : kind === 'sector'
        ? entity
        : getCompanyNameFromMap(entity, context.companyBySymbol),
    sector: kind === 'stock' ? getCompanySector(entity, context.companyBySymbol) : null,
    score,
    eventCount: events.length,
    storyCount: visibleStories.length,
    lastActivityAt: latestEventAt,
    sentiment,
    actionable: Boolean(linkedAction),
    linkedAction,
    inPortfolio: kind === 'stock' ? context.portfolioSymbols.has(entity) : kind === 'sector'
      ? visibleStories.some(story => story.symbols.some(symbol => context.portfolioSymbols.has(symbol)))
      : false,
    freshness: latestEventAt >= context.now - 24 * 60 * 60 * 1000 ? 'fresh' : 'stale',
    topStoryTitle: visibleStories[0]?.title ?? null,
  };
}

function buildSelectedEntity(input: {
  scope: ResearchFeedScope;
  entity: string;
  entityRows: ResearchFeedResponse['entities'];
  stockStoriesBySymbol: Map<string, ResearchStory[]>;
  sectorStoriesByName: Map<string, ResearchStory[]>;
  sectorEventsBySector: Map<string, ResearchEvent[]>;
  stockEntities: ResearchEntityRow[];
  marketStories: ResearchStory[];
  macro: ReturnType<typeof getLatestMacroRegime>;
  rotationSummary: string;
  context: FeedContext;
}): ResearchSelectedEntity {
  const row = input.scope === 'market'
    ? input.entityRows.market[0]
    : input.scope === 'sector'
      ? input.entityRows.sectors.find(entry => entry.entity === input.entity) ?? null
      : input.entityRows.stocks.find(entry => entry.entity === input.entity) ?? null;

  const stories = input.scope === 'market'
    ? input.marketStories
    : input.scope === 'sector'
      ? input.sectorStoriesByName.get(input.entity) ?? []
      : input.stockStoriesBySymbol.get(input.entity) ?? [];

  const filteredStories = filterStories(stories, input.context);
  const latestCandidate = input.scope === 'stock' ? input.context.candidateBySymbol.get(input.entity) ?? null : null;
  const latestDecision = input.scope === 'stock' ? input.context.decisionBySymbol.get(input.entity) ?? null : null;
  const topSymbols = input.scope === 'sector'
    ? input.stockEntities
        .filter(entry => entry.sector === input.entity)
        .slice(0, 5)
        .map(entry => ({
          symbol: entry.entity,
          label: entry.label,
          score: entry.score,
          linkedAction: entry.linkedAction,
          inPortfolio: entry.inPortfolio,
        }))
    : input.scope === 'market'
      ? input.stockEntities.slice(0, 5).map(entry => ({
          symbol: entry.entity,
          label: entry.label,
          score: entry.score,
          linkedAction: entry.linkedAction,
          inPortfolio: entry.inPortfolio,
        }))
      : [{
          symbol: input.entity,
          label: getCompanyNameFromMap(input.entity, input.context.companyBySymbol),
          score: row?.score ?? 0,
          linkedAction: row?.linkedAction ?? null,
          inPortfolio: input.context.portfolioSymbols.has(input.entity),
        }];

  return {
    scope: input.scope,
    entity: input.entity,
    label: row?.label ?? (input.scope === 'market' ? 'Market' : input.entity),
    sector: input.scope === 'stock' ? getCompanySector(input.entity, input.context.companyBySymbol) : null,
    score: row?.score ?? 0,
    eventCount: row?.eventCount ?? 0,
    storyCount: row?.storyCount ?? 0,
    lastActivityAt: row?.lastActivityAt ?? null,
    sentiment: row?.sentiment ?? 'neutral',
    actionableCount: filteredStories.filter(story => story.actionable).length,
    inPortfolio: row?.inPortfolio ?? false,
    linkedAction: row?.linkedAction ?? null,
    latestCandidate,
    latestDecision,
    topSymbols,
    rotationSummary: input.scope === 'market' || input.scope === 'sector' ? input.rotationSummary : null,
    macro: input.scope === 'market'
      ? {
          regime: input.macro.regime,
          reasoning: input.macro.reasoning,
          computedAt: input.macro.computedAt,
        }
      : null,
  };
}

function filterEntityRows(rows: ResearchEntityRow[], context: FeedContext): ResearchEntityRow[] {
  return rows.filter(row => {
    if (context.actionableOnly && !row.actionable) return false;
    if (context.freshOnly && row.freshness !== 'fresh') return false;
    return true;
  });
}

function filterStories(stories: ResearchStory[], context: FeedContext): ResearchStory[] {
  return stories.filter(story => {
    if (context.actionableOnly && !story.actionable) return false;
    if (context.freshOnly && story.latestEventAt < context.now - 24 * 60 * 60 * 1000) return false;
    return true;
  });
}

function sortEntities(rows: ResearchEntityRow[]): ResearchEntityRow[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  });
}

function normalizeSelection(input: {
  requestedScope: ResearchFeedScope;
  requestedEntity: string | null;
  entities: ResearchFeedResponse['entities'];
}): { scope: ResearchFeedScope; entity: string } {
  if (input.requestedScope === 'sector' && input.entities.sectors.length > 0) {
    const entity = input.entities.sectors.find(row => row.entity === input.requestedEntity)?.entity
      ?? input.entities.sectors[0].entity;
    return { scope: 'sector', entity };
  }

  if (input.requestedScope === 'stock' && input.entities.stocks.length > 0) {
    const entity = input.entities.stocks.find(row => row.entity === input.requestedEntity)?.entity
      ?? input.entities.stocks[0].entity;
    return { scope: 'stock', entity };
  }

  if (input.entities.market.length > 0) {
    return { scope: 'market', entity: 'MARKET' };
  }

  if (input.entities.sectors.length > 0) {
    return { scope: 'sector', entity: input.entities.sectors[0].entity };
  }

  if (input.entities.stocks.length > 0) {
    return { scope: 'stock', entity: input.entities.stocks[0].entity };
  }

  return { scope: 'market', entity: 'MARKET' };
}

function getPreferredAction(symbols: string[], context: FeedContext): string | null {
  for (const symbol of symbols) {
    const decision = context.decisionBySymbol.get(symbol);
    if (decision?.action && decision.action !== 'HOLD') return String(decision.action);
  }
  for (const symbol of symbols) {
    const candidate = context.candidateBySymbol.get(symbol);
    if (candidate?.actionable) return candidate.decisionAction ?? candidate.action;
  }
  return null;
}

function getWeightedEventStrength(event: ResearchEvent, scope: ResearchFeedScope): number {
  const base = scoreResearchEvents([event]).score;
  if (scope === 'sector' && event.symbol === 'MARKET') return Math.round(base * 0.35);
  return base;
}

function normalizeClusterTopic(event: ResearchEvent): string {
  return String(event.eventType ?? event.sourceType).toLowerCase();
}

function getFreshnessBonus(ageMs: number): number {
  if (ageMs <= 24 * 60 * 60 * 1000) return 6;
  if (ageMs <= 72 * 60 * 60 * 1000) return 2;
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return -4;
  return -12;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

function rowToResearchEvent(row: any): ResearchEvent {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    symbol: String(row.symbol).toUpperCase(),
    title: row.title,
    summary: row.summary ?? null,
    sentiment: row.sentiment,
    eventType: row.event_type ?? null,
    importance: Number(row.importance ?? 0),
    url: row.url ?? null,
    payload: parseJson(row.payload, {}),
    eventTimestamp: Number(row.event_timestamp ?? 0) * 1000,
    createdAt: Number(row.created_at ?? 0) * 1000,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getCompanyNameFromMap(symbol: string, companyBySymbol: Map<string, CompanyMeta>): string {
  return companyBySymbol.get(symbol)?.name ?? getCompanyName(symbol) ?? symbol;
}

function getCompanySector(symbol: string, companyBySymbol: Map<string, CompanyMeta>): string {
  return companyBySymbol.get(symbol)?.sector ?? getSector(symbol) ?? 'Other';
}

function normalizeScope(value?: string): ResearchFeedScope {
  return value === 'sector' || value === 'stock' ? value : 'market';
}

function normalizeSentiment(value?: string): ResearchFeedSentimentFilter {
  return value === 'bullish' || value === 'bearish' || value === 'neutral' ? value : 'all';
}

function normalizeSourceType(value?: string): ResearchFeedSourceFilter {
  return value === 'news'
    || value === 'filing'
    || value === 'insider'
    || value === 'hedge_fund'
    || value === 'options_flow'
    || value === 'short_interest'
    ? value
    : 'all';
}

function normalizeHoursBack(value?: number): number {
  if (value === 24 || value === 72 || value === 168) return value;
  return 72;
}

function normalizeLimit(value?: number): number {
  const limit = Number(value ?? 24);
  if (!Number.isFinite(limit)) return 24;
  return Math.max(10, Math.min(Math.round(limit), 60));
}

function normalizeEntity(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed === 'MARKET' ? 'MARKET' : trimmed.toUpperCase() === trimmed ? trimmed.toUpperCase() : trimmed;
}
