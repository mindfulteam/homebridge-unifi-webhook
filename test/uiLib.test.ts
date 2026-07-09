import { describe, expect, it } from 'vitest';

import { buildUrl, cachedSensorTokens, generateToken, resolveDisplayToken, sensorKey } from '../homebridge-ui/public/lib.js';
import type { CachedTokenEntry } from '../homebridge-ui/public/lib.js';

function mapOf(entries: Record<string, CachedTokenEntry>) {
  return new Map(Object.entries(entries));
}

function sensorAccessory(key: string, token: string, tokenSource = 'auto', plugin = 'homebridge-unifi-webhook') {
  return { plugin, context: { key, token, tokenSource, sensorType: 'contact', schemaVersion: 1 } };
}

describe('generateToken', () => {
  it('produces distinct base64url tokens of 24 bytes', () => {
    const one = generateToken();
    expect(one).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generateToken()).not.toBe(one);
  });
});

describe('buildUrl', () => {
  it('builds the runtime URL shape', () => {
    expect(buildUrl('192.168.1.50', 51828, 'abc')).toBe('http://192.168.1.50:51828/webhook/abc');
  });

  it('brackets IPv6 hosts exactly once', () => {
    expect(buildUrl('fe80::1', 51828, 'abc')).toBe('http://[fe80::1]:51828/webhook/abc');
    expect(buildUrl('[fe80::1]', 51828, 'abc')).toBe('http://[fe80::1]:51828/webhook/abc');
  });

  it('coerces string ports and falls back to the default port', () => {
    expect(buildUrl('host', '55074', 'abc')).toBe('http://host:55074/webhook/abc');
    expect(buildUrl('host', undefined, 'abc')).toBe('http://host:51828/webhook/abc');
  });

  it('percent-encodes tokens like the runtime does', () => {
    expect(buildUrl('host', 51828, 'a/b c')).toBe('http://host:51828/webhook/a%2Fb%20c');
  });
});

describe('sensorKey', () => {
  it('prefers a trimmed id, falls back to the token, else undefined', () => {
    expect(sensorKey({ id: ' doorbell ' })).toBe('doorbell');
    expect(sensorKey({ token: 'tok' })).toBe('tok');
    expect(sensorKey({ id: '  ', token: 'tok' })).toBe('tok');
    expect(sensorKey({})).toBeUndefined();
    expect(sensorKey(undefined)).toBeUndefined();
  });
});

describe('cachedSensorTokens', () => {
  it('maps sensor contexts by key and ignores button contexts', () => {
    const byKey = cachedSensorTokens(
      [sensorAccessory('doorbell', 'tok-a'), { plugin: 'homebridge-unifi-webhook', context: { key: 'siren', schemaVersion: 1 } }],
      'homebridge-unifi-webhook',
    );
    expect(byKey.get('doorbell')).toEqual({ token: 'tok-a', tokenSource: 'auto' });
    expect(byKey.has('siren')).toBe(false);
  });

  it('ignores other plugins and malformed entries; the first key wins', () => {
    const byKey = cachedSensorTokens(
      [
        sensorAccessory('doorbell', 'other', 'auto', 'homebridge-other'),
        sensorAccessory('doorbell', 'first'),
        sensorAccessory('doorbell', 'second'),
        null,
        { context: null },
      ],
      'homebridge-unifi-webhook',
    );
    expect(byKey.get('doorbell')).toEqual({ token: 'first', tokenSource: 'auto' });
    expect(byKey.size).toBe(1);
  });

  it('returns an empty map for non-array input', () => {
    expect(cachedSensorTokens(undefined, 'homebridge-unifi-webhook').size).toBe(0);
  });
});

describe('resolveDisplayToken', () => {
  it('prefers the explicit config token', () => {
    expect(resolveDisplayToken({ id: 'a', token: ' tok ' }, new Map())).toEqual({ token: 'tok', source: 'explicit', pendingRestart: false });
  });

  it('flags a pending restart when the cached token differs from config', () => {
    const byKey = mapOf({ a: { token: 'old', tokenSource: 'explicit' } });
    expect(resolveDisplayToken({ id: 'a', token: 'new' }, byKey)).toEqual({ token: 'new', source: 'explicit', pendingRestart: true });
  });

  it('falls back to the cached auto token', () => {
    const byKey = mapOf({ a: { token: 'auto-tok', tokenSource: 'auto' } });
    expect(resolveDisplayToken({ id: 'a' }, byKey)).toEqual({ token: 'auto-tok', source: 'auto' });
  });

  it('never resurfaces a cached explicit token after config cleared it', () => {
    const byKey = mapOf({ a: { token: 'stale', tokenSource: 'explicit' } });
    expect(resolveDisplayToken({ id: 'a' }, byKey)).toEqual({ source: 'none' });
  });

  it('resolves to none for unmatched or key-less sensors', () => {
    expect(resolveDisplayToken({ id: 'b' }, mapOf({ a: { token: 'x', tokenSource: 'auto' } }))).toEqual({ source: 'none' });
    expect(resolveDisplayToken({ name: 'just a name' }, new Map())).toEqual({ source: 'none' });
  });
});
