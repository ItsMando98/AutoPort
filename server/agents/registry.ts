import { CoordinatorAgent } from './coordinator.js';
import { EarningsCalendarAgent } from './earningsCalendar.js';
import { ForecastEvaluatorAgent } from './forecastEvaluator.js';
import { ForwardEstimatesAgent } from './forwardEstimates.js';
import { HedgeFundAgent } from './hedgeFund.js';
import { KnowledgeAgent } from './knowledge.js';
import { MacroAgent } from './macro.js';
import { MarketBreadthAgent } from './marketBreadth.js';
import { ResearchIngestionAgent } from './researchIngestion.js';
import { ScreenerAgent } from './screener.js';
import { SentimentAgent } from './sentiment.js';
import { AssetDiscoveryAgent } from './assetDiscovery.js';
import { SleeveConstructionAgent } from './sleeveConstruction.js';
import { SleeveEvaluationAgent } from './sleeveEvaluation.js';
import { ThemeDiscoveryAgent } from './themeDiscovery.js';
import { ThemeResearchAgent } from './themeResearch.js';
import { type AgentStatus, BaseAgent } from './base.js';

export class AgentRegistry {
  private readonly agents = new Map<string, BaseAgent>();
  private readonly coordinator = new CoordinatorAgent();
  private readonly researchIngestion = new ResearchIngestionAgent();
  private readonly hedgeFund = new HedgeFundAgent();
  private readonly screener = new ScreenerAgent();
  private readonly macro = new MacroAgent();
  private readonly sentiment = new SentimentAgent();
  private readonly themeDiscovery = new ThemeDiscoveryAgent();
  private readonly assetDiscovery = new AssetDiscoveryAgent();
  private readonly themeResearch = new ThemeResearchAgent();
  private readonly sleeveConstruction = new SleeveConstructionAgent();
  private readonly sleeveEvaluation = new SleeveEvaluationAgent();
  private readonly knowledge = new KnowledgeAgent();
  private readonly earningsCalendar = new EarningsCalendarAgent();
  private readonly forwardEstimates = new ForwardEstimatesAgent();
  private readonly forecastEvaluator = new ForecastEvaluatorAgent();
  private readonly marketBreadth = new MarketBreadthAgent();

  constructor(autoload = true) {
    if (!autoload) return;
    [
      this.coordinator,
      this.researchIngestion,
      this.hedgeFund,
      this.screener,
      this.macro,
      this.sentiment,
      this.themeDiscovery,
      this.assetDiscovery,
      this.themeResearch,
      this.sleeveConstruction,
      this.sleeveEvaluation,
      this.knowledge,
      this.earningsCalendar,
      this.forwardEstimates,
      this.forecastEvaluator,
      this.marketBreadth,
    ].forEach(agent => this.register(agent));
  }

  register(agent: BaseAgent): void {
    this.agents.set(agent.name, agent);
  }

  startAll(): void {
    for (const agent of this.agents.values()) agent.start();
  }

  stopAll(): void {
    for (const agent of this.agents.values()) agent.stop();
  }

  start(name: string): void {
    this.require(name).start();
  }

  stop(name: string): void {
    this.require(name).stop();
  }

  async trigger(name: string): Promise<void> {
    await this.require(name).trigger('manual');
  }

  getAllStatuses(): AgentStatus[] {
    return [...this.agents.values()].map(agent => agent.getStatus());
  }

  getLogs(name: string, limit = 100): any[] {
    return this.require(name).getLogs(limit);
  }

  getCoordinatorStatus() {
    return this.coordinator.getCoordinatorStatus();
  }

  async runKnowledge(symbol?: string): Promise<void> {
    await this.knowledge.runForSymbol(symbol);
  }

  getAgent(name: string): BaseAgent {
    return this.require(name);
  }

  private require(name: string): BaseAgent {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`Unknown agent: ${name}`);
    return agent;
  }
}

export const registry = new AgentRegistry();

export function startAgent(): void {
  registry.start('coordinator');
}

export function stopAgent(): void {
  registry.stop('coordinator');
}

export function getStatus() {
  return registry.getCoordinatorStatus();
}

export function getLogs(limit = 100) {
  return registry.getLogs('coordinator', limit);
}
