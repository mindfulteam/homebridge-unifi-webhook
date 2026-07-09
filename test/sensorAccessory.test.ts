import type { PlatformAccessory } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SensorConfig, SensorType } from '../src/config.js';
import type { UniFiWebhookPlatform } from '../src/platform.js';
import { SensorAccessory, type SensorAccessoryContext } from '../src/sensorAccessory.js';
import { FIRMWARE_REVISION } from '../src/settings.js';
import { CHARACTERISTIC_TOKENS, createMockLog, FakePlatformAccessory, SERVICE_TOKENS } from './mocks/homebridgeApi.js';

const SERVICE_BY_TYPE: Record<SensorType, string> = {
  contact: SERVICE_TOKENS.ContactSensor,
  motion: SERVICE_TOKENS.MotionSensor,
  occupancy: SERVICE_TOKENS.OccupancySensor,
};
const CHAR_BY_TYPE: Record<SensorType, string> = {
  contact: CHARACTERISTIC_TOKENS.ContactSensorState,
  motion: CHARACTERISTIC_TOKENS.MotionDetected,
  occupancy: CHARACTERISTIC_TOKENS.OccupancyDetected,
};
const ACTIVE_BY_TYPE: Record<SensorType, number | boolean> = { contact: 1, motion: true, occupancy: 1 };
const IDLE_BY_TYPE: Record<SensorType, number | boolean> = { contact: 0, motion: false, occupancy: 0 };

function sensorConfig(overrides: Partial<SensorConfig> = {}): SensorConfig {
  return { key: 'doorbell', name: 'Doorbell', sensorType: 'contact', token: 'tok', resetDelayMs: 5000, ...overrides };
}

function createHarness(sensor: SensorConfig = sensorConfig()) {
  const log = createMockLog();
  const platform = {
    log,
    Service: SERVICE_TOKENS,
    Characteristic: CHARACTERISTIC_TOKENS,
  } as unknown as UniFiWebhookPlatform;

  const accessory = new FakePlatformAccessory(sensor.name, 'uuid:test');
  const handler = new SensorAccessory(platform, accessory as unknown as PlatformAccessory<SensorAccessoryContext>, sensor);

  const service = accessory.getService(SERVICE_BY_TYPE[sensor.sensorType])!;
  const characteristic = service.getCharacteristic(CHAR_BY_TYPE[sensor.sensorType]);
  return {
    log,
    accessory,
    handler,
    service,
    readState: () => characteristic.getHandler!(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SensorAccessory', () => {
  it('sets accessory information including the plugin version as firmware', () => {
    const { accessory } = createHarness();
    const info = accessory.getService('AccessoryInformation')!;

    expect(info.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'homebridge-unifi-webhook');
    expect(info.setCharacteristic).toHaveBeenCalledWith('Model', 'UniFi Protect Webhook Sensor');
    expect(info.setCharacteristic).toHaveBeenCalledWith('FirmwareRevision', FIRMWARE_REVISION);
  });

  it('marks the sensor active and starts idle', () => {
    const { service, readState } = createHarness();

    expect(service.setCharacteristic).toHaveBeenCalledWith('StatusActive', true);
    expect(readState()).toBe(IDLE_BY_TYPE.contact);
  });

  it.each(['contact', 'motion', 'occupancy'] as const)(
    'pulses a %s sensor detected on trigger, then auto-resets after the delay',
    async (sensorType) => {
      const { handler, service, readState } = createHarness(sensorConfig({ sensorType }));

      handler.trigger();
      expect(readState()).toBe(ACTIVE_BY_TYPE[sensorType]);
      expect(service.updateCharacteristic).toHaveBeenCalledWith(CHAR_BY_TYPE[sensorType], ACTIVE_BY_TYPE[sensorType]);

      await vi.advanceTimersByTimeAsync(4999);
      expect(readState()).toBe(ACTIVE_BY_TYPE[sensorType]); // still within the window

      await vi.advanceTimersByTimeAsync(1);
      expect(service.updateCharacteristic).toHaveBeenCalledWith(CHAR_BY_TYPE[sensorType], IDLE_BY_TYPE[sensorType]);
      expect(readState()).toBe(IDLE_BY_TYPE[sensorType]);
    },
  );

  it('coalesces rapid re-triggers into one detection window that the latest trigger extends', async () => {
    const { handler, service } = createHarness();

    handler.trigger();
    await vi.advanceTimersByTimeAsync(100);
    handler.trigger();

    // Only the leading edge changes the characteristic — the second trigger is still "detected".
    const activeCalls = service.updateCharacteristic.mock.calls.filter(([, value]) => value === 1);
    expect(activeCalls).toHaveLength(1);

    // Reset is rescheduled from the second trigger (t=100), not the first.
    await vi.advanceTimersByTimeAsync(4999); // t = 5099, still armed
    expect(service.updateCharacteristic).not.toHaveBeenCalledWith('ContactSensorState', 0);
    await vi.advanceTimersByTimeAsync(1); // t = 5100
    expect(service.updateCharacteristic).toHaveBeenCalledWith('ContactSensorState', 0);
  });

  it('logs the source when one is supplied', () => {
    const { handler, log } = createHarness();

    handler.trigger('192.168.1.5 (alarm "Ring")');

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('from 192.168.1.5 (alarm "Ring")'));
  });

  it('clears the pending reset on dispose', async () => {
    const { handler, service } = createHarness();

    handler.trigger();
    handler.dispose();

    await vi.advanceTimersByTimeAsync(5000);
    expect(service.updateCharacteristic).not.toHaveBeenCalledWith('ContactSensorState', 0);
  });

  it('drops a stale sensor service when the type changes on a restored accessory', () => {
    const platform = {
      log: createMockLog(),
      Service: SERVICE_TOKENS,
      Characteristic: CHARACTERISTIC_TOKENS,
    } as unknown as UniFiWebhookPlatform;
    const accessory = new FakePlatformAccessory('Doorbell', 'uuid:test');

    // First launch: a contact sensor.
    new SensorAccessory(platform, accessory as unknown as PlatformAccessory<SensorAccessoryContext>, sensorConfig({ sensorType: 'contact' }));
    expect(accessory.getService('ContactSensor')).toBeDefined();

    // Config changed to motion: the contact service must be removed, motion added.
    new SensorAccessory(platform, accessory as unknown as PlatformAccessory<SensorAccessoryContext>, sensorConfig({ sensorType: 'motion' }));
    expect(accessory.getService('ContactSensor')).toBeUndefined();
    expect(accessory.getService('MotionSensor')).toBeDefined();
  });
});
