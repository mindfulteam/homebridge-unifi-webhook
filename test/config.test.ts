import { describe, expect, it, vi } from 'vitest';

import { validateConfig } from '../src/config.js';
import { asPlatformConfig } from './mocks/homebridgeApi.js';

function createLog() {
  return { warn: vi.fn(), error: vi.fn() };
}

const VALID_URL = 'https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/abc123';

describe('validateConfig', () => {
  it('applies defaults to a minimal valid config', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ buttons: [{ name: 'Alarm', url: VALID_URL }] }), log);

    expect(config.buttons).toHaveLength(1);
    const button = config.buttons[0]!;
    expect(button).toMatchObject({ name: 'Alarm', key: VALID_URL, method: 'POST', apiKey: undefined });
    expect(button.url?.href).toBe(VALID_URL);
    expect(config.timeoutMs).toBe(10_000);
    expect(config.resetDelayMs).toBe(1000);
    expect(config.allowSelfSigned).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('resolves the api key per button with the global key as fallback', () => {
    const config = validateConfig(asPlatformConfig({
      apiKey: 'global-key',
      buttons: [
        { name: 'A', url: `${VALID_URL}1` },
        { name: 'B', url: `${VALID_URL}2`, apiKey: 'button-key' },
      ],
    }), createLog());

    expect(config.buttons[0]?.apiKey).toBe('global-key');
    expect(config.buttons[1]?.apiKey).toBe('button-key');
  });

  it('skips buttons without a name but keeps valid siblings', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ url: VALID_URL }, { name: '   ', url: VALID_URL }, { name: 'Valid', url: `${VALID_URL}9` }],
    }), log);

    expect(config.buttons.map((b) => b.name)).toEqual(['Valid']);
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('skips buttons with a missing or invalid url when no id anchors them', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'NoUrl' }, { name: 'BadUrl', url: 'not-a-url' }, { name: 'BadProtocol', url: 'ftp://host/x' }],
    }), log);

    expect(config.buttons).toHaveLength(0);
    expect(log.error).toHaveBeenCalledTimes(3); // exactly one clear error per skipped button
  });

  it('keeps a button with an invalid url alive when it has a stable id', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'Survivor', url: 'not-a-url', id: 'survivor' }],
    }), log);

    expect(config.buttons).toHaveLength(1);
    expect(config.buttons[0]).toMatchObject({ name: 'Survivor', key: 'survivor', url: undefined });
    expect(log.error).toHaveBeenCalled();
  });

  it('warns on plain http urls but keeps them', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'Local', url: 'http://127.0.0.1:8580/hook/x' }],
    }), log);

    expect(config.buttons).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('normalizes the method and falls back to POST on junk', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [
        { name: 'A', url: `${VALID_URL}1`, method: 'get' },
        { name: 'B', url: `${VALID_URL}2`, method: 'DELETE' },
      ],
    }), log);

    expect(config.buttons[0]?.method).toBe('GET');
    expect(config.buttons[1]?.method).toBe('POST');
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('defaults double-press off with a 3s window', () => {
    const config = validateConfig(asPlatformConfig({ buttons: [{ name: 'A', url: VALID_URL }] }), createLog());

    expect(config.buttons[0]).toMatchObject({ requireDoublePress: false, doublePressWindowMs: 3000 });
  });

  it('parses and clamps the per-button double-press window', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [
        { name: 'Custom', url: `${VALID_URL}1`, requireDoublePress: true, doublePressWindowSeconds: 10 },
        { name: 'TooLong', url: `${VALID_URL}2`, requireDoublePress: true, doublePressWindowSeconds: 999 },
      ],
    }), log);

    expect(config.buttons[0]).toMatchObject({ requireDoublePress: true, doublePressWindowMs: 10_000 });
    expect(config.buttons[1]?.doublePressWindowMs).toBe(30_000);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('falls back when requireDoublePress is not a boolean', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'A', url: VALID_URL, requireDoublePress: 'yes' }],
    }), log);

    expect(config.buttons[0]?.requireDoublePress).toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('coerces and clamps numeric settings with warnings', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      timeoutSeconds: 999,
      resetDelayMs: '250',
      buttons: [],
    }), log);

    expect(config.timeoutMs).toBe(60_000);
    expect(config.resetDelayMs).toBe(250);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('falls back on non-numeric settings', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ timeoutSeconds: 'soon', buttons: [] }), log);

    expect(config.timeoutMs).toBe(10_000);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('rejects duplicate identities and names the earlier button', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'First', url: VALID_URL }, { name: 'Second', url: VALID_URL }],
    }), log);

    expect(config.buttons.map((b) => b.name)).toEqual(['First']);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"First"'));
  });

  it('allows the same url twice when distinct ids are set', () => {
    const config = validateConfig(asPlatformConfig({
      buttons: [
        { name: 'A', url: VALID_URL, id: 'a' },
        { name: 'B', url: VALID_URL, id: 'b' },
      ],
    }), createLog());

    expect(config.buttons).toHaveLength(2);
  });

  it('tolerates a missing or malformed buttons value', () => {
    const log = createLog();
    expect(validateConfig(asPlatformConfig({}), log).buttons).toEqual([]);
    expect(validateConfig(asPlatformConfig({ buttons: 'nope' }), log).buttons).toEqual([]);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('skips non-object button entries', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ buttons: ['nope', 42, null] }), log);

    expect(config.buttons).toHaveLength(0);
    expect(log.error).toHaveBeenCalledTimes(3);
  });
});

describe('validateConfig — sensors', () => {
  it('applies defaults to a minimal valid sensor anchored by an id', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ sensors: [{ name: 'Doorbell', id: 'doorbell' }] }), log);

    expect(config.sensors).toHaveLength(1);
    expect(config.sensors[0]).toMatchObject({
      key: 'doorbell',
      name: 'Doorbell',
      sensorType: 'contact',
      token: undefined,
      resetDelayMs: 5000,
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('uses an explicit token as the identity when no id is set', () => {
    const config = validateConfig(asPlatformConfig({ sensors: [{ name: 'X', token: 'a-long-explicit-token' }] }), createLog());

    expect(config.sensors[0]).toMatchObject({ key: 'a-long-explicit-token', token: 'a-long-explicit-token' });
  });

  it('skips a sensor that has neither an id nor a token', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ sensors: [{ name: 'Anon' }] }), log);

    expect(config.sensors).toHaveLength(0);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('skips a sensor without a name', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ sensors: [{ id: 'x' }] }), log);

    expect(config.sensors).toHaveLength(0);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('normalizes the sensor type and falls back to contact on junk', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      sensors: [
        { name: 'A', id: 'a', sensorType: 'MOTION' },
        { name: 'B', id: 'b', sensorType: 'weird' },
      ],
    }), log);

    expect(config.sensors[0]?.sensorType).toBe('motion');
    expect(config.sensors[1]?.sensorType).toBe('contact');
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('warns on a short explicit token but keeps the sensor', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ sensors: [{ name: 'A', token: 'short' }] }), log);

    expect(config.sensors).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('clamps the sensor reset delay with a warning', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ sensors: [{ name: 'A', id: 'a', resetDelayMs: 99 }] }), log);

    expect(config.sensors[0]?.resetDelayMs).toBe(100);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('rejects duplicate sensor identities and names the earlier sensor', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      sensors: [{ name: 'First', id: 'dup' }, { name: 'Second', id: 'dup' }],
    }), log);

    expect(config.sensors.map((s) => s.name)).toEqual(['First']);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"First"'));
  });

  it('rejects two sensors that share an explicit token but have distinct ids', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({
      sensors: [
        { name: 'First', id: 'a', token: 'a-shared-explicit-token' },
        { name: 'Second', id: 'b', token: 'a-shared-explicit-token' },
      ],
    }), log);

    expect(config.sensors.map((s) => s.name)).toEqual(['First']);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('already used by "First"'));
  });

  it('tolerates a malformed sensors value', () => {
    const log = createLog();
    expect(validateConfig(asPlatformConfig({ sensors: 'nope' }), log).sensors).toEqual([]);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('lets buttons and sensors coexist', () => {
    const config = validateConfig(asPlatformConfig({
      buttons: [{ name: 'B', url: VALID_URL }],
      sensors: [{ name: 'S', id: 's' }],
    }), createLog());

    expect(config.buttons).toHaveLength(1);
    expect(config.sensors).toHaveLength(1);
  });
});

describe('validateConfig — server settings', () => {
  it('defaults the listener settings', () => {
    const config = validateConfig(asPlatformConfig({}), createLog());

    expect(config.port).toBe(51828);
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.webhookSecret).toBeUndefined();
  });

  it('accepts a custom port, bind host, and trimmed secret', () => {
    const config = validateConfig(asPlatformConfig({ port: 8080, bindHost: '127.0.0.1', webhookSecret: '  s3cr3t  ' }), createLog());

    expect(config.port).toBe(8080);
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.webhookSecret).toBe('s3cr3t');
  });

  it('clamps an out-of-range port with a warning', () => {
    const log = createLog();
    const config = validateConfig(asPlatformConfig({ port: 70000 }), log);

    expect(config.port).toBe(65535);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('falls back to the default port on a non-numeric value', () => {
    const config = validateConfig(asPlatformConfig({ port: 'nope' }), createLog());

    expect(config.port).toBe(51828);
  });
});
