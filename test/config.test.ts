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
