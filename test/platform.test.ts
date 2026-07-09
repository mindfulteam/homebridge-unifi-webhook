import type { PlatformAccessory } from 'homebridge';
import { beforeEach, describe, expect, it } from 'vitest';

import { UniFiWebhookPlatform } from '../src/platform.js';
import { PLUGIN_NAME } from '../src/settings.js';
import { asPlatformConfig, createMockLog, FakePlatformAccessory, MockHomebridgeApi } from './mocks/homebridgeApi.js';

const URL_A = 'https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/aaa111';
const URL_B = 'https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/bbb222';

function uuidFor(key: string): string {
  return `uuid:${PLUGIN_NAME}:${key}`;
}

describe('UniFiWebhookPlatform', () => {
  let api: MockHomebridgeApi;

  beforeEach(() => {
    api = new MockHomebridgeApi();
  });

  function launch(config: Record<string, unknown>): UniFiWebhookPlatform {
    const platform = new UniFiWebhookPlatform(createMockLog(), asPlatformConfig(config), api.asApi());
    api.emit('didFinishLaunching');
    return platform;
  }

  it('registers one switch accessory per configured button', () => {
    launch({ buttons: [{ name: 'Front Gate', url: URL_A }, { name: 'Siren', url: URL_B }] });

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    const [pluginName, platformName, accessories] = api.registerPlatformAccessories.mock.calls[0]!;
    expect(pluginName).toBe('homebridge-unifi-webhook');
    expect(platformName).toBe('UniFiWebhook');
    const accessory = (accessories as FakePlatformAccessory[])[0]!;
    expect(accessory.displayName).toBe('Front Gate');
    expect(accessory.UUID).toBe(uuidFor(URL_A));
    expect(accessory.category).toBe(8); // SWITCH
    expect(accessory.context).toEqual({ key: URL_A, schemaVersion: 1 });
    expect(accessory.getService('Switch')).toBeDefined();
  });

  it('keys accessory identity on the id when present, else the url', () => {
    launch({ buttons: [{ name: 'With Id', url: URL_A, id: 'my-anchor' }] });

    const accessory = api.registerPlatformAccessories.mock.calls[0]![2][0] as FakePlatformAccessory;
    expect(accessory.UUID).toBe(uuidFor('my-anchor'));
  });

  it('restores cached accessories instead of re-registering them', () => {
    const cached = new FakePlatformAccessory('Front Gate', uuidFor(URL_A));
    cached.context = { key: URL_A, schemaVersion: 1 };

    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ buttons: [{ name: 'Front Gate', url: URL_A }] }),
      api.asApi(),
    );
    platform.configureAccessory(cached as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).not.toHaveBeenCalled(); // nothing changed — no disk write
    expect(cached.getService('Switch')).toBeDefined(); // handler attached to the restored accessory
  });

  it('renames a cached accessory in place when only the name changed', () => {
    const cached = new FakePlatformAccessory('Old Name', uuidFor(URL_A));
    cached.context = { key: URL_A, schemaVersion: 1 };

    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ buttons: [{ name: 'New Name', url: URL_A }] }),
      api.asApi(),
    );
    platform.configureAccessory(cached as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(cached.displayName).toBe('New Name');
    expect(cached.UUID).toBe(uuidFor(URL_A)); // same accessory — rooms and automations survive
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).toHaveBeenCalledWith([cached]);
  });

  it('prunes cached accessories whose buttons were removed from the config', () => {
    const stale = new FakePlatformAccessory('Removed Button', uuidFor(URL_B));

    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ buttons: [{ name: 'Front Gate', url: URL_A }] }),
      api.asApi(),
    );
    platform.configureAccessory(stale as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      'homebridge-unifi-webhook',
      'UniFiWebhook',
      [stale],
    );
  });

  it('stays inert with an empty config but still prunes leftovers', () => {
    const stale = new FakePlatformAccessory('Leftover', uuidFor(URL_B));

    const platform = new UniFiWebhookPlatform(createMockLog(), asPlatformConfig({}), api.asApi());
    platform.configureAccessory(stale as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
  });

  it('registers duplicate identities only once', () => {
    launch({ buttons: [{ name: 'First', url: URL_A }, { name: 'Clone', url: URL_A }] });

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight webhooks on shutdown', () => {
    const platform = launch({ buttons: [{ name: 'Front Gate', url: URL_A }] });

    expect(platform.shutdownSignal.aborted).toBe(false);
    api.emit('shutdown');
    expect(platform.shutdownSignal.aborted).toBe(true);
  });
});
