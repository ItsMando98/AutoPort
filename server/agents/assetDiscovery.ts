import { runAssetDiscovery } from '../themes.js';
import { BaseAgent } from './base.js';

export class AssetDiscoveryAgent extends BaseAgent {
  readonly name = 'asset_discovery';
  readonly intervalMs = 6 * 60 * 60 * 1000;
  readonly sourceKey = 'theme_asset_discovery';

  protected override get freshnessTtlMs(): number {
    return 12 * 60 * 60 * 1000;
  }

  protected override get dependencySourceKeys(): string[] {
    return ['theme_discovery_lab'];
  }

  async run(): Promise<void> {
    const discoveries = runAssetDiscovery();
    this.markSuccess(discoveries.length, {
      discoveries: discoveries.length,
      publishedReady: discoveries.filter(item => item.validatedAssetCount >= 3).length,
    });
  }
}
