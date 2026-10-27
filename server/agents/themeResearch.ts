import { runThemeResearch } from '../themes.js';
import { BaseAgent } from './base.js';

export class ThemeResearchAgent extends BaseAgent {
  readonly name = 'theme_research';
  readonly intervalMs = 12 * 60 * 60 * 1000;
  readonly sourceKey = 'theme_research_lab';

  protected override get freshnessTtlMs(): number {
    return 24 * 60 * 60 * 1000;
  }

  protected override get dependencySourceKeys(): string[] {
    return ['theme_asset_discovery'];
  }

  async run(): Promise<void> {
    const briefs = runThemeResearch();
    this.markSuccess(briefs.length, { briefs: briefs.length });
  }
}
