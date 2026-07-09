import { describe, expect, it } from 'vitest';

import { redactPath, redactUrl } from '../src/redact.js';

describe('redactUrl', () => {
  it('masks the final path segment down to a 4-char prefix', () => {
    expect(redactUrl('https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/abcdef123456'))
      .toBe('https://192.168.1.1/proxy/protect/integration/v1/alarm-manager/webhook/abcd***');
  });

  it('fully masks short final segments', () => {
    expect(redactUrl('https://host/hook/ab')).toBe('https://host/hook/***');
  });

  it('replaces query strings entirely', () => {
    expect(redactUrl('https://host/hook/abcdefghijkl?token=super-secret'))
      .toBe('https://host/hook/abcd***?***');
  });

  it('accepts URL instances', () => {
    expect(redactUrl(new URL('http://10.0.0.1:8080/x/abcdefghijkl'))).toBe('http://10.0.0.1:8080/x/abcd***');
  });

  it('keeps origin-only urls intact', () => {
    expect(redactUrl('https://host/')).toBe('https://host/');
  });

  it('never throws on garbage', () => {
    expect(redactUrl('not a url')).toBe('<invalid url>');
  });
});

describe('redactPath', () => {
  const PREFIX = '/webhook/';

  it('masks the token after the prefix', () => {
    expect(redactPath('/webhook/abcdef123456', PREFIX)).toBe('/webhook/abcd***');
  });

  it('masks the token even when extra segments follow it', () => {
    const out = redactPath('/webhook/abcdef123456/extra', PREFIX);
    expect(out).not.toContain('abcdef123456');
    expect(out).not.toContain('extra');
    expect(out).toBe('/webhook/abcd***');
  });

  it('strips query strings via pathname parsing', () => {
    expect(redactPath('/webhook/abcdef123456?x=1', PREFIX)).toBe('/webhook/abcd***');
  });

  it('fully masks a short token', () => {
    expect(redactPath('/webhook/ab', PREFIX)).toBe('/webhook/***');
  });

  it('masks every segment when the prefix is absent', () => {
    expect(redactPath('/short/path', PREFIX)).toBe('/***/***');
  });

  it('returns a placeholder for an undefined path', () => {
    expect(redactPath(undefined, PREFIX)).toBe('<none>');
  });
});
