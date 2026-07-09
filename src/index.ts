import type { API } from 'homebridge';

import { UniFiWebhookPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * Registers the platform with Homebridge. Importing this module has no other
 * side effects — with no platform block configured, the plugin stays inert.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, UniFiWebhookPlatform);
};
