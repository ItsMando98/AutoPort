import { runThemeDiscovery } from '../themes.js';
import { BaseAgent } from './base.js';

export class ThemeDiscoveryAgent extends BaseAgent {
  readonly name = 'theme_discovery';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'theme_discovery_lab';

  protected override get freshnessTtlMs(): number {
    return 12 * 60 * 60 * 1000;
  }

  async run(): Promise<void> {
    const discoveries = runThemeDiscovery();
    this.markSuccess(discoveries.length, {
      discoveries: discoveries.length,
      validated: discoveries.filter(item => item.status === 'validated' || item.status === 'published').length,
    });
  }
}
