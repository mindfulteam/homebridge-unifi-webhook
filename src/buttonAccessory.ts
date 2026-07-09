import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ButtonConfig } from './config.js';
import type { UniFiWebhookPlatform } from './platform.js';
import type { WebhookResult } from './webhookClient.js';
import { redactUrl } from './redact.js';
import { FIRMWARE_REVISION } from './settings.js';

export interface ButtonAccessoryContext {
  key: string;
  schemaVersion: number;
}

/**
 * How quickly a failed trigger snaps the switch back off. Non-zero so the
 * snap-back lands after HAP has finished applying the "on" write, and the
 * bounce is visible enough in the Home app to read as "that didn't work".
 */
const FAILURE_RESET_DELAY_MS = 300;

/**
 * One momentary HomeKit switch bound to one webhook. Turning it on fires the
 * webhook and the switch flips back off after the configured reset delay —
 * there is normally no "off" request, because an alarm trigger cannot be
 * un-fired. The one exception is a double-press button, whose confirming second
 * press is itself the "off" toggle.
 */
export class ButtonAccessory {
  private readonly service: Service;
  private isOn = false;
  private inFlight = false;
  private resetTimer: NodeJS.Timeout | undefined;
  private armed = false;
  private armTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly platform: UniFiWebhookPlatform,
    accessory: PlatformAccessory<ButtonAccessoryContext>,
    private readonly button: ButtonConfig,
  ) {
    const { Service, Characteristic } = platform;

    const information = accessory.getService(Service.AccessoryInformation) ?? accessory.addService(Service.AccessoryInformation);
    information
      .setCharacteristic(Characteristic.Manufacturer, 'homebridge-unifi-webhook')
      .setCharacteristic(Characteristic.Model, 'UniFi Protect Webhook Button')
      .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.replace(/-/g, '').slice(0, 12).toUpperCase())
      .setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);

    this.service = accessory.getService(Service.Switch) ?? accessory.addService(Service.Switch);
    this.service.setCharacteristic(Characteristic.Name, button.name);
    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => this.isOn)
      .onSet((value) => this.handleSet(value));

    accessory.on('identify', () => {
      this.platform.log.info(`Identify requested for "${this.button.name}"`);
    });
  }

  /** Called on Homebridge shutdown and before the accessory is discarded. */
  dispose(): void {
    this.cancelReset();
    this.cancelArm();
  }

  private handleSet(value: CharacteristicValue): void {
    if (value) {
      this.handleOn();
    } else {
      this.handleOff();
    }
  }

  /**
   * A HomeKit Switch is a toggle, so pressing the tile twice is naturally an
   * "on" then an "off". A single-press button fires on the "on". A double-press
   * button instead uses the "on" to arm — holding the switch on as the armed
   * indicator — and fires only on the confirming "off". Firing therefore always
   * needs a deliberate second press, and a scene, automation, or Siri command
   * that only ever switches the button on can arm it but never fire it.
   */
  private handleOn(): void {
    if (this.inFlight) {
      this.platform.log.debug(`"${this.button.name}": trigger already in flight — ignoring`);
      return;
    }
    if (this.button.requireDoublePress) {
      if (this.armed) {
        this.platform.log.debug(`"${this.button.name}": already armed — waiting for the confirming press`);
      } else {
        this.arm();
      }
      return;
    }
    this.isOn = true;
    this.dispatch();
  }

  private handleOff(): void {
    if (this.armed) {
      this.cancelArm();
      this.isOn = false;
      this.dispatch();
      return;
    }
    // Manual off before the reset fired: honor it, skip the pending reset. An
    // in-flight request is not aborted — the webhook may already have been
    // delivered, and a HomeKit "off" cannot undo it.
    this.cancelReset();
    this.isOn = false;
  }

  private dispatch(): void {
    this.cancelReset();
    if (!this.button.url) {
      this.platform.log.error(
        `Cannot trigger "${this.button.name}": its webhook url is missing or invalid. Fix it in the plugin settings.`,
      );
      this.scheduleReset(FAILURE_RESET_DELAY_MS);
      return;
    }

    this.inFlight = true;
    void this.fire(this.button.url);
  }

  private async fire(url: URL): Promise<void> {
    const { log, config } = this.platform;
    try {
      const result = await this.platform.client.send({
        url,
        method: this.button.method,
        apiKey: this.button.apiKey,
        timeoutMs: config.timeoutMs,
        allowSelfSigned: config.allowSelfSigned,
        signal: this.platform.shutdownSignal,
      });

      if (result.ok) {
        log.info(`"${this.button.name}" webhook fired (HTTP ${result.status}, ${result.durationMs} ms)`);
        this.scheduleReset(config.resetDelayMs);
      } else if (result.reason === 'aborted') {
        log.debug(`"${this.button.name}" webhook aborted (shutting down)`);
        this.scheduleReset(FAILURE_RESET_DELAY_MS);
      } else {
        log.error(
          `"${this.button.name}" webhook failed: ${result.message} — ${hintFor(result)} ` +
          `[${this.button.method} ${redactUrl(url)}]`,
        );
        this.scheduleReset(FAILURE_RESET_DELAY_MS);
      }
    } catch (error) {
      // client.send never rejects by contract; this is pure belt-and-braces
      // so a bug can never surface as an unhandled rejection.
      log.error(`"${this.button.name}" webhook failed unexpectedly: ${String(error)}`);
      this.scheduleReset(FAILURE_RESET_DELAY_MS);
    } finally {
      this.inFlight = false;
    }
  }

  private scheduleReset(delayMs: number): void {
    this.cancelReset();
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      this.isOn = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }, delayMs);
    // Never keep the process alive just to flip a tile back off.
    this.resetTimer.unref();
  }

  private cancelReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  private arm(): void {
    this.armed = true;
    this.isOn = true;
    this.platform.log.info(
      `"${this.button.name}": armed — press again within ${this.button.doublePressWindowMs / 1000}s to fire (double-press confirmation)`,
    );
    this.armTimer = setTimeout(() => {
      this.armTimer = undefined;
      this.armed = false;
      this.isOn = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      this.platform.log.debug(`"${this.button.name}": confirmation window elapsed — webhook not fired`);
    }, this.button.doublePressWindowMs);
    // Never keep the process alive just to lapse an unconfirmed arm.
    this.armTimer.unref();
  }

  private cancelArm(): void {
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = undefined;
    }
    this.armed = false;
  }
}

function hintFor(result: Extract<WebhookResult, { ok: false }>): string {
  if (result.status === 401 || result.status === 403) {
    return 'check your UniFi API key';
  }
  if (result.status === 404) {
    return 'check the webhook url — the alarm may have been deleted or recreated';
  }
  if (result.reason === 'timeout') {
    return 'the console did not respond — check the host/IP and that the console is reachable';
  }
  if (result.reason === 'network' && /CERT|certificate|SSL|TLS/i.test(result.message)) {
    return 'the console certificate was rejected — enable "Allow self-signed certificates"';
  }
  if (result.reason === 'network') {
    return 'is the console address correct and reachable?';
  }
  return 'see the message above';
}
