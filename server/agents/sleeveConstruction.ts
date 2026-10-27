import { buildThemeSleeves } from '../themes.js';
import { BaseAgent } from './base.js';

export class SleeveConstructionAgent extends BaseAgent {
  readonly name = 'sleeve_construction';
  readonly intervalMs = 12 * 60 * 60 * 1000;
  readonly sourceKey = 'theme_sleeve_construction';

  protected override get freshnessTtlMs(): number {
    return 24 * 60 * 60 * 1000;
  }

  protected override get dependencySourceKeys(): string[] {
    return ['theme_research_lab'];
  }

  async run(): Promise<void> {
    const sleeves = buildThemeSleeves();
    this.markSuccess(sleeves.length, {
      sleeves: sleeves.length,
      active: sleeves.filter(item => item.status === 'active').length,
    });
  }
}
