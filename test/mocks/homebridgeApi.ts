import { EventEmitter } from 'node:events';

import type { API, Logging, PlatformConfig } from 'homebridge';
import { vi } from 'vitest';

export const SERVICE_TOKENS = {
  Switch: 'Switch',
  AccessoryInformation: 'AccessoryInformation',
  ContactSensor: 'ContactSensor',
  MotionSensor: 'MotionSensor',
  OccupancySensor: 'OccupancySensor',
} as const;

export const CHARACTERISTIC_TOKENS = {
  On: 'On',
  Name: 'Name',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
  FirmwareRevision: 'FirmwareRevision',
  ContactSensorState: 'ContactSensorState',
  MotionDetected: 'MotionDetected',
  OccupancyDetected: 'OccupancyDetected',
  StatusActive: 'StatusActive',
} as const;

export class FakeCharacteristic {
  getHandler: (() => unknown) | undefined;
  setHandler: ((value: unknown) => unknown) | undefined;

  onGet(handler: () => unknown): this {
    this.getHandler = handler;
    return this;
  }

  onSet(handler: (value: unknown) => unknown): this {
    this.setHandler = handler;
    return this;
  }
}

export class FakeService {
  readonly characteristics = new Map<string, FakeCharacteristic>();
  readonly setCharacteristic = vi.fn((_type: string, _value: unknown) => this);
  readonly updateCharacteristic = vi.fn((_type: string, _value: unknown) => this);

  constructor(readonly type: string) {}

  getCharacteristic(type: string): FakeCharacteristic {
    let characteristic = this.characteristics.get(type);
    if (!characteristic) {
      characteristic = new FakeCharacteristic();
      this.characteristics.set(type, characteristic);
    }
    return characteristic;
  }
}

export class FakePlatformAccessory extends EventEmitter {
  context: Record<string, unknown> = {};
  private readonly services = new Map<string, FakeService>();

  constructor(
    public displayName: string,
    readonly UUID: string,
    readonly category?: number,
  ) {
    super();
  }

  getService(type: string): FakeService | undefined {
    return this.services.get(type);
  }

  addService(type: string): FakeService {
    const service = new FakeService(type);
    this.services.set(type, service);
    return service;
  }

  removeService(service: FakeService): void {
    this.services.delete(service.type);
  }

  updateDisplayName(name: string): void {
    this.displayName = name;
  }
}

/**
 * Hand-rolled stand-in for the Homebridge API: an EventEmitter (for
 * didFinishLaunching / shutdown) plus spies for the accessory registry and
 * string tokens where hap-nodejs would provide classes. Deliberately does not
 * import hap-nodejs — these tests cover this plugin, not HAP.
 */
export class MockHomebridgeApi extends EventEmitter {
  readonly hap = {
    Service: SERVICE_TOKENS,
    Characteristic: CHARACTERISTIC_TOKENS,
    Categories: { SWITCH: 8, SENSOR: 10 },
    uuid: { generate: (seed: string): string => `uuid:${seed}` },
  };

  readonly platformAccessory = FakePlatformAccessory;
  readonly registerPlatformAccessories = vi.fn();
  readonly unregisterPlatformAccessories = vi.fn();
  readonly updatePlatformAccessories = vi.fn();

  asApi(): API {
    return this as unknown as API;
  }
}

export function createMockLog(): Logging {
  return Object.assign(vi.fn(), {
    prefix: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
  }) as unknown as Logging;
}

export function asPlatformConfig(overrides: Record<string, unknown>): PlatformConfig {
  return { platform: 'UniFiWebhook', ...overrides } as PlatformConfig;
}
