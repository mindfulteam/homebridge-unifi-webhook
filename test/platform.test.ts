import type { PlatformAccessory } from 'homebridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UniFiWebhookPlatform } from '../src/platform.js';
import { PLUGIN_NAME } from '../src/settings.js';
import type { WebhookServer } from '../src/webhookServer.js';
import { asPlatformConfig, createMockLog, FakePlatformAccessory, MockHomebridgeApi } from './mocks/homebridgeApi.js';

const URL_A = 'https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/aaa111';
const URL_B = 'https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/bbb222';

function uuidFor(key: string): string {
  return `uuid:${PLUGIN_NAME}:${key}`;
}

function sensorUuidFor(key: string): string {
  return `uuid:${PLUGIN_NAME}:sensor:${key}`;
}

function fakeServer(): WebhookServer {
  return { start: vi.fn(), stop: vi.fn(), address: vi.fn(() => undefined) } as unknown as WebhookServer;
}

describe('UniFiWebhookPlatform', () => {
  let api: MockHomebridgeApi;

  beforeEach(() => {
    api = new MockHomebridgeApi();
  });

  function launch(config: Record<string, unknown>, server?: WebhookServer): UniFiWebhookPlatform {
    const platform = new UniFiWebhookPlatform(createMockLog(), asPlatformConfig(config), api.asApi(), server);
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

  it('registers one sensor accessory per configured sensor', () => {
    launch({ sensors: [{ name: 'Doorbell', id: 'doorbell', sensorType: 'contact' }] }, fakeServer());

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    const accessory = api.registerPlatformAccessories.mock.calls[0]![2][0] as FakePlatformAccessory;
    expect(accessory.displayName).toBe('Doorbell');
    expect(accessory.UUID).toBe(sensorUuidFor('doorbell'));
    expect(accessory.category).toBe(10); // SENSOR
    expect(accessory.getService('ContactSensor')).toBeDefined();
    expect(accessory.context).toMatchObject({ key: 'doorbell', sensorType: 'contact', schemaVersion: 1 });
    expect(typeof (accessory.context as { token?: unknown }).token).toBe('string');
  });

  it('starts the listener with the sensor routes when sensors exist', () => {
    const server = fakeServer();
    launch({ port: 12345, sensors: [{ name: 'Doorbell', id: 'doorbell' }] }, server);

    expect(server.start).toHaveBeenCalledTimes(1);
    const options = vi.mocked(server.start).mock.calls[0]![0];
    expect(options.port).toBe(12345);
    expect(options.host).toBe('0.0.0.0');
    const accessory = api.registerPlatformAccessories.mock.calls[0]![2][0] as FakePlatformAccessory;
    const token = (accessory.context as { token: string }).token;
    expect(options.routes.get(token)).toBeDefined();
  });

  it('does not start the listener when only buttons are configured', () => {
    const server = fakeServer();
    launch({ buttons: [{ name: 'Gate', url: URL_A }] }, server);

    expect(server.start).not.toHaveBeenCalled();
  });

  it('reuses a persisted auto-generated token across restarts', () => {
    const cached = new FakePlatformAccessory('Doorbell', sensorUuidFor('doorbell'));
    cached.context = { key: 'doorbell', token: 'persisted-token', tokenSource: 'auto', sensorType: 'contact', schemaVersion: 1 };

    const server = fakeServer();
    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ sensors: [{ name: 'Doorbell', id: 'doorbell' }] }),
      api.asApi(),
      server,
    );
    platform.configureAccessory(cached as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(api.updatePlatformAccessories).not.toHaveBeenCalled(); // token unchanged — no disk write
    const options = vi.mocked(server.start).mock.calls[0]![0];
    expect(options.routes.get('persisted-token')).toBeDefined();
  });

  it('mints a fresh token when an explicit token is removed from config', () => {
    const cached = new FakePlatformAccessory('Doorbell', sensorUuidFor('doorbell'));
    cached.context = { key: 'doorbell', token: 'old-explicit', tokenSource: 'explicit', sensorType: 'contact', schemaVersion: 1 };

    const server = fakeServer();
    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ sensors: [{ name: 'Doorbell', id: 'doorbell' }] }), // token removed
      api.asApi(),
      server,
    );
    platform.configureAccessory(cached as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    const options = vi.mocked(server.start).mock.calls[0]![0];
    expect(options.routes.get('old-explicit')).toBeUndefined(); // the rotated-out secret no longer works
    expect(options.routes.size).toBe(1);
    expect(api.updatePlatformAccessories).toHaveBeenCalled();
    const newToken = (cached.context as { token: string }).token;
    expect(newToken).not.toBe('old-explicit');
    expect(options.routes.get(newToken)).toBeDefined();
  });

  it('does not collide a sensor with a button that shares the same key', () => {
    launch({
      buttons: [{ name: 'Gate', url: URL_A, id: 'shared' }],
      sensors: [{ name: 'Motion', id: 'shared', sensorType: 'motion' }],
    }, fakeServer());

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(2);
    const uuids = api.registerPlatformAccessories.mock.calls.map((c) => (c[2][0] as FakePlatformAccessory).UUID);
    expect(new Set(uuids).size).toBe(2);
    expect(uuids).toContain(uuidFor('shared'));
    expect(uuids).toContain(sensorUuidFor('shared'));
  });

  it('prunes a sensor accessory removed from the config', () => {
    const stale = new FakePlatformAccessory('Old Sensor', sensorUuidFor('gone'));
    stale.context = { key: 'gone', token: 't', sensorType: 'contact', schemaVersion: 1 };

    const platform = new UniFiWebhookPlatform(
      createMockLog(),
      asPlatformConfig({ sensors: [{ name: 'Keep', id: 'keep' }] }),
      api.asApi(),
      fakeServer(),
    );
    platform.configureAccessory(stale as unknown as PlatformAccessory);
    api.emit('didFinishLaunching');

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith('homebridge-unifi-webhook', 'UniFiWebhook', [stale]);
  });

  it('stops the listener on shutdown', () => {
    const server = fakeServer();
    launch({ sensors: [{ name: 'Doorbell', id: 'doorbell' }] }, server);

    api.emit('shutdown');
    expect(server.stop).toHaveBeenCalled();
  });
});
