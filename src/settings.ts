import { createRequire } from 'node:module';

/**
 * The platform name users put in the `platform` field of their config.json.
 * Must match `pluginAlias` in config.schema.json.
 */
export const PLATFORM_NAME = 'UniFiWebhook';

/**
 * Must match the `name` property in package.json.
 */
export const PLUGIN_NAME = 'homebridge-unifi-webhook';

const nodeRequire = createRequire(import.meta.url);

/**
 * Plugin version surfaced as the accessories' FirmwareRevision. Resolved from
 * package.json at runtime so it can never drift from the published version.
 */
export const PLUGIN_VERSION: string = (nodeRequire('../package.json') as { version: string }).version;
