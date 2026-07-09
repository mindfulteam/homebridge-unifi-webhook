import type { Logging, PlatformAccessory } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ButtonAccessory, type ButtonAccessoryContext } from '../src/buttonAccessory.js';
import type { ButtonConfig } from '../src/config.js';
import type { UniFiWebhookPlatform } from '../src/platform.js';
import type { WebhookRequestSpec, WebhookResult } from '../src/webhookClient.js';
import { FIRMWARE_REVISION } from '../src/settings.js';
import { CHARACTERISTIC_TOKENS, createMockLog, FakePlatformAccessory, SERVICE_TOKENS } from './mocks/homebridgeApi.js';

const BUTTON: ButtonConfig = {
  key: 'https://console/hook/abcdef123456',
  name: 'Front Gate',
  url: new URL('https://console/hook/abcdef123456'),
  method: 'POST',
  apiKey: 'super-secret-key',
  requireDoublePress: false,
  doublePressWindowMs: 3000,
};

interface Harness {
  log: Logging;
  send: ReturnType<typeof vi.fn>;
  resolveSend: (result: WebhookResult) => void;
  accessory: FakePlatformAccessory;
  handler: ButtonAccessory;
  pressOn: () => unknown;
  pressOff: () => unknown;
  readState: () => unknown;
  switchService: ReturnType<FakePlatformAccessory['addService']>;
}

function createHarness(button: ButtonConfig = BUTTON): Harness {
  const log = createMockLog();
  let resolveSend: (result: WebhookResult) => void = () => {};
  const send = vi.fn((_spec: WebhookRequestSpec) => new Promise<WebhookResult>((resolve) => {
    resolveSend = resolve;
  }));

  const platform = {
    log,
    Service: SERVICE_TOKENS,
    Characteristic: CHARACTERISTIC_TOKENS,
    config: { buttons: [button], allowSelfSigned: true, timeoutMs: 5000, resetDelayMs: 1000 },
    client: { send },
    shutdownSignal: new AbortController().signal,
  } as unknown as UniFiWebhookPlatform;

  const accessory = new FakePlatformAccessory(button.name, 'uuid:test');
  const handler = new ButtonAccessory(platform, accessory as unknown as PlatformAccessory<ButtonAccessoryContext>, button);

  const switchService = accessory.getService('Switch')!;
  const on = switchService.getCharacteristic('On');
  return {
    log,
    send,
    resolveSend: (result) => resolveSend(result),
    accessory,
    handler,
    pressOn: () => on.setHandler!(true),
    pressOff: () => on.setHandler!(false),
    readState: () => on.getHandler!(),
    switchService,
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ButtonAccessory', () => {
  it('sets accessory information including the plugin version as firmware', () => {
    const { accessory } = createHarness();
    const info = accessory.getService('AccessoryInformation')!;

    expect(info.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'homebridge-unifi-webhook');
    expect(info.setCharacteristic).toHaveBeenCalledWith('Model', 'UniFi Protect Webhook Button');
    expect(info.setCharacteristic).toHaveBeenCalledWith('FirmwareRevision', FIRMWARE_REVISION);
  });

  it('fires the webhook with the full request spec when switched on', () => {
    const { send, pressOn } = createHarness();

    pressOn();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      url: BUTTON.url,
      method: 'POST',
      apiKey: 'super-secret-key',
      timeoutMs: 5000,
      allowSelfSigned: true,
    });
  });

  it('stays on for the reset delay after success, then flips off', async () => {
    const { pressOn, resolveSend, readState, switchService } = createHarness();

    pressOn();
    expect(readState()).toBe(true);

    resolveSend({ ok: true, status: 204, durationMs: 12 });
    await flush();

    await vi.advanceTimersByTimeAsync(999);
    expect(switchService.updateCharacteristic).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false);
    expect(readState()).toBe(false);
  });

  it('ignores re-triggers while a request is in flight', () => {
    const { send, pressOn } = createHarness();

    pressOn();
    pressOn();
    pressOn();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('allows an intentional re-fire after the previous cycle completed', async () => {
    const { send, pressOn, resolveSend } = createHarness();

    pressOn();
    resolveSend({ ok: true, status: 204, durationMs: 5 });
    await vi.advanceTimersByTimeAsync(1000);

    pressOn();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('snaps off quickly and logs a hint when the webhook fails', async () => {
    const { pressOn, resolveSend, switchService, log } = createHarness();

    pressOn();
    resolveSend({ ok: false, reason: 'http-status', status: 401, message: 'HTTP 401 Unauthorized' });
    await flush();

    await vi.advanceTimersByTimeAsync(300);
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false);

    const errorLine = (log.error as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(errorLine).toContain('check your UniFi API key');
    expect(errorLine).toContain('abcd***');          // url is redacted…
    expect(errorLine).not.toContain('abcdef123456'); // …the webhook id never appears
    expect(errorLine).not.toContain('super-secret-key');
  });

  it('honors a manual off before the reset delay elapses', async () => {
    const { pressOn, pressOff, resolveSend, readState, switchService } = createHarness();

    pressOn();
    resolveSend({ ok: true, status: 204, durationMs: 5 });
    await flush();

    pressOff();
    expect(readState()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(switchService.updateCharacteristic).not.toHaveBeenCalled(); // cancelled reset never fires
  });

  it('fails loudly without a request when the button url is misconfigured', async () => {
    const { send, pressOn, log, switchService } = createHarness({ ...BUTTON, url: undefined });

    pressOn();

    expect(send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('missing or invalid'));
    await vi.advanceTimersByTimeAsync(300);
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('logs aborted requests quietly during shutdown', async () => {
    const { pressOn, resolveSend, log } = createHarness();

    pressOn();
    resolveSend({ ok: false, reason: 'aborted', message: 'request aborted' });
    await flush();

    expect(log.error).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('aborted'));
  });

  it('clears pending timers on dispose', async () => {
    const { pressOn, resolveSend, handler, switchService } = createHarness();

    pressOn();
    resolveSend({ ok: true, status: 204, durationMs: 5 });
    await flush();

    handler.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(switchService.updateCharacteristic).not.toHaveBeenCalled();
  });
});

describe('ButtonAccessory — double-press confirmation', () => {
  const DOUBLE: ButtonConfig = { ...BUTTON, requireDoublePress: true, doublePressWindowMs: 3000 };

  it('arms on the first press without firing, holding the switch on', () => {
    const { send, pressOn, readState, log } = createHarness(DOUBLE);

    pressOn();

    expect(send).not.toHaveBeenCalled();
    expect(readState()).toBe(true); // stays on as the armed indicator
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('armed'));
  });

  it('fires when the armed switch is pressed again (toggled off) within the window', () => {
    const { send, pressOn, pressOff } = createHarness(DOUBLE);

    pressOn();  // arm
    pressOff(); // confirming second press — a real controller sends On=false here

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fires on a rapid second press — no dependence on tap timing', async () => {
    const { send, pressOn, pressOff } = createHarness(DOUBLE);

    pressOn();
    await vi.advanceTimersByTimeAsync(50);
    pressOff();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('disarms and resets the switch when not confirmed within the window', async () => {
    const { send, pressOn, readState, switchService, log } = createHarness(DOUBLE);

    pressOn();
    await vi.advanceTimersByTimeAsync(3000);

    expect(send).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('window elapsed'));
    expect(switchService.updateCharacteristic).toHaveBeenCalledWith('On', false);
    expect(readState()).toBe(false);
  });

  it('does not fire on a repeated on-press while armed (redundant activation)', async () => {
    const { send, pressOn } = createHarness(DOUBLE);

    pressOn(); // arm
    pressOn(); // e.g. a scene or automation re-issuing "on"

    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(send).not.toHaveBeenCalled();
  });

  it('clears the arm timer on dispose', async () => {
    const { pressOn, handler, log } = createHarness(DOUBLE);

    pressOn();
    handler.dispose();

    await vi.advanceTimersByTimeAsync(3000);
    expect(log.debug).not.toHaveBeenCalledWith(expect.stringContaining('window elapsed'));
  });

  it('re-arms after a lapsed window instead of firing', async () => {
    const { send, pressOn, pressOff } = createHarness(DOUBLE);

    pressOn();
    await vi.advanceTimersByTimeAsync(3000); // window lapses
    pressOn();                               // fresh arm
    expect(send).not.toHaveBeenCalled();

    pressOff();                              // confirm the fresh arm
    expect(send).toHaveBeenCalledTimes(1);
  });
});
