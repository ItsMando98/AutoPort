import { randomUUID } from 'crypto';
import db from './db.js';
import {
  getLatestSymbolTheses,
  hasOpenMarketForecast,
  saveAgentObservations,
  saveMarketForecasts,
  saveSymbolTheses,
  type LatestThesisRecord,
} from './autonomy.js';
import { fetchCurrentPrices, getCachedPrices } from './marketdata.js';
import { getLatestMacroRegime } from './macro.js';
import { getRecentResearchEvents, type ResearchEvent } from './research.js';
import { ALL_SYMBOLS, COMPANY_INFO, getCompanyName, getSector } from './universe.js';

export type ThemeStatus = 'active' | 'staged' | 'archived' | 'deprecated';
export type ThemeDiscoveryStatus = 'staged' | 'validated' | 'published' | 'rejected' | 'archived';
export type ThemeAssetClass = 'equity' | 'etf' | 'crypto_proxy';

export interface ThemeDefinition {
  id: string;
  name: string;
  slug: string;
  status: ThemeStatus;
  description: string | null;
  thesis: string | null;
  horizon: string;
  assetScope: string;
  benchmarkSymbol: string | null;
  benchmarkName: string | null;
  benchmarkNote: string | null;
  confidence: number;
  predictiveScore: number;
  catalystScore: number;
  confirmationScore: number;
  benchmarkRelativeScore: number;
  sourceCount: number;
  discoveryCount: number;
  lastRefreshAt: number | null;
  archivedAt: number | null;
  metadata: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeDiscovery {
  id: string;
  themeId: string | null;
  themeName: string;
  discoveryKey: string;
  status: ThemeDiscoveryStatus;
  sourceType: string;
  evidenceType: string;
  title: string;
  summary: string | null;
  horizon: string;
  confidence: number;
  predictiveScore: number;
  sourceCount: number;
  catalystCount: number;
  validatedAssetCount: number;
  unresolvedAssetCount: number;
  benchmarkSymbol: string | null;
  benchmarkName: string | null;
  evidence: Record<string, any>;
  metadata: Record<string, any>;
  discoveredAt: number;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeBenchmark {
  symbol: string;
  name: string;
  benchmarkType: string;
  rationale: string | null;
  metadata: Record<string, any>;
}

export interface ThemeSleeveMember {
  symbol: string;
  name: string;
  assetClass: ThemeAssetClass;
  market: string;
  sector: string | null;
  weight: number;
  conviction: number;
  benchmarkWeight: number;
  activeWeight: number;
  entryPrice: number | null;
  currentPrice: number | null;
  expectedReturn: number | null;
  evidenceScore: number;
  rationale: string;
  sourceRefs: string[];
  metadata: Record<string, any>;
}

export interface ThemeSleeve {
  id: string;
  themeId: string;
  version: number;
  status: ThemeStatus;
  horizon: string;
  benchmarkSymbol: string;
  benchmarkName: string;
  benchmarkNote: string | null;
  confidence: number;
  predictiveScore: number;
  expectedAlpha: number | null;
  expectedVolatility: number | null;
  rebalanceReason: string | null;
  builtFromDiscoveryIds: string[];
  metadata: Record<string, any>;
  builtAt: number;
  createdAt: number;
  updatedAt: number;
  members: ThemeSleeveMember[];
}

export interface ThemeSnapshot {
  id: string;
  themeId: string;
  sleeveId: string | null;
  sleeveVersion: number | null;
  totalReturn: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  hitRate: number | null;
  actionableCount: number;
  memberCount: number;
  snapshotValue: number | null;
  benchmarkValue: number | null;
  attributionSummary: Record<string, any>;
  metadata: Record<string, any>;
  snapshotAt: number;
  createdAt: number;
}

export interface ThemeAttribution {
  id: string;
  themeId: string;
  sleeveId: string | null;
  sleeveVersion: number | null;
  symbol: string;
  contributionReturn: number | null;
  excessContribution: number | null;
  weight: number | null;
  benchmarkWeight: number | null;
  rationale: string | null;
  metadata: Record<string, any>;
  measuredAt: number;
  createdAt: number;
}

export interface ThemeResearchBrief {
  themeId: string;
  sleeveId: string | null;
  summary: string;
  catalysts: string[];
  risks: string[];
  benchmarkThesis: string | null;
  horizon: string;
  confidence: number;
  evidence: Record<string, any>;
  updatedAt: number;
  createdAt: number;
}

export interface ThemeLabOverview {
  updatedAt: number;
  lastRefreshAt: number | null;
  activeThemeCount: number;
  stagedThemeCount: number;
  archivedThemeCount: number;
  discoveryCount: number;
  averageExcessReturn: number | null;
  maxActiveThemes: number;
  topThemeId: string | null;
  topThemeName: string | null;
}

export interface ThemeListItem extends ThemeDefinition {
  sleeve: ThemeSleeve | null;
  latestSnapshot: ThemeSnapshot | null;
  benchmark: ThemeBenchmark | null;
  brief: ThemeResearchBrief | null;
}

export interface ThemeListResponse {
  overview: ThemeLabOverview;
  themes: ThemeListItem[];
  discoveries: ThemeDiscovery[];
}

export interface ThemeDetailResponse {
  theme: ThemeDefinition | null;
  sleeve: ThemeSleeve | null;
  benchmark: ThemeBenchmark | null;
  brief: ThemeResearchBrief | null;
  latestSnapshot: ThemeSnapshot | null;
  history: ThemeSnapshot[];
  attribution: ThemeAttribution[];
  discoveries: ThemeDiscovery[];
}

interface ThemeBlueprint {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  sectors: string[];
  symbols: string[];
  benchmark: { symbol: string; name: string; note: string };
  risks: string[];
}

interface InstrumentRecord {
  symbol: string;
  name: string;
  assetClass: ThemeAssetClass;
  market: string;
  sector: string | null;
}

interface AssetCandidate {
  symbol: string;
  name: string;
  assetClass: ThemeAssetClass;
  market: string;
  sector: string | null;
  score: number;
  confidence: number;
  bullishEvidence: number;
  bearishEvidence: number;
  sourceRefs: string[];
  rationale: string;
  expectedReturn: number | null;
}

const DISCOVERY_LOOKBACK_HOURS = 30 * 24;
const MAX_ACTIVE_THEMES = 10;
const MEMBER_COUNT = 6;
const MAX_MEMBER_WEIGHT = 0.28;
const MIN_MEMBER_WEIGHT = 0.08;
const THEME_HORIZON = '3-12 months';
const THEME_SOURCE_KEY = 'theme_research_lab';
const THEME_DISCOVERY_SOURCE_KEY = 'theme_discovery_lab';

const EXTRA_INSTRUMENTS: Record<string, InstrumentRecord> = {
  SPY: { symbol: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'etf', market: 'US', sector: 'Market' },
  QQQ: { symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'etf', market: 'US', sector: 'Technology' },
  XLK: { symbol: 'XLK', name: 'Technology Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Technology' },
  XLV: { symbol: 'XLV', name: 'Health Care Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Healthcare' },
  XLI: { symbol: 'XLI', name: 'Industrial Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Industrials' },
  XLE: { symbol: 'XLE', name: 'Energy Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Energy' },
  XLF: { symbol: 'XLF', name: 'Financial Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Financials' },
  XLY: { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR', assetClass: 'etf', market: 'US', sector: 'Consumer Discretionary' },
  SMH: { symbol: 'SMH', name: 'VanEck Semiconductor ETF', assetClass: 'etf', market: 'US', sector: 'Technology' },
  IGV: { symbol: 'IGV', name: 'iShares Expanded Tech-Software ETF', assetClass: 'etf', market: 'US', sector: 'Technology' },
  ITA: { symbol: 'ITA', name: 'iShares U.S. Aerospace & Defense ETF', assetClass: 'etf', market: 'US', sector: 'Industrials' },
  HACK: { symbol: 'HACK', name: 'ETFMG Prime Cyber Security ETF', assetClass: 'etf', market: 'US', sector: 'Technology' },
  BOTZ: { symbol: 'BOTZ', name: 'Global X Robotics & Artificial Intelligence ETF', assetClass: 'etf', market: 'US', sector: 'Technology' },
  IBIT: { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', assetClass: 'crypto_proxy', market: 'US', sector: 'Digital Assets' },
  ETHA: { symbol: 'ETHA', name: 'iShares Ethereum Trust ETF', assetClass: 'crypto_proxy', market: 'US', sector: 'Digital Assets' },
  MSTR: { symbol: 'MSTR', name: 'Strategy Incorporated', assetClass: 'crypto_proxy', market: 'US', sector: 'Technology' },
};

const THEME_BLUEPRINTS: ThemeBlueprint[] = [
  {
    id: 'ai-infrastructure',
    name: 'AI Infrastructure',
    description: 'Compute, networking, and hyperscaler beneficiaries of the AI capex cycle.',
    keywords: ['ai', 'artificial intelligence', 'gpu', 'data center', 'inference', 'cloud', 'semiconductor'],
    sectors: ['Technology', 'Communication Services'],
    symbols: ['NVDA', 'AMD', 'MSFT', 'GOOGL', 'META', 'AMZN', 'AVGO', 'MRVL', 'SMCI', 'ARM'],
    benchmark: { symbol: 'QQQ', name: 'Invesco QQQ Trust', note: 'Broad large-cap tech benchmark for AI-led capex' },
    risks: ['AI capex digestion', 'export controls', 'valuation compression'],
  },
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Security software and platform winners exposed to enterprise protection budgets.',
    keywords: ['cyber', 'security', 'breach', 'endpoint', 'identity', 'cloud security'],
    sectors: ['Technology'],
    symbols: ['CRWD', 'PANW', 'ZS', 'MSFT', 'GOOGL'],
    benchmark: { symbol: 'HACK', name: 'ETFMG Prime Cyber Security ETF', note: 'Cyber ETF benchmark for security software' },
    risks: ['elongating enterprise sales cycles', 'platform consolidation'],
  },
  {
    id: 'defense-autonomy',
    name: 'Defense and Autonomy',
    description: 'Defense primes and autonomy platforms exposed to procurement, missiles, and ISR demand.',
    keywords: ['defense', 'missile', 'procurement', 'autonomy', 'surveillance', 'aerospace', 'military'],
    sectors: ['Industrials', 'Technology'],
    symbols: ['LMT', 'GE', 'HON', 'BA', 'PLTR', 'CAT'],
    benchmark: { symbol: 'ITA', name: 'iShares U.S. Aerospace & Defense ETF', note: 'Sector benchmark for defense programs' },
    risks: ['budget delays', 'program execution risk'],
  },
  {
    id: 'medical-innovation',
    name: 'Medical Innovation',
    description: 'Pharma, biotech, devices, and diagnostics with forward catalysts in therapeutics and tools.',
    keywords: ['drug', 'trial', 'approval', 'obesity', 'device', 'surgery', 'therapy', 'medical'],
    sectors: ['Healthcare'],
    symbols: ['LLY', 'ISRG', 'REGN', 'TMO', 'GILD', 'ABBV', 'MRK', 'AMGN'],
    benchmark: { symbol: 'XLV', name: 'Health Care Select Sector SPDR', note: 'Healthcare benchmark for therapies and devices' },
    risks: ['trial failures', 'pricing pressure', 'regulatory setbacks'],
  },
  {
    id: 'semiconductors',
    name: 'Semiconductors',
    description: 'Chip designers and equipment-linked beneficiaries of compute and edge demand.',
    keywords: ['chip', 'semiconductor', 'foundry', 'memory', 'processor', 'accelerator'],
    sectors: ['Technology'],
    symbols: ['NVDA', 'AMD', 'AVGO', 'ARM', 'QCOM', 'TXN', 'MU', 'MRVL', 'INTC'],
    benchmark: { symbol: 'SMH', name: 'VanEck Semiconductor ETF', note: 'Pure-play semiconductor benchmark' },
    risks: ['inventory corrections', 'fab concentration', 'cyclical demand swings'],
  },
  {
    id: 'cloud-software',
    name: 'Cloud and Software',
    description: 'Enterprise software and application infrastructure with recurring revenue and AI attach.',
    keywords: ['software', 'saas', 'cloud', 'subscription', 'workflow', 'developer'],
    sectors: ['Technology'],
    symbols: ['MSFT', 'ORCL', 'CRM', 'NOW', 'SNOW', 'ADBE', 'AMZN', 'GOOGL'],
    benchmark: { symbol: 'IGV', name: 'iShares Expanded Tech-Software ETF', note: 'Software benchmark for cloud applications' },
    risks: ['seat optimization', 'slower enterprise spending'],
  },
  {
    id: 'energy-security',
    name: 'Energy Security',
    description: 'Integrated oil and services names with capital discipline and geopolitical relevance.',
    keywords: ['oil', 'lng', 'energy', 'refining', 'supply', 'commodity', 'security'],
    sectors: ['Energy'],
    symbols: ['XOM', 'CVX', 'COP', 'SLB', 'OXY'],
    benchmark: { symbol: 'XLE', name: 'Energy Select Sector SPDR', note: 'Energy sector benchmark' },
    risks: ['commodity price reversal', 'OPEC supply normalization'],
  },
  {
    id: 'fintech-infrastructure',
    name: 'Fintech Infrastructure',
    description: 'Payments, transaction rails, and crypto-adjacent financial infrastructure.',
    keywords: ['payments', 'fintech', 'transaction', 'merchant', 'exchange', 'wallet'],
    sectors: ['Financials', 'Technology'],
    symbols: ['V', 'MA', 'SQ', 'PYPL', 'COIN', 'SCHW'],
    benchmark: { symbol: 'XLF', name: 'Financial Select Sector SPDR', note: 'Financial benchmark with transaction exposure' },
    risks: ['consumer slowdown', 'take-rate compression', 'regulatory pressure'],
  },
  {
    id: 'consumer-platforms',
    name: 'Consumer Platforms',
    description: 'Internet and commerce platforms with advertising, subscriptions, and logistics leverage.',
    keywords: ['ads', 'commerce', 'streaming', 'consumer', 'platform', 'marketplace', 'ride'],
    sectors: ['Consumer Discretionary', 'Communication Services', 'Technology'],
    symbols: ['AMZN', 'META', 'NFLX', 'SHOP', 'UBER'],
    benchmark: { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR', note: 'Consumer growth benchmark' },
    risks: ['consumer demand volatility', 'ad market softness'],
  },
  {
    id: 'digital-assets',
    name: 'Digital Assets Proxies',
    description: 'Crypto-adjacent equities and ETFs that capture institutional digital asset adoption.',
    keywords: ['bitcoin', 'ethereum', 'crypto', 'digital asset', 'token', 'blockchain'],
    sectors: ['Technology', 'Financials', 'Digital Assets'],
    symbols: ['COIN', 'IBIT', 'MSTR', 'SQ', 'PYPL'],
    benchmark: { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', note: 'Custom crypto-proxy benchmark' },
    risks: ['volatility shocks', 'regulatory changes', 'ETF flow reversals'],
  },
];

const COMPANY_ROW = db.prepare(`
  SELECT symbol, name, sector
  FROM companies
  WHERE symbol = ?
`);

const LAST_PRICE_ROW = db.prepare(`
  SELECT close
  FROM price_history
  WHERE symbol = ?
  ORDER BY date DESC
  LIMIT 1
`);

export async function refreshThemeLab(options: {
  now?: number;
  maxActiveThemes?: number;
  useLivePrices?: boolean;
} = {}): Promise<ThemeListResponse> {
  const now = options.now ?? Date.now();
  const discoveries = runThemeDiscovery({ now });
  const validated = runAssetDiscovery({ now });
  const briefs = runThemeResearch({ now, discoveries: validated });
  buildThemeSleeves({ now, discoveries: validated, briefs, maxActiveThemes: options.maxActiveThemes ?? MAX_ACTIVE_THEMES });
  await runThemeEvaluation({ now, useLivePrices: options.useLivePrices ?? false });
  return getThemes();
}

export async function rebuildTheme(themeId: string, options: {
  now?: number;
  useLivePrices?: boolean;
} = {}): Promise<ThemeDetailResponse> {
  const now = options.now ?? Date.now();
  const discoveries = runThemeDiscovery({ now, themeId });
  const validated = runAssetDiscovery({ now, themeId, discoveries });
  const briefs = runThemeResearch({ now, themeId, discoveries: validated });
  buildThemeSleeves({ now, themeId, discoveries: validated, briefs, maxActiveThemes: MAX_ACTIVE_THEMES });
  await runThemeEvaluation({ now, themeId, useLivePrices: options.useLivePrices ?? false });
  return getThemeDetail(themeId);
}

export function runThemeDiscovery(options: {
  now?: number;
  themeId?: string;
} = {}): ThemeDiscovery[] {
  const now = options.now ?? Date.now();
  const context = loadThemeContext(now);
  const blueprints = options.themeId
    ? THEME_BLUEPRINTS.filter(item => item.id === options.themeId)
    : THEME_BLUEPRINTS;
  const discoveries: ThemeDiscovery[] = [];

  const tx = db.transaction(() => {
    for (const blueprint of blueprints) {
      const discovery = generateDiscovery(blueprint, context, now);
      const definitionStatus = discovery.predictiveScore >= 16 ? 'validated' : discovery.predictiveScore >= 9 ? 'staged' : 'rejected';
      upsertThemeDefinition({
        id: blueprint.id,
        name: blueprint.name,
        slug: blueprint.id,
        status: definitionStatus === 'validated' ? 'staged' : 'deprecated',
        description: blueprint.description,
        thesis: discovery.summary,
        horizon: THEME_HORIZON,
        assetScope: 'cross_asset',
        benchmarkSymbol: blueprint.benchmark.symbol,
        benchmarkName: blueprint.benchmark.name,
        benchmarkNote: blueprint.benchmark.note,
        confidence: discovery.confidence,
        predictiveScore: discovery.predictiveScore,
        catalystScore: 0,
        confirmationScore: 0,
        benchmarkRelativeScore: 0,
        sourceCount: discovery.sourceCount,
        discoveryCount: 1,
        lastRefreshAt: now,
        archivedAt: null,
        metadata: {
          sectors: blueprint.sectors,
          keywords: blueprint.keywords,
        },
      });
      const metadata = {
        symbols: blueprint.symbols,
        keywords: blueprint.keywords,
        sectors: blueprint.sectors,
      };
      db.prepare(`
        INSERT INTO theme_discoveries (
          id, theme_id, theme_name, discovery_key, status, source_type, evidence_type, title, summary, horizon,
          confidence, predictive_score, source_count, catalyst_count, validated_asset_count, unresolved_asset_count,
          benchmark_symbol, benchmark_name, evidence, metadata, discovered_at, published_at, updated_at
        ) VALUES (
          @id, @theme_id, @theme_name, @discovery_key, @status, @source_type, @evidence_type, @title, @summary, @horizon,
          @confidence, @predictive_score, @source_count, @catalyst_count, @validated_asset_count, @unresolved_asset_count,
          @benchmark_symbol, @benchmark_name, @evidence, @metadata, @discovered_at, @published_at, unixepoch()
        )
        ON CONFLICT(discovery_key) DO UPDATE SET
          theme_id = excluded.theme_id,
          theme_name = excluded.theme_name,
          status = excluded.status,
          title = excluded.title,
          summary = excluded.summary,
          confidence = excluded.confidence,
          predictive_score = excluded.predictive_score,
          source_count = excluded.source_count,
          catalyst_count = excluded.catalyst_count,
          validated_asset_count = excluded.validated_asset_count,
          unresolved_asset_count = excluded.unresolved_asset_count,
          benchmark_symbol = excluded.benchmark_symbol,
          benchmark_name = excluded.benchmark_name,
          evidence = excluded.evidence,
          metadata = excluded.metadata,
          discovered_at = excluded.discovered_at,
          published_at = excluded.published_at,
          updated_at = unixepoch()
      `).run({
        id: discovery.id,
        theme_id: blueprint.id,
        theme_name: blueprint.name,
        discovery_key: `${blueprint.id}:${new Date(now).toISOString().slice(0, 10)}`,
        status: definitionStatus,
        source_type: 'internal_research',
        evidence_type: 'cross_source_cluster',
        title: discovery.title,
        summary: discovery.summary,
        horizon: THEME_HORIZON,
        confidence: discovery.confidence,
        predictive_score: discovery.predictiveScore,
        source_count: discovery.sourceCount,
        catalyst_count: discovery.catalystCount,
        validated_asset_count: 0,
        unresolved_asset_count: blueprint.symbols.length,
        benchmark_symbol: blueprint.benchmark.symbol,
        benchmark_name: blueprint.benchmark.name,
        evidence: JSON.stringify(discovery.evidence),
        metadata: JSON.stringify(metadata),
        discovered_at: toUnix(now),
        published_at: null,
      });
      discoveries.push(getDiscoveryByKey(`${blueprint.id}:${new Date(now).toISOString().slice(0, 10)}`)!);
    }
  });
  tx();

  saveAgentObservations(discoveries.map(discovery => ({
    agentName: 'theme_discovery',
    sourceKey: THEME_DISCOVERY_SOURCE_KEY,
    symbol: 'MARKET',
    topic: `theme:${discovery.themeId ?? discovery.themeName}`,
    observationType: 'theme_discovery',
    confidence: discovery.confidence,
    details: {
      themeId: discovery.themeId,
      themeName: discovery.themeName,
      predictiveScore: discovery.predictiveScore,
      sourceCount: discovery.sourceCount,
      evidence: discovery.evidence,
    },
    observedAt: discovery.discoveredAt,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
  })));

  return options.themeId
    ? discoveries.filter(item => item.themeId === options.themeId)
    : discoveries;
}

export function runAssetDiscovery(options: {
  now?: number;
  themeId?: string;
  discoveries?: ThemeDiscovery[];
} = {}): ThemeDiscovery[] {
  const now = options.now ?? Date.now();
  const context = loadThemeContext(now);
  const discoveries = options.discoveries ?? getThemeDiscoveries();
  const filtered = options.themeId ? discoveries.filter(item => item.themeId === options.themeId) : discoveries;

  const tx = db.transaction(() => {
    for (const discovery of filtered) {
      const blueprint = requireBlueprint(discovery.themeId ?? discovery.themeName);
      const assets = rankThemeAssets(blueprint, context).slice(0, MEMBER_COUNT + 2);
      const validated = assets.filter(asset => asset.score >= 8);
      const unresolved = blueprint.symbols.filter(symbol => !validated.some(asset => asset.symbol === symbol));
      db.prepare(`
        UPDATE theme_discoveries
        SET status = @status,
            validated_asset_count = @validated_asset_count,
            unresolved_asset_count = @unresolved_asset_count,
            evidence = @evidence,
            metadata = @metadata,
            updated_at = unixepoch()
        WHERE id = @id
      `).run({
        id: discovery.id,
        status: validated.length >= 3 ? 'validated' : discovery.predictiveScore >= 9 ? 'staged' : 'rejected',
        validated_asset_count: validated.length,
        unresolved_asset_count: unresolved.length,
        evidence: JSON.stringify({
          ...(discovery.evidence ?? {}),
          topAssets: validated.map(asset => ({
            symbol: asset.symbol,
            score: asset.score,
            confidence: asset.confidence,
          })),
        }),
        metadata: JSON.stringify({
          ...(discovery.metadata ?? {}),
          validatedAssets: validated.map(asset => asset.symbol),
          unresolvedAssets: unresolved,
        }),
      });
    }
  });
  tx();

  const refreshed = options.themeId ? getThemeDiscoveries().filter(item => item.themeId === options.themeId) : getThemeDiscoveries();
  saveAgentObservations(refreshed.flatMap(discovery => {
    const assets = parseArray(discovery.metadata?.validatedAssets);
    return assets.map((symbol: string) => ({
      agentName: 'asset_discovery',
      sourceKey: THEME_DISCOVERY_SOURCE_KEY,
      symbol,
      topic: `theme:${discovery.themeId ?? discovery.themeName}`,
      observationType: 'theme_asset_candidate',
      confidence: discovery.confidence,
      details: {
        themeId: discovery.themeId,
        themeName: discovery.themeName,
        discoveryId: discovery.id,
      },
      observedAt: now,
      expiresAt: now + 14 * 24 * 60 * 60 * 1000,
    }));
  }));
  return refreshed;
}

export function runThemeResearch(options: {
  now?: number;
  themeId?: string;
  discoveries?: ThemeDiscovery[];
} = {}): ThemeResearchBrief[] {
  const now = options.now ?? Date.now();
  const context = loadThemeContext(now);
  const discoveries = options.discoveries ?? getThemeDiscoveries();
  const filtered = options.themeId ? discoveries.filter(item => item.themeId === options.themeId) : discoveries;
  const briefs: ThemeResearchBrief[] = [];

  const tx = db.transaction(() => {
    for (const discovery of filtered) {
      if (discovery.status === 'rejected') continue;
      const blueprint = requireBlueprint(discovery.themeId ?? discovery.themeName);
      const assets = rankThemeAssets(blueprint, context).slice(0, MEMBER_COUNT);
      const catalysts = collectCatalysts(blueprint, context.events);
      const risks = dedupe([
        ...blueprint.risks,
        ...collectRisks(blueprint, context.events),
      ]).slice(0, 5);
      const summary = `${blueprint.name} is being tracked as a ${THEME_HORIZON} predictive sleeve with ${assets.length} validated assets, ${discovery.sourceCount} supporting sources, and benchmark ${blueprint.benchmark.symbol}.`;
      const brief = {
        themeId: blueprint.id,
        sleeveId: null,
        summary,
        catalysts,
        risks,
        benchmarkThesis: `${blueprint.benchmark.symbol} is used as the custom benchmark because it best captures the dominant factor exposure for ${blueprint.name.toLowerCase()}.`,
        horizon: THEME_HORIZON,
        confidence: clamp((discovery.confidence + Math.min(assets.length / MEMBER_COUNT, 1)) / 2, 0, 1),
        evidence: {
          discoveryId: discovery.id,
          assetSymbols: assets.map(asset => asset.symbol),
          topTitles: discovery.evidence?.topTitles ?? [],
        },
        updatedAt: toUnixMs(now),
        createdAt: toUnixMs(now),
      } satisfies ThemeResearchBrief;

      db.prepare(`
        INSERT INTO theme_research_briefs (
          theme_id, sleeve_id, summary, catalysts, risks, benchmark_thesis, horizon, confidence, evidence, updated_at, created_at
        ) VALUES (
          @theme_id, NULL, @summary, @catalysts, @risks, @benchmark_thesis, @horizon, @confidence, @evidence, unixepoch(), unixepoch()
        )
        ON CONFLICT(theme_id) DO UPDATE SET
          sleeve_id = NULL,
          summary = excluded.summary,
          catalysts = excluded.catalysts,
          risks = excluded.risks,
          benchmark_thesis = excluded.benchmark_thesis,
          horizon = excluded.horizon,
          confidence = excluded.confidence,
          evidence = excluded.evidence,
          updated_at = unixepoch()
      `).run({
        theme_id: brief.themeId,
        summary: brief.summary,
        catalysts: JSON.stringify(brief.catalysts),
        risks: JSON.stringify(brief.risks),
        benchmark_thesis: brief.benchmarkThesis,
        horizon: brief.horizon,
        confidence: brief.confidence,
        evidence: JSON.stringify(brief.evidence),
      });

      briefs.push(getThemeResearchBrief(blueprint.id)!);
    }
  });
  tx();

  // Don't re-assert the same 6-month theme call every refresh cycle (or on
  // every process restart) while the previous forecast for this theme hasn't
  // resolved yet.
  saveMarketForecasts(filtered
    .filter(discovery => discovery.status !== 'rejected')
    .filter(discovery => !hasOpenMarketForecast(
      THEME_SOURCE_KEY,
      `theme:${discovery.themeId ?? discovery.themeName}`,
      'benchmark_relative_return_6m',
    ))
    .map(discovery => ({
      agentName: 'theme_research',
      sourceKey: THEME_SOURCE_KEY,
      scope: `theme:${discovery.themeId ?? discovery.themeName}`,
      targetVariable: 'benchmark_relative_return_6m',
      outcomeSymbol: discovery.benchmarkSymbol,
      direction: discovery.predictiveScore >= 18 ? 'up' : discovery.predictiveScore <= 8 ? 'flat' : 'up',
      probability: clamp(discovery.confidence, 0.45, 0.82),
      confidence: clamp(discovery.confidence, 0.45, 0.82),
      reasoning: discovery.summary ?? discovery.title,
      windowStartAt: now,
      windowEndAt: now + 180 * 24 * 60 * 60 * 1000,
      regime: getLatestMacroRegime().regime,
      metadata: {
        themeId: discovery.themeId,
        benchmark: discovery.benchmarkSymbol,
      },
    })));

  return briefs;
}

export function buildThemeSleeves(options: {
  now?: number;
  themeId?: string;
  discoveries?: ThemeDiscovery[];
  briefs?: ThemeResearchBrief[];
  maxActiveThemes?: number;
} = {}): ThemeSleeve[] {
  const now = options.now ?? Date.now();
  const context = loadThemeContext(now);
  const discoveries = (options.discoveries ?? getThemeDiscoveries())
    .filter(item => item.status !== 'rejected')
    .sort((a, b) => b.predictiveScore - a.predictiveScore || b.confidence - a.confidence);
  const activeSet = new Set((options.themeId
    ? discoveries.filter(item => item.themeId === options.themeId)
    : discoveries.slice(0, options.maxActiveThemes ?? MAX_ACTIVE_THEMES))
    .map(item => item.themeId)
    .filter(Boolean) as string[]);
  const sleeves: ThemeSleeve[] = [];

  const tx = db.transaction(() => {
    for (const blueprint of THEME_BLUEPRINTS) {
      if (options.themeId && blueprint.id !== options.themeId) continue;
      const discovery = discoveries.find(item => item.themeId === blueprint.id);
      const status: ThemeStatus = !discovery
        ? 'deprecated'
        : activeSet.has(blueprint.id)
          ? 'active'
          : discovery.status === 'validated'
            ? 'staged'
            : 'deprecated';
      const assets = rankThemeAssets(blueprint, context).slice(0, MEMBER_COUNT);
      const validAssets = assets.filter(asset => asset.score >= 8);
      const definition = upsertThemeDefinition({
        id: blueprint.id,
        name: blueprint.name,
        slug: blueprint.id,
        status,
        description: blueprint.description,
        thesis: discovery?.summary ?? null,
        horizon: THEME_HORIZON,
        assetScope: 'cross_asset',
        benchmarkSymbol: blueprint.benchmark.symbol,
        benchmarkName: blueprint.benchmark.name,
        benchmarkNote: blueprint.benchmark.note,
        confidence: discovery?.confidence ?? 0,
        predictiveScore: discovery?.predictiveScore ?? 0,
        catalystScore: Math.min((discovery?.catalystCount ?? 0) / 4, 1) * 100,
        confirmationScore: Math.min((discovery?.sourceCount ?? 0) / 6, 1) * 100,
        benchmarkRelativeScore: Math.round(((discovery?.predictiveScore ?? 0) + validAssets.length * 2) * 10) / 10,
        sourceCount: discovery?.sourceCount ?? 0,
        discoveryCount: discovery ? 1 : 0,
        lastRefreshAt: now,
        archivedAt: null,
        metadata: {
          sectors: blueprint.sectors,
          keywords: blueprint.keywords,
        },
      });
      upsertThemeBenchmark(blueprint.id, blueprint.benchmark);

      if (status === 'deprecated' || validAssets.length < 3) continue;

      const nextVersion = getNextSleeveVersion(blueprint.id);
      const benchmarkEntryPrice = resolveCurrentPrice(blueprint.benchmark.symbol, getCachedPrices());
      const members = buildSleeveMembers(validAssets, benchmarkEntryPrice);
      const sleeveId = randomUUID();
      db.prepare(`
        INSERT INTO theme_sleeves (
          id, theme_id, version, status, horizon, benchmark_symbol, benchmark_name, benchmark_note, confidence,
          predictive_score, expected_alpha, expected_volatility, rebalance_reason, built_from_discovery_ids, metadata, built_at, updated_at
        ) VALUES (
          @id, @theme_id, @version, @status, @horizon, @benchmark_symbol, @benchmark_name, @benchmark_note, @confidence,
          @predictive_score, @expected_alpha, @expected_volatility, @rebalance_reason, @built_from_discovery_ids, @metadata, @built_at, unixepoch()
        )
      `).run({
        id: sleeveId,
        theme_id: blueprint.id,
        version: nextVersion,
        status,
        horizon: THEME_HORIZON,
        benchmark_symbol: blueprint.benchmark.symbol,
        benchmark_name: blueprint.benchmark.name,
        benchmark_note: blueprint.benchmark.note,
        confidence: discovery?.confidence ?? 0,
        predictive_score: discovery?.predictiveScore ?? 0,
        expected_alpha: round(members.reduce((sum, member) => sum + (member.expectedReturn ?? 0) * member.weight, 0), 4),
        expected_volatility: round(0.12 + (1 - (discovery?.confidence ?? 0.4)) * 0.18, 4),
        rebalance_reason: options.themeId ? 'manual_rebuild' : 'weekly_theme_refresh',
        built_from_discovery_ids: JSON.stringify(discovery ? [discovery.id] : []),
        metadata: JSON.stringify({
          benchmarkEntryPrice,
          memberSymbols: members.map(item => item.symbol),
          generatedFrom: 'dynamic_theme_lab',
        }),
        built_at: toUnix(now),
      });
      const insertMember = db.prepare(`
        INSERT INTO theme_sleeve_members (
          id, sleeve_id, symbol, name, asset_class, market, sector, weight, conviction, benchmark_weight, active_weight,
          entry_price, current_price, expected_return, evidence_score, rationale, source_refs, metadata, updated_at
        ) VALUES (
          @id, @sleeve_id, @symbol, @name, @asset_class, @market, @sector, @weight, @conviction, @benchmark_weight, @active_weight,
          @entry_price, @current_price, @expected_return, @evidence_score, @rationale, @source_refs, @metadata, unixepoch()
        )
      `);
      for (const member of members) {
        insertMember.run({
          id: randomUUID(),
          sleeve_id: sleeveId,
          symbol: member.symbol,
          name: member.name,
          asset_class: member.assetClass,
          market: member.market,
          sector: member.sector,
          weight: member.weight,
          conviction: member.conviction,
          benchmark_weight: member.benchmarkWeight,
          active_weight: member.activeWeight,
          entry_price: member.entryPrice,
          current_price: member.currentPrice,
          expected_return: member.expectedReturn,
          evidence_score: member.evidenceScore,
          rationale: member.rationale,
          source_refs: JSON.stringify(member.sourceRefs),
          metadata: JSON.stringify(member.metadata),
        });
      }

      const brief = getThemeResearchBrief(blueprint.id);
      if (brief) {
        db.prepare(`
          UPDATE theme_research_briefs
          SET sleeve_id = ?, updated_at = unixepoch()
          WHERE theme_id = ?
        `).run(sleeveId, blueprint.id);
      }

      if (discovery) {
        db.prepare(`
          UPDATE theme_discoveries
          SET status = ?, published_at = ?, updated_at = unixepoch()
          WHERE id = ?
        `).run(status === 'active' ? 'published' : 'validated', toUnix(now), discovery.id);
      }

      const observationIds = saveAgentObservations([
        {
          agentName: 'sleeve_construction',
          sourceKey: THEME_SOURCE_KEY,
          symbol: 'MARKET',
          topic: `theme:${blueprint.id}`,
          observationType: 'theme_sleeve_built',
          confidence: discovery?.confidence ?? 0.5,
          details: {
            sleeveId,
            version: nextVersion,
            members: members.map(item => ({ symbol: item.symbol, weight: item.weight })),
          },
          observedAt: now,
          expiresAt: now + 30 * 24 * 60 * 60 * 1000,
        },
      ]);

      saveSymbolTheses(members.map(member => ({
        agentName: 'theme_research',
        sourceKey: THEME_SOURCE_KEY,
        symbol: member.symbol,
        stance: 'BUY' as const,
        confidence: clamp(member.conviction, 0.45, 0.88),
        horizon: THEME_HORIZON,
        catalyst: blueprint.name,
        invalidation: `Theme ${blueprint.name} loses catalyst support or drops below benchmark-relative threshold.`,
        thesis: member.rationale,
        supportingObservationIds: observationIds,
        freshnessScore: clamp(member.evidenceScore / 20, 0.55, 0.92),
        createdAt: now,
        expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      })));

      sleeves.push(getLatestThemeSleeve(blueprint.id)!);
    }

    for (const stale of getThemes().themes.filter(item => !activeSet.has(item.id) && item.status === 'active')) {
      db.prepare(`
        UPDATE theme_definitions
        SET status = 'archived', archived_at = ?, updated_at = unixepoch()
        WHERE id = ?
      `).run(toUnix(now), stale.id);
    }
  });
  tx();

  return options.themeId ? sleeves.filter(item => item.themeId === options.themeId) : sleeves;
}

export async function runThemeEvaluation(options: {
  now?: number;
  themeId?: string;
  useLivePrices?: boolean;
} = {}): Promise<ThemeSnapshot[]> {
  const now = options.now ?? Date.now();
  const sleeves = options.themeId ? [getLatestThemeSleeve(options.themeId)].filter(Boolean) as ThemeSleeve[] : getThemes().themes.map(item => item.sleeve).filter(Boolean) as ThemeSleeve[];
  if (sleeves.length === 0) return [];

  const uniqueSymbols = new Set<string>();
  for (const sleeve of sleeves) {
    uniqueSymbols.add(sleeve.benchmarkSymbol);
    for (const member of sleeve.members) uniqueSymbols.add(member.symbol);
  }
  const livePrices = options.useLivePrices ? await fetchCurrentPrices([...uniqueSymbols]) : getCachedPrices();
  const snapshots: ThemeSnapshot[] = [];

  const tx = db.transaction(() => {
    for (const sleeve of sleeves) {
      const benchmarkEntryPrice = Number(sleeve.metadata?.benchmarkEntryPrice ?? resolveCurrentPrice(sleeve.benchmarkSymbol, livePrices) ?? 0) || null;
      const benchmarkCurrentPrice = resolveCurrentPrice(sleeve.benchmarkSymbol, livePrices) ?? benchmarkEntryPrice;
      const benchmarkReturn = benchmarkEntryPrice && benchmarkCurrentPrice
        ? round((benchmarkCurrentPrice - benchmarkEntryPrice) / benchmarkEntryPrice, 6)
        : null;

      let totalReturn = 0;
      let coveredWeight = 0;
      let winners = 0;
      const attribution: ThemeAttribution[] = [];
      for (const member of sleeve.members) {
        const currentPrice = resolveCurrentPrice(member.symbol, livePrices) ?? member.entryPrice;
        const memberReturn = member.entryPrice && currentPrice
          ? round((currentPrice - member.entryPrice) / member.entryPrice, 6)
          : null;
        if (memberReturn !== null) {
          totalReturn += memberReturn * member.weight;
          coveredWeight += member.weight;
          if (memberReturn > 0) winners += 1;
        }
        db.prepare(`
          UPDATE theme_sleeve_members
          SET current_price = ?, updated_at = unixepoch()
          WHERE sleeve_id = ? AND symbol = ?
        `).run(currentPrice, sleeve.id, member.symbol);
        const attributionRow: ThemeAttribution = {
          id: randomUUID(),
          themeId: sleeve.themeId,
          sleeveId: sleeve.id,
          sleeveVersion: sleeve.version,
          symbol: member.symbol,
          contributionReturn: memberReturn === null ? null : round(memberReturn * member.weight, 6),
          excessContribution: memberReturn === null || benchmarkReturn === null ? null : round((memberReturn - benchmarkReturn) * member.weight, 6),
          weight: member.weight,
          benchmarkWeight: member.benchmarkWeight,
          rationale: member.rationale,
          metadata: {
            currentPrice,
            entryPrice: member.entryPrice,
            memberReturn,
          },
          measuredAt: toUnixMs(now),
          createdAt: toUnixMs(now),
        };
        attribution.push(attributionRow);
        db.prepare(`
          INSERT INTO theme_attribution (
            id, theme_id, sleeve_id, sleeve_version, symbol, contribution_return, excess_contribution,
            weight, benchmark_weight, rationale, metadata, measured_at
          ) VALUES (
            @id, @theme_id, @sleeve_id, @sleeve_version, @symbol, @contribution_return, @excess_contribution,
            @weight, @benchmark_weight, @rationale, @metadata, @measured_at
          )
        `).run({
          id: attributionRow.id,
          theme_id: attributionRow.themeId,
          sleeve_id: attributionRow.sleeveId,
          sleeve_version: attributionRow.sleeveVersion,
          symbol: attributionRow.symbol,
          contribution_return: attributionRow.contributionReturn,
          excess_contribution: attributionRow.excessContribution,
          weight: attributionRow.weight,
          benchmark_weight: attributionRow.benchmarkWeight,
          rationale: attributionRow.rationale,
          metadata: JSON.stringify(attributionRow.metadata),
          measured_at: toUnix(now),
        });
      }

      const normalizedReturn = coveredWeight > 0 ? round(totalReturn / coveredWeight, 6) : null;
      const snapshotId = randomUUID();
      db.prepare(`
        INSERT INTO theme_snapshots (
          id, theme_id, sleeve_id, sleeve_version, total_return, benchmark_return, excess_return, hit_rate,
          actionable_count, member_count, snapshot_value, benchmark_value, attribution_summary, metadata, snapshot_at
        ) VALUES (
          @id, @theme_id, @sleeve_id, @sleeve_version, @total_return, @benchmark_return, @excess_return, @hit_rate,
          @actionable_count, @member_count, @snapshot_value, @benchmark_value, @attribution_summary, @metadata, @snapshot_at
        )
      `).run({
        id: snapshotId,
        theme_id: sleeve.themeId,
        sleeve_id: sleeve.id,
        sleeve_version: sleeve.version,
        total_return: normalizedReturn,
        benchmark_return: benchmarkReturn,
        excess_return: normalizedReturn === null || benchmarkReturn === null ? null : round(normalizedReturn - benchmarkReturn, 6),
        hit_rate: sleeve.members.length > 0 ? round(winners / sleeve.members.length, 4) : null,
        actionable_count: sleeve.members.filter(item => item.conviction >= 0.6).length,
        member_count: sleeve.members.length,
        snapshot_value: normalizedReturn === null ? null : round(100 * (1 + normalizedReturn), 3),
        benchmark_value: benchmarkReturn === null ? null : round(100 * (1 + benchmarkReturn), 3),
        attribution_summary: JSON.stringify({
          topWinner: attribution
            .filter(item => item.contributionReturn !== null)
            .sort((a, b) => (b.contributionReturn ?? 0) - (a.contributionReturn ?? 0))[0]?.symbol ?? null,
          topLag: attribution
            .filter(item => item.contributionReturn !== null)
            .sort((a, b) => (a.contributionReturn ?? 0) - (b.contributionReturn ?? 0))[0]?.symbol ?? null,
        }),
        metadata: JSON.stringify({
          coveredWeight,
          benchmarkSymbol: sleeve.benchmarkSymbol,
        }),
        snapshot_at: toUnix(now),
      });
      snapshots.push(getThemeHistory(sleeve.themeId, 1)[0]!);
    }
  });
  tx();

  return options.themeId ? snapshots.filter(item => item.themeId === options.themeId) : snapshots;
}

export function getThemes(): ThemeListResponse {
  const themes = (db.prepare(`
    SELECT *
    FROM theme_definitions
    ORDER BY CASE status
      WHEN 'active' THEN 0
      WHEN 'staged' THEN 1
      WHEN 'archived' THEN 2
      ELSE 3
    END, predictive_score DESC, updated_at DESC
  `).all() as any[]).map(rowToThemeDefinition);
  const discoveries = getThemeDiscoveries();
  const items = themes.map(theme => ({
    ...theme,
    sleeve: getLatestThemeSleeve(theme.id),
    latestSnapshot: getThemeHistory(theme.id, 1)[0] ?? null,
    benchmark: getThemeBenchmark(theme.id),
    brief: getThemeResearchBrief(theme.id),
  }));
  const activeItems = items.filter(item => item.status === 'active');
  const avgExcess = average(activeItems.map(item => item.latestSnapshot?.excessReturn).filter(isNumber));
  return {
    overview: {
      updatedAt: Date.now(),
      lastRefreshAt: maxNullable(items.map(item => item.lastRefreshAt)),
      activeThemeCount: items.filter(item => item.status === 'active').length,
      stagedThemeCount: items.filter(item => item.status === 'staged').length,
      archivedThemeCount: items.filter(item => item.status === 'archived').length,
      discoveryCount: discoveries.filter(item => item.status !== 'rejected').length,
      averageExcessReturn: avgExcess,
      maxActiveThemes: MAX_ACTIVE_THEMES,
      topThemeId: activeItems[0]?.id ?? null,
      topThemeName: activeItems[0]?.name ?? null,
    },
    themes: items,
    discoveries: discoveries.slice(0, 25),
  };
}

export function getThemeDetail(themeId: string): ThemeDetailResponse {
  const theme = getTheme(themeId);
  return {
    theme,
    sleeve: getLatestThemeSleeve(themeId),
    benchmark: getThemeBenchmark(themeId),
    brief: getThemeResearchBrief(themeId),
    latestSnapshot: getThemeHistory(themeId, 1)[0] ?? null,
    history: getThemeHistory(themeId, 24),
    attribution: getThemeAttribution(themeId, 24),
    discoveries: getThemeDiscoveries(themeId),
  };
}

export function getTheme(themeId: string): ThemeDefinition | null {
  const row = db.prepare(`SELECT * FROM theme_definitions WHERE id = ?`).get(themeId) as any;
  return row ? rowToThemeDefinition(row) : null;
}

export function getThemeDiscoveries(themeId?: string): ThemeDiscovery[] {
  const rows = themeId
    ? db.prepare(`
        SELECT *
        FROM theme_discoveries
        WHERE theme_id = ?
        ORDER BY discovered_at DESC, predictive_score DESC
      `).all(themeId)
    : db.prepare(`
        SELECT *
        FROM theme_discoveries
        ORDER BY discovered_at DESC, predictive_score DESC
      `).all();
  return (rows as any[]).map(rowToThemeDiscovery);
}

export function getThemeHistory(themeId: string, limit = 50): ThemeSnapshot[] {
  const rows = db.prepare(`
    SELECT *
    FROM theme_snapshots
    WHERE theme_id = ?
    ORDER BY snapshot_at DESC
    LIMIT ?
  `).all(themeId, Math.min(limit, 200)) as any[];
  return rows.map(rowToThemeSnapshot);
}

export function getThemeAttribution(themeId: string, limit = 50): ThemeAttribution[] {
  const rows = db.prepare(`
    SELECT *
    FROM theme_attribution
    WHERE theme_id = ?
    ORDER BY measured_at DESC
    LIMIT ?
  `).all(themeId, Math.min(limit, 500)) as any[];
  return rows.map(rowToThemeAttribution);
}

export function getThemeBenchmark(themeId: string): ThemeBenchmark | null {
  const row = db.prepare(`SELECT * FROM theme_benchmarks WHERE theme_id = ?`).get(themeId) as any;
  if (!row) return null;
  return {
    symbol: row.symbol,
    name: row.name,
    benchmarkType: row.benchmark_type,
    rationale: row.rationale ?? null,
    metadata: parseJson(row.metadata, {}),
  };
}

export function getThemeResearchBrief(themeId: string): ThemeResearchBrief | null {
  const row = db.prepare(`SELECT * FROM theme_research_briefs WHERE theme_id = ?`).get(themeId) as any;
  if (!row) return null;
  return {
    themeId: row.theme_id,
    sleeveId: row.sleeve_id ?? null,
    summary: row.summary,
    catalysts: parseJson(row.catalysts, []),
    risks: parseJson(row.risks, []),
    benchmarkThesis: row.benchmark_thesis ?? null,
    horizon: row.horizon,
    confidence: row.confidence ?? 0,
    evidence: parseJson(row.evidence, {}),
    updatedAt: toMs(row.updated_at),
    createdAt: toMs(row.created_at),
  };
}

export function getLatestThemeSleeve(themeId: string): ThemeSleeve | null {
  const row = db.prepare(`
    SELECT *
    FROM theme_sleeves
    WHERE theme_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(themeId) as any;
  if (!row) return null;
  const members = (db.prepare(`
    SELECT *
    FROM theme_sleeve_members
    WHERE sleeve_id = ?
    ORDER BY weight DESC, symbol
  `).all(row.id) as any[]).map(rowToThemeSleeveMember);
  return rowToThemeSleeve(row, members);
}

function loadThemeContext(now: number): {
  events: ResearchEvent[];
  theses: LatestThesisRecord[];
} {
  const cutoff = now - DISCOVERY_LOOKBACK_HOURS * 60 * 60 * 1000;
  const events = getRecentResearchEvents(2000).filter(item => item.eventTimestamp >= cutoff);
  const theses = getLatestSymbolTheses({
    onlyFresh: true,
    limit: 3000,
    includeThemeSources: false,
  });
  return { events, theses };
}

function generateDiscovery(blueprint: ThemeBlueprint, context: ReturnType<typeof loadThemeContext>, now: number): ThemeDiscovery {
  const themeEvents = context.events.filter(event => eventBelongsToTheme(event, blueprint));
  const themeTheses = context.theses.filter(thesis => blueprint.symbols.includes(thesis.symbol));
  const bullishEvents = themeEvents.filter(item => item.sentiment === 'bullish');
  const bearishEvents = themeEvents.filter(item => item.sentiment === 'bearish');
  const directionalTheses = themeTheses.filter(item => item.stance !== 'HOLD');
  const sourceCount = new Set(themeEvents.map(item => `${item.sourceType}:${item.sourceId}`)).size + directionalTheses.length;
  const catalystCount = dedupe(themeEvents.map(item => item.eventType ?? item.title)).length;
  const predictiveScore = round(
    bullishEvents.reduce((sum, item) => sum + item.importance * 9, 0)
    - bearishEvents.reduce((sum, item) => sum + item.importance * 5, 0)
    + directionalTheses.reduce((sum, thesis) => sum + thesis.confidence * (thesis.stance === 'BUY' ? 8 : -6), 0)
    + Math.min(sourceCount, 8) * 1.5,
    2,
  );
  const confidence = clamp(
    0.35
    + Math.min(sourceCount / 12, 0.3)
    + Math.min(bullishEvents.length / 8, 0.2)
    + Math.max(0, directionalTheses.filter(item => item.stance === 'BUY').length - directionalTheses.filter(item => item.stance === 'SELL').length) * 0.03,
    0.2,
    0.92,
  );
  const topTitles = themeEvents.slice(0, 4).map(item => item.title);
  return {
    id: randomUUID(),
    themeId: blueprint.id,
    themeName: blueprint.name,
    discoveryKey: `${blueprint.id}:${new Date(now).toISOString().slice(0, 10)}`,
    status: predictiveScore >= 16 ? 'validated' : predictiveScore >= 9 ? 'staged' : 'rejected',
    sourceType: 'internal_research',
    evidenceType: 'cross_source_cluster',
    title: `${blueprint.name} ${predictiveScore >= 16 ? 'shows predictive strength' : predictiveScore >= 9 ? 'is building evidence' : 'lacks confirmation'}`,
    summary: topTitles[0]
      ? `${blueprint.name} is supported by ${sourceCount} evidence nodes. Top signal: ${topTitles[0]}.`
      : `${blueprint.name} currently relies on template coverage with limited fresh event confirmation.`,
    horizon: THEME_HORIZON,
    confidence,
    predictiveScore,
    sourceCount,
    catalystCount,
    validatedAssetCount: 0,
    unresolvedAssetCount: blueprint.symbols.length,
    benchmarkSymbol: blueprint.benchmark.symbol,
    benchmarkName: blueprint.benchmark.name,
    evidence: {
      bullishEvents: bullishEvents.length,
      bearishEvents: bearishEvents.length,
      directionalTheses: directionalTheses.length,
      topTitles,
      symbols: blueprint.symbols,
    },
    metadata: {},
    discoveredAt: now,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function rankThemeAssets(blueprint: ThemeBlueprint, context: ReturnType<typeof loadThemeContext>): AssetCandidate[] {
  const bySymbol = new Map<string, AssetCandidate>();
  for (const symbol of blueprint.symbols) {
    const instrument = resolveInstrument(symbol);
    if (!instrument) continue;
    const events = context.events.filter(event =>
      event.symbol === symbol
      || (event.symbol === 'MARKET' && matchesKeyword(event, blueprint.keywords)),
    );
    const theses = context.theses.filter(thesis => thesis.symbol === symbol);
    const bullishScore = events.reduce((sum, event) => sum + (event.sentiment === 'bullish' ? event.importance * 8 : 0), 0)
      + theses.reduce((sum, thesis) => sum + (thesis.stance === 'BUY' ? thesis.confidence * 10 : 0), 0);
    const bearishScore = events.reduce((sum, event) => sum + (event.sentiment === 'bearish' ? event.importance * 7 : 0), 0)
      + theses.reduce((sum, thesis) => sum + (thesis.stance === 'SELL' ? thesis.confidence * 9 : 0), 0);
    const score = round(
      bullishScore
      - bearishScore
      + (blueprint.sectors.includes(instrument.sector ?? '') ? 5 : 0)
      + (matchesBlueprint(symbol, blueprint) ? 3 : 0)
      + (events.length > 0 ? Math.min(events.length, 4) * 1.2 : 0),
      2,
    );
    const sourceRefs = dedupe([
      ...events.map(event => event.id),
      ...theses.map(thesis => thesis.id),
    ]);
    const rationaleParts = [
      bullishScore > 0 ? `${instrument.symbol} has ${round(bullishScore, 1)} bullish evidence score` : null,
      bearishScore > 0 ? `${round(bearishScore, 1)} bearish offsets remain` : null,
      events[0]?.title ?? null,
    ].filter(Boolean) as string[];
    bySymbol.set(symbol, {
      symbol: instrument.symbol,
      name: instrument.name,
      assetClass: instrument.assetClass,
      market: instrument.market,
      sector: instrument.sector,
      score,
      confidence: clamp(0.35 + Math.max(score, 0) / 40, 0.3, 0.9),
      bullishEvidence: bullishScore,
      bearishEvidence: bearishScore,
      sourceRefs,
      rationale: rationaleParts.join('. ') || `${instrument.symbol} remains in the validated theme universe.`,
      expectedReturn: round(clamp((score - bearishScore) / 100, -0.1, 0.35), 4),
    });
  }
  return [...bySymbol.values()].sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}

function buildSleeveMembers(assets: AssetCandidate[], benchmarkEntryPrice: number | null): ThemeSleeveMember[] {
  const base = assets.slice(0, MEMBER_COUNT).map(asset => ({
    ...asset,
    score: Math.max(asset.score, 1),
  }));
  const total = base.reduce((sum, asset) => sum + asset.score, 0);
  let members = base.map(asset => ({
    symbol: asset.symbol,
    name: asset.name,
    assetClass: asset.assetClass,
    market: asset.market,
    sector: asset.sector,
    weight: total > 0 ? asset.score / total : 1 / base.length,
    conviction: asset.confidence,
    benchmarkWeight: 0,
    activeWeight: 0,
    entryPrice: resolveCurrentPrice(asset.symbol, getCachedPrices()),
    currentPrice: resolveCurrentPrice(asset.symbol, getCachedPrices()),
    expectedReturn: asset.expectedReturn,
    evidenceScore: asset.score,
    rationale: asset.rationale,
    sourceRefs: asset.sourceRefs,
    metadata: {
      bullishEvidence: asset.bullishEvidence,
      bearishEvidence: asset.bearishEvidence,
      benchmarkEntryPrice,
    },
  }));
  members = normalizeWeights(members);
  return members.map(member => ({
    ...member,
    activeWeight: member.weight - member.benchmarkWeight,
  }));
}

function normalizeWeights<T extends { weight: number }>(members: T[]): T[] {
  if (members.length === 0) return members;
  let adjusted = members.map(member => ({
    ...member,
    weight: clamp(member.weight, MIN_MEMBER_WEIGHT, MAX_MEMBER_WEIGHT),
  }));
  let sum = adjusted.reduce((acc, member) => acc + member.weight, 0);
  adjusted = adjusted.map(member => ({
    ...member,
    weight: round(member.weight / sum, 6),
  }));
  sum = adjusted.reduce((acc, member) => acc + member.weight, 0);
  const diff = round(1 - sum, 6);
  adjusted[0] = {
    ...adjusted[0],
    weight: round(adjusted[0].weight + diff, 6),
  };
  return adjusted;
}

function upsertThemeDefinition(definition: Omit<ThemeDefinition, 'createdAt' | 'updatedAt'>): ThemeDefinition {
  db.prepare(`
    INSERT INTO theme_definitions (
      id, name, slug, status, description, thesis, horizon, asset_scope, benchmark_symbol, benchmark_name, benchmark_note,
      confidence, predictive_score, catalyst_score, confirmation_score, benchmark_relative_score, source_count, discovery_count,
      last_refresh_at, archived_at, metadata, created_at, updated_at
    ) VALUES (
      @id, @name, @slug, @status, @description, @thesis, @horizon, @asset_scope, @benchmark_symbol, @benchmark_name, @benchmark_note,
      @confidence, @predictive_score, @catalyst_score, @confirmation_score, @benchmark_relative_score, @source_count, @discovery_count,
      @last_refresh_at, @archived_at, @metadata, unixepoch(), unixepoch()
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      description = excluded.description,
      thesis = excluded.thesis,
      horizon = excluded.horizon,
      asset_scope = excluded.asset_scope,
      benchmark_symbol = excluded.benchmark_symbol,
      benchmark_name = excluded.benchmark_name,
      benchmark_note = excluded.benchmark_note,
      confidence = excluded.confidence,
      predictive_score = excluded.predictive_score,
      catalyst_score = excluded.catalyst_score,
      confirmation_score = excluded.confirmation_score,
      benchmark_relative_score = excluded.benchmark_relative_score,
      source_count = excluded.source_count,
      discovery_count = excluded.discovery_count,
      last_refresh_at = excluded.last_refresh_at,
      archived_at = excluded.archived_at,
      metadata = excluded.metadata,
      updated_at = unixepoch()
  `).run({
    id: definition.id,
    name: definition.name,
    slug: definition.slug,
    status: definition.status,
    description: definition.description,
    thesis: definition.thesis,
    horizon: definition.horizon,
    asset_scope: definition.assetScope,
    benchmark_symbol: definition.benchmarkSymbol,
    benchmark_name: definition.benchmarkName,
    benchmark_note: definition.benchmarkNote,
    confidence: definition.confidence,
    predictive_score: definition.predictiveScore,
    catalyst_score: definition.catalystScore,
    confirmation_score: definition.confirmationScore,
    benchmark_relative_score: definition.benchmarkRelativeScore,
    source_count: definition.sourceCount,
    discovery_count: definition.discoveryCount,
    last_refresh_at: toUnix(definition.lastRefreshAt),
    archived_at: toUnix(definition.archivedAt),
    metadata: JSON.stringify(definition.metadata),
  });
  return getTheme(definition.id)!;
}

function upsertThemeBenchmark(themeId: string, benchmark: ThemeBlueprint['benchmark']): void {
  db.prepare(`
    INSERT INTO theme_benchmarks (theme_id, symbol, name, benchmark_type, rationale, metadata, updated_at, created_at)
    VALUES (?, ?, ?, 'custom', ?, '{}', unixepoch(), unixepoch())
    ON CONFLICT(theme_id) DO UPDATE SET
      symbol = excluded.symbol,
      name = excluded.name,
      benchmark_type = excluded.benchmark_type,
      rationale = excluded.rationale,
      updated_at = unixepoch()
  `).run(themeId, benchmark.symbol, benchmark.name, benchmark.note);
}

function getNextSleeveVersion(themeId: string): number {
  const row = db.prepare(`
    SELECT MAX(version) AS version
    FROM theme_sleeves
    WHERE theme_id = ?
  `).get(themeId) as { version: number | null } | undefined;
  return (row?.version ?? 0) + 1;
}

function resolveInstrument(symbol: string): InstrumentRecord | null {
  const extra = EXTRA_INSTRUMENTS[symbol];
  if (extra) return extra;
  const known = COMPANY_INFO[symbol];
  if (known) {
    return {
      symbol,
      name: known.name,
      assetClass: symbol === 'COIN' ? 'crypto_proxy' : 'equity',
      market: 'US',
      sector: known.sector,
    };
  }
  const row = COMPANY_ROW.get(symbol) as { symbol: string; name: string; sector: string | null } | undefined;
  if (!row) return null;
  return {
    symbol,
    name: row.name,
    assetClass: 'equity',
    market: 'US',
    sector: row.sector,
  };
}

function requireBlueprint(id: string): ThemeBlueprint {
  const blueprint = THEME_BLUEPRINTS.find(item => item.id === id);
  if (!blueprint) throw new Error(`Unknown theme blueprint: ${id}`);
  return blueprint;
}

function matchesKeyword(event: ResearchEvent, keywords: string[]): boolean {
  const haystack = `${event.title} ${event.summary ?? ''} ${event.eventType ?? ''}`.toLowerCase();
  return keywords.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function eventBelongsToTheme(event: ResearchEvent, blueprint: ThemeBlueprint): boolean {
  if (blueprint.symbols.includes(event.symbol)) return true;
  if (!matchesKeyword(event, blueprint.keywords)) return false;
  if (event.symbol === 'MARKET') return true;
  const instrument = resolveInstrument(event.symbol);
  return !!instrument && blueprint.sectors.includes(instrument.sector ?? '');
}

function matchesBlueprint(symbol: string, blueprint: ThemeBlueprint): boolean {
  return blueprint.symbols.includes(symbol)
    || blueprint.sectors.includes(getSector(symbol))
    || blueprint.keywords.some(keyword => getCompanyName(symbol).toLowerCase().includes(keyword));
}

function collectCatalysts(blueprint: ThemeBlueprint, events: ResearchEvent[]): string[] {
  return dedupe(
    events
      .filter(event => eventBelongsToTheme(event, blueprint))
      .filter(event => event.sentiment !== 'bearish')
      .map(event => event.eventType ?? event.title),
  ).slice(0, 5);
}

function collectRisks(blueprint: ThemeBlueprint, events: ResearchEvent[]): string[] {
  return dedupe(
    events
      .filter(event => eventBelongsToTheme(event, blueprint))
      .filter(event => event.sentiment === 'bearish')
      .map(event => event.eventType ?? event.title),
  ).slice(0, 4);
}

function resolveCurrentPrice(symbol: string, livePrices: Record<string, number>): number | null {
  const live = livePrices[symbol];
  if (live && live > 0) return live;
  const stored = LAST_PRICE_ROW.get(symbol) as { close: number } | undefined;
  return stored?.close ?? null;
}

function getDiscoveryByKey(discoveryKey: string): ThemeDiscovery | null {
  const row = db.prepare(`SELECT * FROM theme_discoveries WHERE discovery_key = ?`).get(discoveryKey) as any;
  return row ? rowToThemeDiscovery(row) : null;
}

function rowToThemeDefinition(row: any): ThemeDefinition {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    description: row.description ?? null,
    thesis: row.thesis ?? null,
    horizon: row.horizon,
    assetScope: row.asset_scope,
    benchmarkSymbol: row.benchmark_symbol ?? null,
    benchmarkName: row.benchmark_name ?? null,
    benchmarkNote: row.benchmark_note ?? null,
    confidence: row.confidence ?? 0,
    predictiveScore: row.predictive_score ?? 0,
    catalystScore: row.catalyst_score ?? 0,
    confirmationScore: row.confirmation_score ?? 0,
    benchmarkRelativeScore: row.benchmark_relative_score ?? 0,
    sourceCount: row.source_count ?? 0,
    discoveryCount: row.discovery_count ?? 0,
    lastRefreshAt: toMs(row.last_refresh_at),
    archivedAt: toMs(row.archived_at),
    metadata: parseJson(row.metadata, {}),
    createdAt: toMs(row.created_at) ?? Date.now(),
    updatedAt: toMs(row.updated_at) ?? Date.now(),
  };
}

function rowToThemeDiscovery(row: any): ThemeDiscovery {
  return {
    id: row.id,
    themeId: row.theme_id ?? null,
    themeName: row.theme_name,
    discoveryKey: row.discovery_key,
    status: row.status,
    sourceType: row.source_type,
    evidenceType: row.evidence_type,
    title: row.title,
    summary: row.summary ?? null,
    horizon: row.horizon,
    confidence: row.confidence ?? 0,
    predictiveScore: row.predictive_score ?? 0,
    sourceCount: row.source_count ?? 0,
    catalystCount: row.catalyst_count ?? 0,
    validatedAssetCount: row.validated_asset_count ?? 0,
    unresolvedAssetCount: row.unresolved_asset_count ?? 0,
    benchmarkSymbol: row.benchmark_symbol ?? null,
    benchmarkName: row.benchmark_name ?? null,
    evidence: parseJson(row.evidence, {}),
    metadata: parseJson(row.metadata, {}),
    discoveredAt: toMs(row.discovered_at) ?? Date.now(),
    publishedAt: toMs(row.published_at),
    createdAt: toMs(row.created_at) ?? Date.now(),
    updatedAt: toMs(row.updated_at) ?? Date.now(),
  };
}

function rowToThemeSleeve(row: any, members: ThemeSleeveMember[]): ThemeSleeve {
  return {
    id: row.id,
    themeId: row.theme_id,
    version: row.version,
    status: row.status,
    horizon: row.horizon,
    benchmarkSymbol: row.benchmark_symbol,
    benchmarkName: row.benchmark_name,
    benchmarkNote: row.benchmark_note ?? null,
    confidence: row.confidence ?? 0,
    predictiveScore: row.predictive_score ?? 0,
    expectedAlpha: row.expected_alpha ?? null,
    expectedVolatility: row.expected_volatility ?? null,
    rebalanceReason: row.rebalance_reason ?? null,
    builtFromDiscoveryIds: parseJson(row.built_from_discovery_ids, []),
    metadata: parseJson(row.metadata, {}),
    builtAt: toMs(row.built_at) ?? Date.now(),
    createdAt: toMs(row.created_at) ?? Date.now(),
    updatedAt: toMs(row.updated_at) ?? Date.now(),
    members,
  };
}

function rowToThemeSleeveMember(row: any): ThemeSleeveMember {
  return {
    symbol: row.symbol,
    name: row.name,
    assetClass: row.asset_class,
    market: row.market,
    sector: row.sector ?? null,
    weight: row.weight,
    conviction: row.conviction,
    benchmarkWeight: row.benchmark_weight ?? 0,
    activeWeight: row.active_weight ?? row.weight,
    entryPrice: row.entry_price ?? null,
    currentPrice: row.current_price ?? null,
    expectedReturn: row.expected_return ?? null,
    evidenceScore: row.evidence_score ?? 0,
    rationale: row.rationale,
    sourceRefs: parseJson(row.source_refs, []),
    metadata: parseJson(row.metadata, {}),
  };
}

function rowToThemeSnapshot(row: any): ThemeSnapshot {
  return {
    id: row.id,
    themeId: row.theme_id,
    sleeveId: row.sleeve_id ?? null,
    sleeveVersion: row.sleeve_version ?? null,
    totalReturn: row.total_return ?? null,
    benchmarkReturn: row.benchmark_return ?? null,
    excessReturn: row.excess_return ?? null,
    hitRate: row.hit_rate ?? null,
    actionableCount: row.actionable_count ?? 0,
    memberCount: row.member_count ?? 0,
    snapshotValue: row.snapshot_value ?? null,
    benchmarkValue: row.benchmark_value ?? null,
    attributionSummary: parseJson(row.attribution_summary, {}),
    metadata: parseJson(row.metadata, {}),
    snapshotAt: toMs(row.snapshot_at) ?? Date.now(),
    createdAt: toMs(row.created_at) ?? Date.now(),
  };
}

function rowToThemeAttribution(row: any): ThemeAttribution {
  return {
    id: row.id,
    themeId: row.theme_id,
    sleeveId: row.sleeve_id ?? null,
    sleeveVersion: row.sleeve_version ?? null,
    symbol: row.symbol,
    contributionReturn: row.contribution_return ?? null,
    excessContribution: row.excess_contribution ?? null,
    weight: row.weight ?? null,
    benchmarkWeight: row.benchmark_weight ?? null,
    rationale: row.rationale ?? null,
    metadata: parseJson(row.metadata, {}),
    measuredAt: toMs(row.measured_at) ?? Date.now(),
    createdAt: toMs(row.created_at) ?? Date.now(),
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function dedupe(items: Array<string | null | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item && item.trim())))];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 6);
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toUnix(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.floor(value / 1000);
}

function toUnixMs(value: number): number {
  return value;
}

function toMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function maxNullable(values: Array<number | null>): number | null {
  const filtered = values.filter(isNumber);
  return filtered.length > 0 ? Math.max(...filtered) : null;
}
