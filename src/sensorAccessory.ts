import type { Characteristic, PlatformAccessory, Service, WithUUID } from 'homebridge';

import type { SensorConfig } from './config.js';
import type { UniFiWebhookPlatform } from './platform.js';
import { FIRMWARE_REVISION } from './settings.js';

export interface SensorAccessoryContext {
  key: string;
  /**
   * The resolved secret path token (explicit or platform-generated). Persisted
   * so an auto-generated token survives restarts and the webhook URL stays stable.
   */
  token: string;
  tokenSource: 'auto' | 'explicit';
  sensorType: SensorConfig['sensorType'];
  schemaVersion: number;
}

// HomeKit fixed characteristic values (hap-nodejs). Hardcoded — not read off the
// live Characteristic classes — so the trigger logic stays unit-testable without
// instantiating HAP. These are stable by the HomeKit spec.
const CONTACT_CLOSED = 0; // ContactSensorState.CONTACT_DETECTED — the resting state
const CONTACT_OPEN = 1; // ContactSensorState.CONTACT_NOT_DETECTED — the momentary "triggered" state
const OCCUPANCY_CLEAR = 0; // OccupancyDetected.OCCUPANCY_NOT_DETECTED
const OCCUPANCY_PRESENT = 1; // OccupancyDetected.OCCUPANCY_DETECTED

type CharacteristicClass = WithUUID<new () => Characteristic>;

/**
 * One HomeKit sensor bound to one incoming webhook. A trigger pulses the sensor
 * into its "detected" state — so Apple Home automations that watch it fire — and
 * it auto-resets after the configured delay. Contact, motion, and occupancy are
 * all first-class automation triggers in the Home app; the type is per-sensor.
 */
export class SensorAccessory {
  private readonly service: Service;
  private readonly characteristic: CharacteristicClass;
  private readonly activeValue: number | boolean;
  private readonly idleValue: number | boolean;
  private readonly triggerVerb: string;
  private isDetected = false;
  private resetTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly platform: UniFiWebhookPlatform,
    accessory: PlatformAccessory<SensorAccessoryContext>,
    private readonly sensor: SensorConfig,
  ) {
    const { Service, Characteristic } = platform;

    const information = accessory.getService(Service.AccessoryInformation) ?? accessory.addService(Service.AccessoryInformation);
    information
      .setCharacteristic(Characteristic.Manufacturer, 'homebridge-unifi-webhook')
      .setCharacteristic(Characteristic.Model, 'UniFi Protect Webhook Sensor')
      .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.replace(/-/g, '').slice(0, 12).toUpperCase())
      .setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);

    switch (sensor.sensorType) {
      case 'motion':
        this.service = accessory.getService(Service.MotionSensor) ?? accessory.addService(Service.MotionSensor);
        this.characteristic = Characteristic.MotionDetected;
        this.activeValue = true;
        this.idleValue = false;
        this.triggerVerb = 'motion detected';
        break;
      case 'occupancy':
        this.service = accessory.getService(Service.OccupancySensor) ?? accessory.addService(Service.OccupancySensor);
        this.characteristic = Characteristic.OccupancyDetected;
        this.activeValue = OCCUPANCY_PRESENT;
        this.idleValue = OCCUPANCY_CLEAR;
        this.triggerVerb = 'occupancy detected';
        break;
      case 'contact':
      default:
        this.service = accessory.getService(Service.ContactSensor) ?? accessory.addService(Service.ContactSensor);
        this.characteristic = Characteristic.ContactSensorState;
        this.activeValue = CONTACT_OPEN;
        this.idleValue = CONTACT_CLOSED;
        this.triggerVerb = 'contact opened';
        break;
    }

    // If the sensor type changed since last launch, drop the now-stale service so
    // the accessory never accumulates one service per type it has ever been.
    for (const staleService of [Service.ContactSensor, Service.MotionSensor, Service.OccupancySensor]) {
      const existing = accessory.getService(staleService);
      if (existing && existing !== this.service) {
        accessory.removeService(existing);
      }
    }

    this.service.setCharacteristic(Characteristic.Name, sensor.name);
    this.service.setCharacteristic(Characteristic.StatusActive, true);
    this.service.getCharacteristic(this.characteristic).onGet(() => (this.isDetected ? this.activeValue : this.idleValue));

    accessory.on('identify', () => {
      this.platform.log.info(`Identify requested for "${this.sensor.name}"`);
    });
  }

  get name(): string {
    return this.sensor.name;
  }

  /**
   * Flips the sensor to "detected" and (re)schedules the auto-reset. Rapid
   * re-triggers coalesce: the characteristic only changes on the leading edge,
   * so HomeKit sees one detection window that the reset timer keeps extending.
   */
  trigger(source?: string): void {
    this.cancelReset();
    const wasIdle = !this.isDetected;
    this.isDetected = true;
    if (wasIdle) {
      this.service.updateCharacteristic(this.characteristic, this.activeValue);
    }
    const via = source ? ` from ${source}` : '';
    this.platform.log.info(
      `"${this.sensor.name}": webhook received${via} — ${this.triggerVerb}, resetting in ${this.sensor.resetDelayMs} ms`,
    );
    this.scheduleReset(this.sensor.resetDelayMs);
  }

  /** Called on Homebridge shutdown and before the accessory is discarded. */
  dispose(): void {
    this.cancelReset();
  }

  private scheduleReset(delayMs: number): void {
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      this.isDetected = false;
      this.service.updateCharacteristic(this.characteristic, this.idleValue);
    }, delayMs);
    // Never keep the process alive just to flip a sensor back to idle.
    this.resetTimer.unref();
  }

  private cancelReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
}
