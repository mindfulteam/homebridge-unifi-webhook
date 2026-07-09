import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ButtonAccessory, type ButtonAccessoryContext } from './buttonAccessory.js';
import { validateConfig, type ResolvedPlatformConfig } from './config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { WebhookClient } from './webhookClient.js';

const CONTEXT_SCHEMA_VERSION = 1;

/**
 * Dynamic platform: one momentary Switch accessory per configured button.
 * config.json is the single source of truth — on every launch the cached
 * accessories are reconciled against it (create / rename / prune).
 */
export class UniFiWebhookPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: ResolvedPlatformConfig;
  public readonly client: WebhookClient;

  private readonly cachedAccessories = new Map<string, PlatformAccessory<ButtonAccessoryContext>>();
  private readonly handlers: ButtonAccessory[] = [];
  private readonly shutdownController = new AbortController();

  constructor(
    public readonly log: Logging,
    platformConfig: PlatformConfig,
    private readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.client = new WebhookClient();
    this.config = validateConfig(platformConfig, log);

    // Accessories may only be registered after Homebridge has restored the
    // cached ones, otherwise every start would create duplicates.
    api.on('didFinishLaunching', () => this.syncAccessories());
    api.on('shutdown', () => this.dispose());
  }

  /** Aborts in-flight webhook requests when Homebridge shuts down. */
  get shutdownSignal(): AbortSignal {
    return this.shutdownController.signal;
  }

  /** Called by Homebridge once for every accessory restored from disk. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring accessory from cache: ${accessory.displayName}`);
    this.cachedAccessories.set(accessory.UUID, accessory as PlatformAccessory<ButtonAccessoryContext>);
  }

  private syncAccessories(): void {
    if (this.config.buttons.length === 0) {
      this.log.info('No buttons configured — add buttons in the plugin settings to create HomeKit switches.');
    }

    const activeUuids = new Set<string>();
    for (const button of this.config.buttons) {
      // The identity seed deliberately excludes the name so buttons can be
      // renamed without HomeKit treating them as new accessories.
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${button.key}`);
      activeUuids.add(uuid);

      const cached = this.cachedAccessories.get(uuid);
      if (cached) {
        const renamed = cached.displayName !== button.name;
        const contextStale =
          cached.context?.key !== button.key ||
          cached.context?.schemaVersion !== CONTEXT_SCHEMA_VERSION;
        if (renamed) {
          this.log.info(`Renaming "${cached.displayName}" to "${button.name}"`);
          cached.updateDisplayName(button.name);
        }
        if (contextStale) {
          cached.context = { key: button.key, schemaVersion: CONTEXT_SCHEMA_VERSION };
        }
        this.handlers.push(new ButtonAccessory(this, cached, button));
        if (renamed || contextStale) {
          this.api.updatePlatformAccessories([cached]);
        }
      } else {
        this.log.info(`Adding button "${button.name}"`);
        const accessory = new this.api.platformAccessory<ButtonAccessoryContext>(
          button.name,
          uuid,
          this.api.hap.Categories.SWITCH,
        );
        accessory.context = { key: button.key, schemaVersion: CONTEXT_SCHEMA_VERSION };
        this.handlers.push(new ButtonAccessory(this, accessory, button));
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!activeUuids.has(uuid)) {
        this.log.info(`Removing button "${accessory.displayName}" — it is no longer in the config`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }
  }

  private dispose(): void {
    this.log.debug('Shutting down — aborting in-flight webhooks and clearing timers');
    this.shutdownController.abort();
    for (const handler of this.handlers) {
      handler.dispose();
    }
  }
}
