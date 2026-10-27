// Frontend API client — all calls are fire-and-forget safe (never throw to caller)
// If the backend is offline, functions return null/[] silently.

export interface FundamentalData {
  symbol: string;
  peRatio: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  marketCap: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  freeCashFlow: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: number;
}

export interface EarningsEvent {
  symbol: string;
  earningsDate: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  daysUntil: number;
}

export interface RiskCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RiskCheckResult {
  allowed: boolean;
  failedCheck: string | null;
  reason: string;
  checks: RiskCheck[];
}

export interface StopLossAlert {
  symbol: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  pnlPct: number;
  unrealizedLoss: number;
}

export interface TechnicalSnapshot {
  symbol: string;
  currentPrice: number;
  change1d: number;
  rsi14: number;
  ema20: number;
  ema50: number;
  ema200: number | null;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  atr14: number;
  volumeRatio: number;
  trend: 'strongly_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strongly_bearish';
  signals: string[];
  dataPoints: number;
  updatedAt: number;
}

export interface DataSourceStatus {
  source: string;
  status: 'ok' | 'stale' | 'error' | 'idle';
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  itemCount: number | null;
  details: Record<string, any>;
  updatedAt: number;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  action?: 'BUY' | 'SELL';
  type?: 'BUY' | 'SELL';
  shares: number;
  price: number;
  total_value: number;
  created_at: number;
}

export interface RiskEventRecord {
  id: number;
  symbol: string;
  action: string;
  allowed: boolean;
  failed_check: string | null;
  reason: string;
  created_at: number;
}

export interface OverviewStats {
  processedArticles: number;
  totalArticles: number;
  totalAnalyses: number;
  totalTrades: number;
}

export interface KnowledgeProfile {
  analysis_count: number;
  avg_confidence: number | null;
  updated_at: number;
  bull_thesis: string;
  bear_thesis: string;
  news_sensitivity: string;
  pattern_notes: string | null;
}

export interface KnowledgeStatusRow {
  symbol: string;
  hasProfile: boolean;
  analyses: number;
  lastConsolidated: number | null;
}

export interface ScreenerResultRow {
  symbol: string;
  sector: string;
  changePercent: number;
  volumeRatio: number;
  signals: string[];
  rsi14: number | null;
  score: number;
  isCore: boolean;
  screenedAt: number | null;
}

export interface FilingRecordSummary {
  id: string;
  symbol: string;
  processed: boolean;
  form: string;
  description: string;
  filed: string;
}

export interface SectorPerformanceRow {
  sector: string;
  trend: 'strong_inflow' | 'inflow' | 'neutral' | 'outflow' | 'strong_outflow';
  return1w: number;
  return1m: number;
  relStrength: number;
}

export interface WeeklySnapshot {
  weeklyRSI: number | null;
  weeklyTrend: 'up' | 'down' | 'neutral';
  multiframeTrend: 'confirmed_bull' | 'bull_caution' | 'neutral' | 'bear_caution' | 'confirmed_bear';
  confluence: 'high' | 'low' | 'neutral' | string;
}

export interface ResearchEvent {
  id: string;
  sourceType: 'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest';
  sourceId: string;
  symbol: string;
  title: string;
  summary: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  eventType: string | null;
  importance: number;
  url: string | null;
  payload: Record<string, any>;
  eventTimestamp: number;
  createdAt: number;
}

export interface SignalCandidate {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  decisionAction?: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | null;
  decisionBatchId?: string | null;
  actionable?: boolean;
  score: number;
  confidence: number;
  status: 'new' | 'pending_approval' | 'in_flight' | 'executed' | 'blocked' | 'stale';
  reasoning: string;
  sourceEventIds: string[];
  factorBreakdown: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchStoryEvent {
  id: string;
  sourceType: 'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest';
  sourceId: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  title: string;
  summary: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
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
  scope: 'market' | 'sector' | 'stock';
  entity: string;
  title: string;
  summary: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  storyScore: number;
  researchScore: number;
  confirmationBonus: number;
  actionBonus: number;
  freshnessBonus: number;
  eventCount: number;
  sourceTypes: Array<'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest'>;
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
  sentiment: 'bullish' | 'bearish' | 'neutral';
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
  marketBias: 'bullish' | 'bearish' | 'neutral';
  marketPulseScore: number;
  topSector: string | null;
  topSectorScore: number | null;
  topSymbol: string | null;
  topSymbolScore: number | null;
  macroRegime: string;
  rotationSummary: string;
}

export interface ResearchSelectedEntity {
  scope: 'market' | 'sector' | 'stock';
  entity: string;
  label: string;
  sector: string | null;
  score: number;
  eventCount: number;
  storyCount: number;
  lastActivityAt: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  actionableCount: number;
  inPortfolio: boolean;
  linkedAction: string | null;
  latestCandidate: SignalCandidate | null;
  latestDecision: AutonomyDecision | null;
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
  assetClass: 'equity' | 'etf' | 'crypto_proxy';
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
  status: 'active' | 'staged' | 'archived' | 'deprecated';
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

export interface ThemeDiscovery {
  id: string;
  themeId: string | null;
  themeName: string;
  discoveryKey: string;
  status: 'staged' | 'validated' | 'published' | 'rejected' | 'archived';
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

export interface ThemeListItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'staged' | 'archived' | 'deprecated';
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
  sleeve: ThemeSleeve | null;
  latestSnapshot: ThemeSnapshot | null;
  benchmark: ThemeBenchmark | null;
  brief: ThemeResearchBrief | null;
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

export interface ThemeListResponse {
  overview: ThemeLabOverview;
  themes: ThemeListItem[];
  discoveries: ThemeDiscovery[];
}

export interface ThemeDetailResponse {
  theme: ThemeListItem | null;
  sleeve: ThemeSleeve | null;
  benchmark: ThemeBenchmark | null;
  brief: ThemeResearchBrief | null;
  latestSnapshot: ThemeSnapshot | null;
  history: ThemeSnapshot[];
  attribution: ThemeAttribution[];
  discoveries: ThemeDiscovery[];
}

export interface AgentStatus {
  name: string;
  sourceKey: string;
  intervalMs: number;
  running: boolean;
  inFlight: boolean;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastUsableOutputAt?: number | null;
  lastError: string | null;
  errorCount: number;
  cadenceStatus?: 'on_time' | 'late' | 'missed' | 'idle';
  freshnessStatus?: 'fresh' | 'stale' | 'idle';
  blockedDependencies?: string[];
}

export interface AutonomyThesis {
  id: string;
  agentName: string;
  sourceKey: string;
  symbol: string;
  stance: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  horizon: string;
  catalyst: string | null;
  invalidation: string | null;
  thesis: string;
  freshnessScore: number;
  supportingObservationIds: string[];
  createdAt: number;
  expiresAt: number | null;
}

export interface AutonomyDecisionContribution {
  agentName: string;
  sourceKey: string;
  symbol: string;
  stance: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  weight: number;
  weightedScore: number;
  freshnessScore: number;
  thesisId?: string;
  thesis: string;
}

export interface AutonomyDecision {
  id: string;
  symbol: string;
  action: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD';
  stance: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  score: number;
  disagreementPenalty: number;
  freshnessScore: number;
  coverage: number;
  requiredCoverageMet: boolean;
  macroRegime: string;
  decisionReason: string;
  heldOutReason: string | null;
  contributions: AutonomyDecisionContribution[];
  sourceThesisIds: string[];
  sourceForecastIds: string[];
  metadata: Record<string, any>;
  createdAt: number;
}

export interface PortfolioIntent {
  id: string;
  symbol: string;
  action: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD';
  confidence: number;
  score: number;
  decisionBatchId: string;
  reasoning: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface AutonomyDecisionResponse {
  decisions: AutonomyDecision[];
  intents: PortfolioIntent[];
}

export interface AutonomyForecastRow {
  id: string;
  agent_name?: string;
  source_key?: string;
  symbol?: string | null;
  scope?: string | null;
  market_topic?: string | null;
  target_variable?: string | null;
  target?: string | null;
  event_type?: string | null;
  direction?: string | null;
  predicted_direction?: string | null;
  probability: number;
  confidence: number;
  reasoning: string | null;
  status: string;
  window_start_at?: number | null;
  window_end_at?: number | null;
  resolution_window_start?: number | null;
  resolution_window_end?: number | null;
  prediction_timestamp?: number | null;
  created_at?: number | null;
  actual_direction?: string | null;
  actual_value?: number | null;
}

export interface AutonomyForecastResponse {
  eventForecasts: AutonomyForecastRow[];
  marketForecasts: AutonomyForecastRow[];
}

export interface AutonomyLineage {
  decision: AutonomyDecision | null;
  theses: AutonomyThesis[];
  forecasts: AutonomyForecastRow[];
  trades: Array<Record<string, any>>;
}

export interface CalibrationSourceSummary {
  sourceKey: string;
  weight: number;
  hitRate: number;
  sampleSize: number;
  brierScore: number | null;
  avgConfidence: number | null;
}

export interface AgentFreshness {
  agentName: string;
  sourceKey: string;
  cadenceMs: number;
  freshnessTtlMs: number | null;
  lastRunAt: number | null;
  lastUsableOutputAt: number | null;
  cadenceStatus: 'on_time' | 'late' | 'missed' | 'idle';
  freshnessStatus: 'fresh' | 'stale' | 'idle';
}

export interface AutonomyCalibrationResponse {
  calibration: {
    bySource: CalibrationSourceSummary[];
    overall: {
      totalResolved: number;
      hitRate: number | null;
      brierScore: number | null;
    };
  };
  freshness: AgentFreshness[];
}

export interface HedgeFundChange {
  manager_id: string;
  manager_name: string;
  manager_style: string;
  period_of_report: string;
  ticker: string | null;
  issuer_name: string;
  change_type: 'new' | 'added' | 'reduced' | 'exited';
  prior_shares: number | null;
  current_shares: number;
  pct_change: number | null;
  current_value_thousands: number;
  is_significant: number;
}

export interface HedgeFundHolding {
  manager_id: string;
  manager_name: string;
  manager_style: string;
  period_of_report: string;
  ticker: string | null;
  issuer_name: string;
  shares: number;
  value_thousands: number;
}

export interface SmartMoneySummary {
  topBuys: Array<{ ticker: string; issuer_name: string; fund_count: number; total_value_thousands: number }>;
  topSells: Array<{ ticker: string; issuer_name: string; fund_count: number; prior_total_shares: number }>;
}

export interface CompanyRow {
  symbol: string;
  name: string;
  sector: string | null;
}

export interface ExecutionAttempt {
  id: string;
  cycleId: string | null;
  candidateId: string | null;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  status: 'planned' | 'awaiting_approval' | 'submitted' | 'partially_filled' | 'filled' | 'rejected' | 'cancelled';
  plannedShares: number | null;
  plannedPrice: number | null;
  initialTargetShares?: number | null;
  initialTargetValue?: number | null;
  finalTargetShares?: number | null;
  finalTargetValue?: number | null;
  baseTargetWeight?: number | null;
  adjustedTargetWeight?: number | null;
  constructionBand?: string | null;
  constructionReason?: string | null;
  filledShares: number | null;
  fillPrice: number | null;
  brokerOrderId: string | null;
  brokerOrderIds?: string[];
  slippageBps: number | null;
  rolloutProfile?: string | null;
  sessionRegime?: string | null;
  sizingMultiplier?: number | null;
  sizingBand?: string | null;
  sizingReason?: string | null;
  strategyBand?: string | null;
  timingBand?: string | null;
  retryCount?: number;
  terminalPath?: string | null;
  completionRatio?: number | null;
  completionState?: string | null;
  stateHistory?: Array<Record<string, any>>;
  submittedAt?: number | null;
  firstFillAt?: number | null;
  lastFillAt?: number | null;
  cancelledAt?: number | null;
  rejectedAt?: number | null;
  completedAt?: number | null;
  degradedExecution?: boolean;
  degradationReasons?: string[];
  retryReason: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DegradationStatus {
  severity: 'none' | 'warning' | 'critical';
  signals: Array<{ id: string; severity: 'none' | 'warning' | 'critical'; detail: string }>;
  liveAutoLockEngaged: boolean;
  liveAutoLockReason: string | null;
  executionAllowedLive: boolean;
  executionAllowedPaper: boolean;
  lastCriticalAt: number | null;
  lastHealthyAt: number | null;
  stableAfter: number | null;
  updatedAt: number | null;
}

export interface ExecutionHistoryRow {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  status: string;
  terminalPath: string | null;
  retryCount: number;
  strategyBand: string | null;
  timingBand: string | null;
  sizingBand: string | null;
  sizingMultiplier: number | null;
  initialTargetShares: number | null;
  finalTargetShares: number | null;
  initialTargetValue: number | null;
  finalTargetValue: number | null;
  baseTargetWeight: number | null;
  adjustedTargetWeight: number | null;
  constructionBand: string | null;
  constructionReason: string | null;
  plannedShares: number | null;
  filledShares: number | null;
  completionRatio: number | null;
  completionState: string | null;
  slippageBps: number | null;
  latencySeconds: number | null;
  createdAt: number;
  submittedAt: number | null;
  firstFillAt: number | null;
  lastFillAt: number | null;
  cancelledAt: number | null;
  rejectedAt: number | null;
  completedAt: number | null;
  brokerOrderId: string | null;
  brokerOrderIds: string[];
  rolloutProfile: string | null;
  sessionRegime: string | null;
  degradedExecution: boolean;
  degradationReasons: string[];
  candidateId: string | null;
  candidateReasoning: string | null;
  linkedTradeId: string | null;
  linkedTradeStatus: string | null;
  linkedTradePrice: number | null;
  linkedTradeShares: number | null;
  realizedPnl: number | null;
  stateHistory: Array<Record<string, any>>;
  error: string | null;
}

export interface ExecutionHistoryResponse {
  total: number;
  items: ExecutionHistoryRow[];
}

export interface ExecutionQualitySummaryRow {
  symbol: string;
  action: 'BUY' | 'SELL';
  mode: string;
  rolloutProfile: string | null;
  sessionRegime: string | null;
  terminalPath: string;
  attempts: number;
  avgRetryCount: number | null;
  avgCompletionRatio: number | null;
  avgAbsSlippageBps: number | null;
  avgLatencySeconds: number | null;
  degradedAttempts: number;
}

export interface StoredNewsArticle {
  id: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: number | null;
  processed: boolean;
  summary: string | null;
  sentiment: string | null;
  relevantSymbols: string[];
  createdAt: number;
}

export interface DailyReport {
  generatedAt: number;
  mode: string;
  operatorSummary: string;
  agent: {
    running: boolean;
    cycleCount: number;
    lastCycleAt: number | null;
    lastCycleId: string | null;
    processing: boolean;
    mode: string;
    degraded: boolean;
    marketSession: Record<string, any>;
    freshness: Record<string, any>;
  };
  marketSession: Record<string, any>;
  metrics: any;
  dataFreshness: { generatedAt: number; datasets: Record<string, number | null>; sources: DataSourceStatus[] };
  staleSources: DataSourceStatus[];
  candidateFunnel: {
    total: number;
    new: number;
    pendingApproval: number;
    inFlight: number;
    executed: number;
    blocked: number;
    stale: number;
    buy: number;
    sell: number;
    highConfidence: number;
  };
  executionSummary: {
    total: number;
    planned: number;
    submitted: number;
    partiallyFilled: number;
    filled: number;
    rejected: number;
    cancelled: number;
    fillRate: number | null;
  };
  constructionSummary: {
    clean: number;
    reduced: number;
    severe: number;
  };
  executionOps: {
    active: number;
    submitted: number;
    partiallyFilled: number;
    stale: number;
    autoRecoveryTagged: number;
    blockedTerminal: number;
    items: Array<{
      id: string;
      symbol: string;
      action: 'BUY' | 'SELL';
      status: string;
      ageMinutes: number;
      stale: boolean;
      retryReason: string | null;
      error: string | null;
      plannedShares: number | null;
      filledShares: number | null;
      retryCount: number;
      rolloutProfile: string | null;
      sessionRegime: string | null;
      policyBand: 'blocked' | 'tightened' | 'base' | 'loosened';
      policyReason: string;
      maxResubmits: number;
      recoveryTimingBand: 'accelerated' | 'base' | 'extended';
      recoveryTimingReason: string;
      staleAfterMinutes: number;
      resubmitCooldownMinutes: number;
      resubmitStrategyBand: 'aggressive' | 'base' | 'reduced' | 'halt_partial';
      resubmitStrategyReason: string;
      resubmitSizePct: number;
      allowPartialResubmit: boolean;
    }>;
  };
  brokerOps: {
    reconciliation: {
      running: boolean;
      lastRunAt: number | null;
      lastSuccessAt: number | null;
      lastError: string | null;
      lastResult: any;
    };
    recovery: {
      running: boolean;
      lastRunAt: number | null;
      lastSuccessAt: number | null;
      lastError: string | null;
      lastResult: any;
    };
  };
  risk: {
    total: number;
    blocked: number;
    passed: number;
    topBlockReasons: Array<{ reason: string; count: number }>;
  };
  candidates: SignalCandidate[];
  researchEvents: ResearchEvent[];
  executionAttempts: ExecutionAttempt[];
  decisionTrail: Array<{
    candidateId: string;
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    decisionAction?: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | null;
    actionable?: boolean;
    decisionBatchId?: string | null;
    candidateStatus: string;
    executionStatus: string | null;
    confidence: number;
    score: number;
    reasoning: string;
    heldOutReason?: string | null;
    sourceTypes: string[];
    eventTitles: string[];
    fillPrice: number | null;
    plannedShares: number | null;
    filledShares: number | null;
    pnl: number | null;
    exitReason: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  blockedDecisions: Array<{
    candidateId: string;
    symbol: string;
    action: 'BUY' | 'SELL' | 'HOLD';
    decisionAction?: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'HOLD' | null;
    actionable?: boolean;
    decisionBatchId?: string | null;
    candidateStatus: string;
    executionStatus: string | null;
    confidence: number;
    score: number;
    reasoning: string;
    heldOutReason?: string | null;
    sourceTypes: string[];
    eventTitles: string[];
    fillPrice: number | null;
    plannedShares: number | null;
    filledShares: number | null;
    pnl: number | null;
    exitReason: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  recentCycles: any[];
}

export interface SystemControls {
  killSwitchEngaged: boolean;
  liveTradingEnabled: boolean;
  liveRolloutProfile: 'paper' | 'limited_live' | 'full_live';
  updatedAt: number | null;
}

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama';

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
}

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKeysConfigured: Record<AiProvider, boolean>;
  maskedKeys: Record<string, string>;
  budgetLimitUsd: number;
  totalSpendUsd: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalRequests: number;
  budgetBlocked: boolean;
  remainingBudgetUsd: number;
  spendPercent: number;
  updatedAt: number;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  sampleResponse?: any;
}

export interface AiUsageLog {
  id: number;
  provider: string;
  model: string;
  purpose: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  blocked: number;
  created_at: number;
}

export interface ReadinessGate {
  id: string;
  label: string;
  passed: boolean;
  value: string;
  detail: string;
}

export interface ReadinessStatus {
  eligibleForLive: boolean;
  liveExecutionAllowed: boolean;
  brokerMode: string;
  controls: SystemControls;
  degradation: DegradationStatus;
  gates: ReadinessGate[];
  summary: string;
  stats: {
    paperTrackRecordDays: number;
    paperFilledExecutions: number;
    staleCriticalSources: number;
    orphanedAttempts: number;
    offSessionFills: number;
    auditCoveragePct: number;
    filledAttemptCoveragePct: number;
  };
}

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const authToken = import.meta.env.VITE_API_AUTH_TOKEN as string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) throw new Error(`[API] ${res.status} ${path}`);
  return res.json();
}

// Wrapper that silently swallows errors — backend being down never breaks the UI
function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(err => {
    console.debug('[API] Backend unavailable:', err?.message);
    return fallback;
  });
}

function deriveCoordinatorStatus(statuses: AgentStatus[]) {
  const coordinator = statuses.find(status => status.name === 'coordinator');
  return coordinator
    ? {
        running: coordinator.running,
        cycleCount: 0,
        lastCycleAt: coordinator.lastRunAt,
        lastCycleId: null,
        processing: coordinator.inFlight,
        mode: 'paper',
        degraded: Boolean(coordinator.lastError),
        killSwitchEngaged: false,
        liveExecutionAllowed: false,
        readinessEligible: false,
        marketSession: null,
        freshness: null,
      }
    : null;
}

export const api = {
  getCompanies: () =>
    safe(request<CompanyRow[]>('/companies'), []),

  // ── Multi-Timeframe ──────────────────────────────────────────────────────────
  getWeeklySnapshots: () =>
    safe(request<Record<string, WeeklySnapshot | null>>('/multitimeframe/all'), {}),

  getWeeklySnapshot: (symbol: string) =>
    safe(request<any>(`/multitimeframe/${symbol}`), null),

  // ── Sector Rotation ───────────────────────────────────────────────────────────
  getSectorPerformance: () =>
    safe(request<SectorPerformanceRow[]>('/sectors/performance'), []),

  getSectorRotationSummary: () =>
    safe(request<{ summary: string; sectors: any[] }>('/sectors/rotation-summary'), null),

  // ── Broker (Alpaca) ──────────────────────────────────────────────────────────
  getBrokerStatus: () =>
    safe(request<{ mode: string; connected: boolean; hasKey: boolean; hasSecret?: boolean; maskedKey?: string; maskedSecret?: string; executionAllowed: boolean; killSwitchEngaged: boolean; eligibleForLive: boolean }>('/broker/status'), null),

  getBrokerConfig: () =>
    safe(request<{ mode: 'simulation' | 'paper' | 'live'; hasKey: boolean; hasSecret: boolean; maskedKey: string; maskedSecret: string; connected: boolean; updatedAt: number }>('/broker/config'), null),

  saveBrokerConfig: (params: { mode?: 'simulation' | 'paper' | 'live'; apiKey?: string; apiSecret?: string }) =>
    safe(request<{ ok: boolean; config: any }>('/broker/config', {
      method: 'POST',
      body: JSON.stringify(params),
    }), null),

  testBrokerConnection: (params?: { apiKey?: string; apiSecret?: string; mode?: string }) =>
    safe(request<{ ok: boolean; account?: any; error?: string }>('/broker/test', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }), null),

  getBrokerAccount: () =>
    safe(request<any>('/broker/account'), null),

  getBrokerPositions: () =>
    safe(request<any[]>('/broker/positions'), []),

  getBrokerOrders: (status: 'open' | 'closed' | 'all' = 'closed') =>
    safe(request<any[]>(`/broker/orders?status=${status}`), []),

  triggerKillSwitch: () =>
    safe(request<{ ok: boolean; message: string }>('/broker/kill-switch', { method: 'POST' }), null),

  getSystemControls: () =>
    safe(request<SystemControls>('/system/controls'), null),

  setKillSwitch: (engaged: boolean) =>
    safe(request<{ ok: boolean; controls: SystemControls; readiness: ReadinessStatus }>('/system/controls/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ engaged }),
    }), null),

  getReadinessStatus: () =>
    safe(request<ReadinessStatus>('/system/readiness'), null),

  getDegradationStatus: () =>
    safe(request<DegradationStatus>('/system/degradation'), null),

  setLiveExecutionEnabled: (enabled: boolean) =>
    safe(request<{ ok: boolean; controls: SystemControls; readiness: ReadinessStatus }>('/system/controls/live-enable', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }), null),

  setLiveRolloutProfile: (profile: 'paper' | 'limited_live' | 'full_live') =>
    safe(request<{ ok: boolean; controls: SystemControls; readiness: ReadinessStatus }>('/system/controls/live-rollout-profile', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    }), null),

  placeBrokerOrder: (symbol: string, side: 'buy' | 'sell', qty: number) =>
    safe(request<any>('/broker/order', {
      method: 'POST',
      body: JSON.stringify({ symbol, side, qty }),
    }), null),

  // ── Backtesting ──────────────────────────────────────────────────────────────
  getBacktestDefaultConfig: () =>
    safe(request<any>('/backtest/default-config'), null),

  runBacktest: (config: any) =>
    safe(request<any>('/backtest/run', {
      method: 'POST',
      body: JSON.stringify(config),
    }), null),

  getReplayDefaultConfig: () =>
    safe(request<any>('/replay/default-config'), null),

  runReplay: (config: any) =>
    safe(request<any>('/replay/run', {
      method: 'POST',
      body: JSON.stringify(config),
    }), null),

  // ── Performance Analytics ────────────────────────────────────────────────────
  getPerformanceMetrics: () =>
    safe(request<any>('/performance/metrics'), null),

  getPerformanceHistory: () =>
    safe(request<Array<{ date: string; value: number; returnPct: number }>>('/performance/history'), []),

  // ── Screener ──────────────────────────────────────────────────────────────────
  getScreenerResults: () =>
    safe(request<ScreenerResultRow[]>('/screener/results'), []),

  runScreener: () =>
    safe(request('/screener/run', { method: 'POST' }), null),

  // ── 8-K Filings ───────────────────────────────────────────────────────────────
  getRecentFilings: (days = 7) =>
    safe(request<FilingRecordSummary[]>(`/filings/recent?days=${days}`), []),

  triggerFilingsCheck: () =>
    safe(request('/filings/check', { method: 'POST' }), null),

  // ── Knowledge Base ────────────────────────────────────────────────────────────
  getKnowledgeProfiles: () =>
    safe(request<Record<string, KnowledgeProfile>>('/knowledge/profiles'), {}),

  getKnowledgeStatus: () =>
    safe(request<KnowledgeStatusRow[]>('/knowledge/status'), []),

  triggerConsolidation: (symbol?: string) =>
    safe(request('/knowledge/consolidate', {
      method: 'POST',
      body: JSON.stringify(symbol ? { symbol } : {}),
    }), null),

  // ── Agent Control ────────────────────────────────────────────────────────────
  getAgentStatuses: () =>
    safe(request<AgentStatus[]>('/agents/status'), []),

  getAgentStatus: async () => {
    const [statuses, readiness, systemHealth] = await Promise.all([
      safe(request<AgentStatus[]>('/agents/status'), []),
      safe(request<any>('/system/readiness'), null),
      safe(request<any>('/system/health'), null),
    ]);
    const coordinator = deriveCoordinatorStatus(statuses);
    if (!coordinator) return null;
    return {
      ...coordinator,
      cycleCount: systemHealth?.scheduler?.coordinator?.cycleCount ?? 0,
      lastCycleId: systemHealth?.scheduler?.coordinator?.lastCycleId ?? null,
      mode: systemHealth?.mode ?? 'paper',
      degraded: Boolean(systemHealth?.degraded ?? coordinator.degraded),
      killSwitchEngaged: Boolean(readiness?.controls?.killSwitchEngaged),
      liveExecutionAllowed: Boolean(readiness?.liveExecutionAllowed),
      readinessEligible: Boolean(readiness?.eligibleForLive),
      marketSession: systemHealth?.marketSession ?? null,
      freshness: systemHealth?.scheduler?.coordinator?.freshness ?? null,
    };
  },

  startAgent: () =>
    safe(request('/agents/coordinator/start', { method: 'POST' }), null),

  stopAgent: () =>
    safe(request('/agents/coordinator/stop', { method: 'POST' }), null),

  startAllAgents: () =>
    safe(request('/agents/start-all', { method: 'POST' }), null),

  stopAllAgents: () =>
    safe(request('/agents/stop-all', { method: 'POST' }), null),

  startNamedAgent: (name: string) =>
    safe(request(`/agents/${name}/start`, { method: 'POST' }), null),

  stopNamedAgent: (name: string) =>
    safe(request(`/agents/${name}/stop`, { method: 'POST' }), null),

  getAgentLogs: (limit = 100, name = 'coordinator') =>
    safe(request<any[]>(`/agents/${name}/logs?limit=${limit}`), []),

  // ── AI Provider & Budget Management ──────────────────────────────────────────
  getAiConfig: () =>
    safe(request<AiConfig>('/ai/config'), null),

  saveAiConfig: (params: { provider?: AiProvider; model?: string; apiKey?: string; budgetLimitUsd?: number }) =>
    safe(request<{ ok: boolean; config: AiConfig }>('/ai/config', {
      method: 'POST',
      body: JSON.stringify(params),
    }), null),

  resetAiSpend: () =>
    safe(request<{ ok: boolean; config: AiConfig }>('/ai/reset-spend', { method: 'POST' }), null),

  getAiModels: (provider: AiProvider, apiKey?: string) =>
    safe(request<{ ok: boolean; models: ModelOption[] }>(`/ai/models?provider=${provider}${apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : ''}`), { ok: true, models: [] }),

  testAiConnection: (params?: { provider?: AiProvider; model?: string; apiKey?: string }) =>
    safe(request<AiTestResult>('/ai/test', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }), { ok: false, latencyMs: 0, error: 'Connection test failed' }),

  getAiUsage: (limit = 50) =>
    safe(request<{ ok: boolean; history: AiUsageLog[]; config: AiConfig }>(`/ai/usage?limit=${limit}`), { ok: true, history: [], config: null as any }),

  // ── Hedge Funds / Smart Money ───────────────────────────────────────────────
  getHedgeFundManagers: () =>
    safe(request<any[]>('/hedge-funds/managers'), []),

  getHedgeFundChanges: (symbol?: string, limit = 50) =>
    safe(request<HedgeFundChange[]>(`/hedge-funds/changes?limit=${limit}${symbol ? `&symbol=${symbol}` : ''}`), []),

  getHedgeFundSymbol: (symbol: string) =>
    safe(request<HedgeFundHolding[]>(`/hedge-funds/symbol/${symbol}`), []),

  getHedgeFundOverlap: (minFunds = 3) =>
    safe(request<any[]>(`/hedge-funds/overlap?minFunds=${minFunds}`), []),

  getSmartMoneySummary: () =>
    safe(request<SmartMoneySummary>('/hedge-funds/smart-money'), { topBuys: [], topSells: [] }),

  refreshHedgeFunds: () =>
    safe(request('/hedge-funds/refresh', { method: 'POST' }), null),

  // ── Macro ───────────────────────────────────────────────────────────────────
  getMacroRegime: () =>
    safe(request<any>('/macro/regime'), null),

  getMacroIndicators: (limit = 30) =>
    safe(request<Record<string, Array<{ observationDate: string; value: number | null; fetchedAt: number }>>>(`/macro/indicators?limit=${limit}`), {}),

  getMacroPromptContext: () =>
    safe(request<{ context: string }>('/macro/prompt-context'), { context: '' }),

  // ── Sentiment ───────────────────────────────────────────────────────────────
  getOptionsFlow: () =>
    safe(request<any[]>('/sentiment/options'), []),

  getOptionsFlowBySymbol: (symbol: string) =>
    safe(request<any[]>(`/sentiment/options/${symbol}`), []),

  getShortInterest: () =>
    safe(request<any[]>('/sentiment/short-interest'), []),

  getSqueezeCandidates: () =>
    safe(request<any[]>('/sentiment/squeeze-candidates'), []),

  getMarketBreadth: (limit = 30) =>
    safe(request<Array<{ observation_date: string; advance_count: number | null; decline_count: number | null; ad_ratio: number | null; new_highs: number | null; new_lows: number | null; hl_ratio: number | null }>>(`/market-breadth?limit=${limit}`), []),

  // ── Autonomy / PM ──────────────────────────────────────────────────────────
  getAutonomyTheses: (symbol?: string, limit = 100, fresh = true) =>
    safe(request<AutonomyThesis[]>(`/autonomy/theses?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}${fresh ? '' : '&fresh=false'}`), []),

  getAutonomyDecisions: (symbol?: string, limit = 50) =>
    safe(request<AutonomyDecisionResponse>(`/autonomy/decisions?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`), {
      decisions: [],
      intents: [],
    }),

  getAutonomyForecasts: (limit = 100) =>
    safe(request<AutonomyForecastResponse>(`/autonomy/forecasts?limit=${limit}`), {
      eventForecasts: [],
      marketForecasts: [],
    }),

  getAutonomyLineage: (id: string) =>
    safe(request<AutonomyLineage>(`/autonomy/lineage/${id}`), {
      decision: null,
      theses: [],
      forecasts: [],
      trades: [],
    }),

  getAutonomyCalibration: () =>
    safe(request<AutonomyCalibrationResponse>('/autonomy/calibration'), {
      calibration: {
        bySource: [],
        overall: {
          totalResolved: 0,
          hitRate: null,
          brierScore: null,
        },
      },
      freshness: [],
    }),

  // ── Live Portfolio (server-side) ─────────────────────────────────────────────
  getLivePortfolio: () =>
    safe(request<{
      cash: number;
      positions: Array<{ symbol: string; shares: number; avgPrice: number }>;
      totalValue: number;
      prices: Record<string, number>;
      mode: string;
      degraded: boolean;
    }>('/portfolio/live'), null),

  getPortfolioExposures: () =>
    safe(request<any>('/portfolio/exposures'), null),

  getExecutionOrders: (limit = 100) =>
    safe(request<ExecutionAttempt[]>(`/execution/orders?limit=${limit}`), []),

  getExecutionHistory: (params?: {
    symbol?: string;
    status?: string;
    terminalPath?: string;
    retryBand?: string;
    degraded?: boolean;
    from?: number;
    to?: number;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.symbol) query.set('symbol', params.symbol);
    if (params?.status) query.set('status', params.status);
    if (params?.terminalPath) query.set('terminalPath', params.terminalPath);
    if (params?.retryBand) query.set('retryBand', params.retryBand);
    if (params?.degraded !== undefined) query.set('degraded', String(params.degraded));
    if (params?.from) query.set('from', String(params.from));
    if (params?.to) query.set('to', String(params.to));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    return safe(request<ExecutionHistoryResponse>(`/execution/history${query.toString() ? `?${query.toString()}` : ''}`), { total: 0, items: [] });
  },

  getExecutionQualitySummary: (limit = 200) =>
    safe(request<ExecutionQualitySummaryRow[]>(`/execution/quality-summary?limit=${limit}`), []),

  getExecutionApprovals: (limit = 50) =>
    safe(request<ExecutionAttempt[]>(`/execution/approvals?limit=${limit}`), []),

  approveExecution: (id: string) =>
    safe(request<any>(`/execution/approvals/${id}/approve`, { method: 'POST' }), null),

  rejectExecution: (id: string, reason = 'Rejected by operator') =>
    safe(request<any>(`/execution/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }), null),

  getResearchEvents: (limit = 100, symbol?: string) =>
    safe(request<ResearchEvent[]>(`/research/events?limit=${limit}${symbol ? `&symbol=${symbol}` : ''}`), []),

  getResearchFeed: (params?: {
    scope?: 'market' | 'sector' | 'stock';
    entity?: string;
    hoursBack?: 24 | 72 | 168;
    limit?: number;
    sentiment?: 'all' | 'bullish' | 'bearish' | 'neutral';
    sourceType?: 'all' | 'news' | 'filing' | 'insider' | 'hedge_fund' | 'options_flow' | 'short_interest';
    actionableOnly?: boolean;
    portfolioOnly?: boolean;
    freshOnly?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (params?.scope) query.set('scope', params.scope);
    if (params?.entity) query.set('entity', params.entity);
    if (params?.hoursBack) query.set('hoursBack', String(params.hoursBack));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sentiment) query.set('sentiment', params.sentiment);
    if (params?.sourceType) query.set('sourceType', params.sourceType);
    if (params?.actionableOnly) query.set('actionableOnly', 'true');
    if (params?.portfolioOnly) query.set('portfolioOnly', 'true');
    if (params?.freshOnly) query.set('freshOnly', 'true');
    return safe(request<ResearchFeedResponse>(`/research/feed${query.toString() ? `?${query.toString()}` : ''}`), {
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
    });
  },

  getThemes: () =>
    safe(request<ThemeListResponse>('/themes'), {
      overview: {
        updatedAt: Date.now(),
        lastRefreshAt: null,
        activeThemeCount: 0,
        stagedThemeCount: 0,
        archivedThemeCount: 0,
        discoveryCount: 0,
        averageExcessReturn: null,
        maxActiveThemes: 10,
        topThemeId: null,
        topThemeName: null,
      },
      themes: [],
      discoveries: [],
    }),

  getThemeDetail: (id: string) =>
    safe(request<ThemeDetailResponse>(`/themes/${encodeURIComponent(id)}`), {
      theme: null,
      sleeve: null,
      benchmark: null,
      brief: null,
      latestSnapshot: null,
      history: [],
      attribution: [],
      discoveries: [],
    }),

  getThemeHistory: (id: string, limit = 50) =>
    safe(request<ThemeSnapshot[]>(`/themes/${encodeURIComponent(id)}/history?limit=${limit}`), []),

  getThemeAttribution: (id: string, limit = 50) =>
    safe(request<ThemeAttribution[]>(`/themes/${encodeURIComponent(id)}/attribution?limit=${limit}`), []),

  getThemeDiscoveries: (themeId?: string) =>
    safe(request<ThemeDiscovery[]>(`/themes/discoveries${themeId ? `?themeId=${encodeURIComponent(themeId)}` : ''}`), []),

  refreshThemes: () =>
    safe(request<ThemeListResponse>('/themes/refresh', { method: 'POST' }), null),

  rebuildTheme: (id: string) =>
    safe(request<ThemeDetailResponse>(`/themes/${encodeURIComponent(id)}/rebuild`, { method: 'POST' }), null),

  getSignalCandidates: (limit = 50) =>
    safe(request<SignalCandidate[]>(`/signals/candidates?limit=${limit}`), []),

  getSystemHealth: () =>
    safe(request<{
      status: string;
      timestamp: number;
      mode: string;
      degraded: boolean;
      scheduler: Record<string, any>;
      marketSession: Record<string, any>;
      dataSources: DataSourceStatus[];
      brokerReconciliation: Record<string, any>;
      executionRecovery: Record<string, any>;
      degradation: DegradationStatus;
    }>('/system/health'), null),

  getDataFreshness: () =>
    safe(request<{ generatedAt: number; datasets: Record<string, number | null>; sources: DataSourceStatus[] }>('/data/freshness'), null),

  getDailyReport: () =>
    safe(request<DailyReport>('/reports/daily'), null),

  // Manual trade via backend (keeps server-side state in sync)
  manualTrade: (action: 'BUY' | 'SELL', symbol: string, shares: number, price: number) =>
    safe(request<{ ok: boolean }>('/portfolio/trade', {
      method: 'POST',
      body: JSON.stringify({ action, symbol, shares, price }),
    }), null),

  // ── Health ──────────────────────────────────────────────────────────────────
  health: () =>
    safe(request<{ status: string; timestamp: number }>('/health'), null as any),

  // ── News Articles ───────────────────────────────────────────────────────────
  saveNews: (articles: Array<{
    id?: string;
    title: string;
    url: string;
    source?: string;
    published_at?: number | null;
    relevant_symbols?: string[];
  }>) =>
    safe(request<{ saved: number }>('/news', {
      method: 'POST',
      body: JSON.stringify(articles),
    }), null),

  getUnprocessedNews: () =>
    safe(request<any[]>('/news/unprocessed'), []),

  getNews: (limit = 100) =>
    safe(request<StoredNewsArticle[]>(`/news?limit=${limit}`), []),

  refreshNews: () =>
    safe(request<{ ok: boolean; saved: number; total: number }>('/news/refresh', { method: 'POST' }), null),

  markNewsProcessed: (id: string, summary: string, sentiment: string) =>
    safe(request('/news/' + id + '/processed', {
      method: 'PUT',
      body: JSON.stringify({ summary, sentiment }),
    }), null),

  // ── Analyses ────────────────────────────────────────────────────────────────
  saveAnalysis: (data: {
    symbol: string;
    article_id?: string;
    action: string;
    confidence: number;
    reasoning: string;
    price_at_analysis?: number | null;
    technical_context?: Record<string, any>;
  }) =>
    safe(request<{ id: number }>('/analyses', {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  // Returns previous analyses for a symbol — used to build context for future Gemini prompts
  getAnalyses: (symbol: string, limit = 10) =>
    safe(request<any[]>(`/analyses/${symbol}?limit=${limit}`), []),

  // ── Signals ─────────────────────────────────────────────────────────────────
  saveSignal: (data: {
    symbol: string;
    signal_type: string;
    score: number;
    confidence: number;
    sources: string[];
    reasoning: string;
    expires_at?: number;
  }) =>
    safe(request<{ id: number }>('/signals', {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  // ── Trades ──────────────────────────────────────────────────────────────────
  saveTrade: (data: {
    id?: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    shares: number;
    price: number;
    total_value: number;
    entry_thesis?: string;
    exit_reason?: string;
    risk_check_passed?: boolean;
    portfolio_value_before?: number;
  }) =>
    safe(request('/trades', {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  getTrades: (symbol?: string) =>
    safe(request<TradeRecord[]>(`/trades${symbol ? '?symbol=' + symbol : ''}`), []),

  // ── Engine Logs ─────────────────────────────────────────────────────────────
  saveLogs: (logs: Array<{
    id: string;
    timestamp: number;
    type: string;
    asset?: string;
    content: string;
    action?: string;
    status?: string;
  }>) =>
    safe(request('/engine-logs', {
      method: 'POST',
      body: JSON.stringify(logs),
    }), null),

  getLogs: (limit = 200) =>
    safe(request<any[]>(`/engine-logs?limit=${limit}`), []),

  // ── Portfolio State ──────────────────────────────────────────────────────────
  savePortfolioState: (data: {
    cash: number;
    positions: any[];
    transactions: any[];
    total_value?: number;
  }) =>
    safe(request('/portfolio/state', {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  getPortfolioState: () =>
    safe(request<any>('/portfolio/state'), null),

  // ── Company Knowledge ────────────────────────────────────────────────────────
  // Accumulated AI knowledge per company — read before each analysis to provide context
  getKnowledge: (symbol: string) =>
    safe(request<any[]>(`/knowledge/${symbol}`), []),

  saveKnowledge: (symbol: string, data: {
    knowledge_type: string;
    content: string;
    confidence?: number;
  }) =>
    safe(request(`/knowledge/${symbol}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  // ── Fundamentals ────────────────────────────────────────────────────────────
  getFundamentals: (symbol: string) =>
    safe(request<FundamentalData>(`/fundamentals/${symbol}`), null),

  getFundamentalsAll: () =>
    safe(request<Record<string, FundamentalData>>('/fundamentals/all'), {}),

  refreshFundamentals: (symbol?: string) =>
    safe(request('/fundamentals/refresh', {
      method: 'POST',
      body: JSON.stringify(symbol ? { symbol } : {}),
    }), null),

  // ── Earnings ─────────────────────────────────────────────────────────────────
  getUpcomingEarnings: (days = 14) =>
    safe(request<EarningsEvent[]>(`/earnings/upcoming?days=${days}`), []),

  // ── Risk Engine ──────────────────────────────────────────────────────────────
  checkRisk: (data: {
    symbol: string;
    action: 'BUY' | 'SELL';
    shares: number;
    price: number;
    portfolio: { cash: number; positions: any[]; totalValue: number };
  }) =>
    safe(request<RiskCheckResult>('/risk/check', {
      method: 'POST',
      body: JSON.stringify(data),
    }), null),

  scanStopLoss: (positions: any[], currentPrices: Record<string, number>) =>
    safe(request<StopLossAlert[]>('/risk/stop-loss-scan', {
      method: 'POST',
      body: JSON.stringify({ positions, currentPrices }),
    }), []),

  getRiskEvents: (limit = 50) =>
    safe(request<RiskEventRecord[]>(`/risk/events?limit=${limit}`), []),

  // ── Technical Analysis ───────────────────────────────────────────────────────
  // Returns snapshots for all watchlist symbols — called once per Gemini analysis cycle
  getTechnicalAll: () =>
    safe(request<Record<string, TechnicalSnapshot | null>>('/technical/all'), {}),

  getTechnical: (symbol: string) =>
    safe(request<TechnicalSnapshot>(`/technical/${symbol}`), null),

  // Trigger a fresh OHLCV fetch (fire-and-forget on the backend side)
  refreshTechnicals: (symbol?: string) =>
    safe(request('/technical/refresh', {
      method: 'POST',
      body: JSON.stringify(symbol ? { symbol } : {}),
    }), null),

  // ── Analytics ───────────────────────────────────────────────────────────────
  getOverview: () =>
    safe(request<OverviewStats>('/analytics/overview'), null),

  getRecentInsiders: (days = 14, symbols?: string[]) =>
    safe(request<any[]>(`/insiders/recent?days=${days}${symbols && symbols.length > 0 ? `&symbol=${symbols.join(',')}` : ''}`), []),
};
