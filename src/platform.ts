import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';

import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ButtonAccessory, type ButtonAccessoryContext } from './buttonAccessory.js';
import { validateConfig, type ResolvedPlatformConfig, type SensorConfig } from './config.js';
import { SensorAccessory, type SensorAccessoryContext } from './sensorAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { WebhookClient } from './webhookClient.js';
import { PATH_PREFIX, WebhookServer } from './webhookServer.js';

const CONTEXT_SCHEMA_VERSION = 1;

/** Anything the platform holds onto and must tear down on shutdown. */
interface Disposable {
  dispose(): void;
}

/**
 * Dynamic platform. Two directions, one config:
 *  - `buttons` → momentary Switch accessories that fire an outgoing UniFi webhook.
 *  - `sensors` → Contact/Motion/Occupancy accessories driven by an incoming
 *    webhook the UniFi Alarm Manager posts to this plugin's HTTP listener.
 * config.json is the single source of truth — on every launch the cached
 * accessories are reconciled against it (create / rename / prune).
 */
export class UniFiWebhookPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: ResolvedPlatformConfig;
  public readonly client: WebhookClient;

  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly handlers: Disposable[] = [];
  private readonly routes = new Map<string, SensorAccessory>();
  private readonly webhookServer: WebhookServer;
  private readonly shutdownController = new AbortController();

  constructor(
    public readonly log: Logging,
    platformConfig: PlatformConfig,
    private readonly api: API,
    // Injectable for tests; Homebridge only ever passes the first three arguments.
    webhookServer?: WebhookServer,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.client = new WebhookClient();
    this.webhookServer = webhookServer ?? new WebhookServer(log);
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
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private syncAccessories(): void {
    if (this.config.buttons.length === 0 && this.config.sensors.length === 0) {
      this.log.info('Nothing configured yet — add buttons and/or sensors in the plugin settings.');
    }

    const activeUuids = new Set<string>();
    this.syncButtons(activeUuids);
    this.syncSensors(activeUuids);

    for (const [uuid, accessory] of this.cachedAccessories) {
      if (!activeUuids.has(uuid)) {
        this.log.info(`Removing "${accessory.displayName}" — it is no longer in the config`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.delete(uuid);
      }
    }

    if (this.routes.size > 0) {
      this.webhookServer.start({
        port: this.config.port,
        host: this.config.bindHost,
        routes: this.routes,
        secret: this.config.webhookSecret,
      });
      if (this.config.webhookSecret !== undefined) {
        this.log.info(
          'Incoming webhooks also require a secret header — add either "Authorization: Bearer <your secret>" or ' +
          '"X-Webhook-Token: <your secret>" under the UniFi webhook action\'s custom headers.',
        );
      }
    }
  }

  private syncButtons(activeUuids: Set<string>): void {
    for (const button of this.config.buttons) {
      // The identity seed deliberately excludes the name so buttons can be
      // renamed without HomeKit treating them as new accessories.
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${button.key}`);
      activeUuids.add(uuid);

      const cached = this.cachedAccessories.get(uuid);
      if (cached) {
        const renamed = cached.displayName !== button.name;
        const context = cached.context as Partial<ButtonAccessoryContext>;
        const contextStale = context?.key !== button.key || context?.schemaVersion !== CONTEXT_SCHEMA_VERSION;
        if (renamed) {
          this.log.info(`Renaming "${cached.displayName}" to "${button.name}"`);
          cached.updateDisplayName(button.name);
        }
        if (contextStale) {
          cached.context = { key: button.key, schemaVersion: CONTEXT_SCHEMA_VERSION } satisfies ButtonAccessoryContext;
        }
        this.handlers.push(new ButtonAccessory(this, cached as PlatformAccessory<ButtonAccessoryContext>, button));
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
  }

  private syncSensors(activeUuids: Set<string>): void {
    for (const sensor of this.config.sensors) {
      // Namespaced so a sensor can never collide with a button that happens to
      // share the same key string; identity still excludes the name.
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:sensor:${sensor.key}`);
      activeUuids.add(uuid);

      const cached = this.cachedAccessories.get(uuid);
      const token = this.resolveToken(sensor, cached);

      let accessory: PlatformAccessory<SensorAccessoryContext>;
      if (cached) {
        accessory = cached as PlatformAccessory<SensorAccessoryContext>;
        const renamed = accessory.displayName !== sensor.name;
        const context = accessory.context as Partial<SensorAccessoryContext>;
        const contextStale =
          context?.key !== sensor.key ||
          context?.token !== token ||
          context?.sensorType !== sensor.sensorType ||
          context?.schemaVersion !== CONTEXT_SCHEMA_VERSION;
        if (renamed) {
          this.log.info(`Renaming "${accessory.displayName}" to "${sensor.name}"`);
          accessory.updateDisplayName(sensor.name);
        }
        if (contextStale) {
          accessory.context = { key: sensor.key, token, sensorType: sensor.sensorType, schemaVersion: CONTEXT_SCHEMA_VERSION };
        }
        const handler = new SensorAccessory(this, accessory, sensor);
        this.handlers.push(handler);
        this.routes.set(token, handler);
        if (renamed || contextStale) {
          this.api.updatePlatformAccessories([accessory]);
        }
      } else {
        this.log.info(`Adding sensor "${sensor.name}"`);
        accessory = new this.api.platformAccessory<SensorAccessoryContext>(
          sensor.name,
          uuid,
          this.api.hap.Categories.SENSOR,
        );
        accessory.context = { key: sensor.key, token, sensorType: sensor.sensorType, schemaVersion: CONTEXT_SCHEMA_VERSION };
        const handler = new SensorAccessory(this, accessory, sensor);
        this.handlers.push(handler);
        this.routes.set(token, handler);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.announceSensorUrl(sensor, token);
    }
  }

  /**
   * Resolves the sensor's secret token: an explicit config token wins; otherwise
   * the previously generated one persisted in the accessory context is reused;
   * otherwise a fresh high-entropy token is minted (first launch).
   */
  private resolveToken(sensor: SensorConfig, cached: PlatformAccessory | undefined): string {
    if (sensor.token !== undefined) {
      return sensor.token;
    }
    const persisted = (cached?.context as Partial<SensorAccessoryContext> | undefined)?.token;
    if (typeof persisted === 'string' && persisted.length > 0) {
      return persisted;
    }
    return randomBytes(24).toString('base64url');
  }

  /** Logs the ready-to-paste webhook URL once at startup (the sanctioned secret surface). */
  private announceSensorUrl(sensor: SensorConfig, token: string): void {
    const host = displayHost(this.config.bindHost);
    const url = `http://${host}:${this.config.port}${PATH_PREFIX}${token}`;
    this.log.info(`Sensor "${sensor.name}" (${sensor.sensorType}) — paste into the UniFi Alarm Manager webhook action: ${url}`);
  }

  private dispose(): void {
    this.log.debug('Shutting down — stopping the listener, aborting in-flight webhooks, and clearing timers');
    this.webhookServer.stop();
    this.shutdownController.abort();
    for (const handler of this.handlers) {
      handler.dispose();
    }
  }
}

/**
 * A pasteable host for the webhook URL. When bound to all interfaces we can't
 * know which IP the console will use, so surface the first non-internal IPv4 as
 * a best guess; the user can always substitute their console-reachable address.
 */
function displayHost(bindHost: string): string {
  if (bindHost !== '0.0.0.0' && bindHost !== '::') {
    return bindHost;
  }
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return '<homebridge-ip>';
}
