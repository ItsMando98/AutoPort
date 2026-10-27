import { runThemeEvaluation } from '../themes.js';
import { BaseAgent } from './base.js';

export class SleeveEvaluationAgent extends BaseAgent {
  readonly name = 'sleeve_evaluation';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'theme_sleeve_evaluation';

  protected override get freshnessTtlMs(): number {
    return 12 * 60 * 60 * 1000;
  }

  protected override get dependencySourceKeys(): string[] {
    return ['theme_sleeve_construction'];
  }

  async run(): Promise<void> {
    const snapshots = await runThemeEvaluation({ useLivePrices: false });
    this.markSuccess(snapshots.length, { snapshots: snapshots.length });
  }
}
