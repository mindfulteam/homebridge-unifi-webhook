import type { Logging, PlatformConfig } from 'homebridge';

export type HttpMethod = 'GET' | 'POST';

export const CONFIG_DEFAULTS = {
  method: 'POST' as HttpMethod,
  timeoutSeconds: 10,
  resetDelayMs: 1000,
  allowSelfSigned: true,
} as const;

export const TIMEOUT_SECONDS_RANGE = { min: 1, max: 60 } as const;
export const RESET_DELAY_MS_RANGE = { min: 100, max: 60_000 } as const;

/** One fully validated button. */
export interface ButtonConfig {
  /** Identity seed for the accessory UUID: the trimmed `id` if set, otherwise the configured url string. */
  readonly key: string;
  readonly name: string;
  /**
   * Undefined only when the button has an explicit `id` but a missing/invalid
   * url: the accessory survives (so HomeKit rooms and automations are kept)
   * and presses fail with a log message until the url is fixed.
   */
  readonly url: URL | undefined;
  readonly method: HttpMethod;
  readonly apiKey: string | undefined;
}

export interface ResolvedPlatformConfig {
  readonly buttons: readonly ButtonConfig[];
  readonly allowSelfSigned: boolean;
  readonly timeoutMs: number;
  readonly resetDelayMs: number;
}

type ValidationLog = Pick<Logging, 'warn' | 'error'>;

interface NumberRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Hand-rolled validation: config.json is user-edited, so everything is
 * untrusted. Invalid buttons are skipped individually — one bad entry must
 * never take down the healthy ones — and every skip/fallback is logged.
 */
export function validateConfig(raw: PlatformConfig, log: ValidationLog): ResolvedPlatformConfig {
  const globalApiKey = asTrimmedString(raw.apiKey);
  const allowSelfSigned = asBoolean(raw.allowSelfSigned, CONFIG_DEFAULTS.allowSelfSigned, 'allowSelfSigned', log);
  const timeoutSeconds = asClampedNumber(raw.timeoutSeconds, CONFIG_DEFAULTS.timeoutSeconds, TIMEOUT_SECONDS_RANGE, 'timeoutSeconds', log);
  const resetDelayMs = asClampedNumber(raw.resetDelayMs, CONFIG_DEFAULTS.resetDelayMs, RESET_DELAY_MS_RANGE, 'resetDelayMs', log);

  if (raw.buttons !== undefined && !Array.isArray(raw.buttons)) {
    log.error('Config "buttons" must be an array — ignoring it.');
  }
  const rawButtons: unknown[] = Array.isArray(raw.buttons) ? raw.buttons : [];

  const buttons: ButtonConfig[] = [];
  const nameByKey = new Map<string, string>();
  rawButtons.forEach((entry, index) => {
    const button = validateButton(entry, index, globalApiKey, log);
    if (!button) {
      return;
    }
    const existingName = nameByKey.get(button.key);
    if (existingName !== undefined) {
      log.error(
        `Skipping button ${index + 1} ("${button.name}"): it has the same identity as "${existingName}". ` +
        'Two buttons may share a webhook url only if each has a distinct "id".',
      );
      return;
    }
    nameByKey.set(button.key, button.name);
    buttons.push(button);
  });

  return {
    buttons,
    allowSelfSigned,
    timeoutMs: timeoutSeconds * 1000,
    resetDelayMs,
  };
}

function validateButton(entry: unknown, index: number, globalApiKey: string | undefined, log: ValidationLog): ButtonConfig | undefined {
  const label = `button ${index + 1}`;
  if (typeof entry !== 'object' || entry === null) {
    log.error(`Skipping ${label}: expected an object with "name" and "url".`);
    return undefined;
  }
  const rawEntry = entry as Record<string, unknown>;

  const name = asTrimmedString(rawEntry.name);
  if (!name) {
    log.error(`Skipping ${label}: "name" is required.`);
    return undefined;
  }

  const id = asTrimmedString(rawEntry.id);
  const rawUrl = asTrimmedString(rawEntry.url);
  const { url, problem } = parseHttpUrl(rawUrl, name, log);

  const key = id ?? rawUrl;
  if (key === undefined || (url === undefined && id === undefined)) {
    // Without an explicit id, the url doubles as the accessory identity —
    // so a button that lacks a usable url has nothing to anchor it.
    log.error(`Skipping ${label} ("${name}"): ${problem}.`);
    return undefined;
  }
  if (url === undefined) {
    log.error(
      `Button "${name}": ${problem}. Keeping its accessory alive because it has a stable id ("${id}") — ` +
      'presses will fail until the url is fixed.',
    );
  }

  return {
    key,
    name,
    url,
    method: asMethod(rawEntry.method, name, log),
    apiKey: asTrimmedString(rawEntry.apiKey) ?? globalApiKey,
  };
}

interface ParsedUrl {
  readonly url?: URL;
  readonly problem?: string;
}

function parseHttpUrl(rawUrl: string | undefined, buttonName: string, log: ValidationLog): ParsedUrl {
  if (rawUrl === undefined) {
    return { problem: 'a "url" is required' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Deliberately not echoing the raw value: a typo'd url may still contain
    // the real (secret) webhook id.
    return { problem: 'the configured url is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { problem: `the url protocol "${parsed.protocol}" is not supported — only http(s) is` };
  }
  if (parsed.protocol === 'http:') {
    log.warn(`Button "${buttonName}" uses plain http. Fine for testing, but UniFi consoles serve their webhooks over https.`);
  }
  return { url: parsed };
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown, fallback: boolean, field: string, log: ValidationLog): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  log.warn(`Config "${field}" should be true or false — using ${fallback}.`);
  return fallback;
}

function asClampedNumber(value: unknown, fallback: number, range: NumberRange, field: string, log: ValidationLog): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed =
    typeof value === 'number' ? value :
      typeof value === 'string' && value.trim() !== '' ? Number(value) :
        Number.NaN;
  if (!Number.isFinite(parsed)) {
    log.warn(`Config "${field}" is not a number — using ${fallback}.`);
    return fallback;
  }
  if (parsed < range.min || parsed > range.max) {
    const clamped = Math.min(Math.max(parsed, range.min), range.max);
    log.warn(`Config "${field}" must be between ${range.min} and ${range.max} — using ${clamped}.`);
    return clamped;
  }
  return parsed;
}

function asMethod(value: unknown, buttonName: string, log: ValidationLog): HttpMethod {
  if (value === undefined) {
    return CONFIG_DEFAULTS.method;
  }
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase();
    if (upper === 'GET' || upper === 'POST') {
      return upper;
    }
  }
  log.warn(`Button "${buttonName}": method must be GET or POST — using ${CONFIG_DEFAULTS.method}.`);
  return CONFIG_DEFAULTS.method;
}
