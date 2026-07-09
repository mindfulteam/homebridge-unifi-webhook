import type { Logging, PlatformConfig } from 'homebridge';

export type HttpMethod = 'GET' | 'POST';

export type SensorType = 'contact' | 'motion' | 'occupancy';

export const CONFIG_DEFAULTS = {
  method: 'POST' as HttpMethod,
  timeoutSeconds: 10,
  resetDelayMs: 1000,
  allowSelfSigned: true,
  sensorType: 'contact' as SensorType,
  sensorResetDelayMs: 5000,
  port: 51828,
  bindHost: '0.0.0.0',
} as const;

export const TIMEOUT_SECONDS_RANGE = { min: 1, max: 60 } as const;
export const RESET_DELAY_MS_RANGE = { min: 100, max: 60_000 } as const;
export const PORT_RANGE = { min: 1, max: 65_535 } as const;

/** Below this length an explicitly configured token is flagged as weak. */
export const TOKEN_MIN_LENGTH = 16;

/** Valid sensor types, in the order shown to the user. */
export const SENSOR_TYPES: readonly SensorType[] = ['contact', 'motion', 'occupancy'];

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

/** One fully validated incoming-webhook sensor. */
export interface SensorConfig {
  /** Identity seed for the accessory UUID: the trimmed `id` if set, otherwise the explicit `token`. */
  readonly key: string;
  readonly name: string;
  readonly sensorType: SensorType;
  /**
   * The secret path segment of the sensor's webhook URL. `undefined` means the
   * platform generates and persists one on first launch — only possible when an
   * `id` anchors the accessory identity independently of the (still unknown) token.
   */
  readonly token: string | undefined;
  /** How long the sensor reads "detected" after a trigger before auto-resetting. */
  readonly resetDelayMs: number;
}

export interface ResolvedPlatformConfig {
  readonly buttons: readonly ButtonConfig[];
  readonly sensors: readonly SensorConfig[];
  readonly allowSelfSigned: boolean;
  readonly timeoutMs: number;
  readonly resetDelayMs: number;
  /** Port the incoming-webhook listener binds to (only started when sensors exist). */
  readonly port: number;
  /** Interface the listener binds to; defaults to all interfaces for console reachability. */
  readonly bindHost: string;
  /** Optional shared secret required on incoming requests, on top of the path token. */
  readonly webhookSecret: string | undefined;
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

  const sensors = validateSensors(raw.sensors, log);
  const port = Math.trunc(asClampedNumber(raw.port, CONFIG_DEFAULTS.port, PORT_RANGE, 'port', log));
  const bindHost = asTrimmedString(raw.bindHost) ?? CONFIG_DEFAULTS.bindHost;
  const webhookSecret = asTrimmedString(raw.webhookSecret);

  return {
    buttons,
    sensors,
    allowSelfSigned,
    timeoutMs: timeoutSeconds * 1000,
    resetDelayMs,
    port,
    bindHost,
    webhookSecret,
  };
}

function validateSensors(rawValue: unknown, log: ValidationLog): SensorConfig[] {
  if (rawValue !== undefined && !Array.isArray(rawValue)) {
    log.error('Config "sensors" must be an array — ignoring it.');
  }
  const rawSensors: unknown[] = Array.isArray(rawValue) ? rawValue : [];

  const sensors: SensorConfig[] = [];
  const nameByKey = new Map<string, string>();
  const nameByToken = new Map<string, string>();
  rawSensors.forEach((entry, index) => {
    const sensor = validateSensor(entry, index, log);
    if (!sensor) {
      return;
    }
    const existingName = nameByKey.get(sensor.key);
    if (existingName !== undefined) {
      log.error(
        `Skipping sensor ${index + 1} ("${sensor.name}"): it has the same identity as "${existingName}". ` +
        'Give each sensor a distinct "id" (or "token").',
      );
      return;
    }
    if (sensor.token !== undefined) {
      const clashingName = nameByToken.get(sensor.token);
      if (clashingName !== undefined) {
        log.error(
          `Skipping sensor ${index + 1} ("${sensor.name}"): its "token" is already used by "${clashingName}". ` +
          'Each sensor needs a distinct token.',
        );
        return;
      }
      nameByToken.set(sensor.token, sensor.name);
    }
    nameByKey.set(sensor.key, sensor.name);
    sensors.push(sensor);
  });
  return sensors;
}

function validateSensor(entry: unknown, index: number, log: ValidationLog): SensorConfig | undefined {
  const label = `sensor ${index + 1}`;
  if (typeof entry !== 'object' || entry === null) {
    log.error(`Skipping ${label}: expected an object with a "name".`);
    return undefined;
  }
  const rawEntry = entry as Record<string, unknown>;

  const name = asTrimmedString(rawEntry.name);
  if (!name) {
    log.error(`Skipping ${label}: "name" is required.`);
    return undefined;
  }

  const id = asTrimmedString(rawEntry.id);
  const token = asTrimmedString(rawEntry.token);
  const key = id ?? token;
  if (key === undefined) {
    // Without an id the token doubles as the identity anchor, so a sensor with
    // neither has nothing stable to hang its accessory (and automations) on.
    log.error(
      `Skipping ${label} ("${name}"): give it a stable "id" (recommended — the plugin then generates the ` +
      'secret webhook URL for you) or an explicit "token".',
    );
    return undefined;
  }
  if (token !== undefined && token.length < TOKEN_MIN_LENGTH) {
    log.warn(
      `Sensor "${name}": the configured token is short (under ${TOKEN_MIN_LENGTH} characters) and easier to guess. ` +
      'Prefer a long random secret, or set only an "id" and let the plugin generate one.',
    );
  }

  return {
    key,
    name,
    sensorType: asSensorType(rawEntry.sensorType, name, log),
    token,
    resetDelayMs: asClampedNumber(
      rawEntry.resetDelayMs,
      CONFIG_DEFAULTS.sensorResetDelayMs,
      RESET_DELAY_MS_RANGE,
      `sensor "${name}" resetDelayMs`,
      log,
    ),
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

function asSensorType(value: unknown, sensorName: string, log: ValidationLog): SensorType {
  if (value === undefined) {
    return CONFIG_DEFAULTS.sensorType;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if ((SENSOR_TYPES as readonly string[]).includes(lower)) {
      return lower as SensorType;
    }
  }
  log.warn(`Sensor "${sensorName}": sensorType must be one of ${SENSOR_TYPES.join(', ')} — using ${CONFIG_DEFAULTS.sensorType}.`);
  return CONFIG_DEFAULTS.sensorType;
}
