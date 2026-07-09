/* Pure helpers for the custom settings UI. Token/URL/matching semantics mirror
 * the runtime (src/platform.ts resolveToken/announceSensorUrl, src/config.ts). */
export const DEFAULT_PORT = 51828;

function trimmed(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value.trim();
  return text === '' ? undefined : text;
}

export function generateToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bracketHost(host) {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host;
  }
  return host.indexOf(':') !== -1 ? '[' + host + ']' : host;
}

export function buildUrl(host, port, token) {
  return 'http://' + bracketHost(host) + ':' + (Number(port) || DEFAULT_PORT) + '/webhook/' + encodeURIComponent(token);
}

export function sensorKey(sensor) {
  if (!sensor) {
    return undefined;
  }
  return trimmed(sensor.id) ?? trimmed(sensor.token);
}

export function cachedSensorTokens(accessories, pluginName) {
  const byKey = new Map();
  for (const accessory of Array.isArray(accessories) ? accessories : []) {
    if (!accessory || (pluginName && accessory.plugin && accessory.plugin !== pluginName)) {
      continue;
    }
    const context = accessory.context;
    if (!context || typeof context.token !== 'string' || typeof context.sensorType !== 'string') {
      continue;
    }
    if (typeof context.key === 'string' && !byKey.has(context.key)) {
      byKey.set(context.key, { token: context.token, tokenSource: context.tokenSource });
    }
  }
  return byKey;
}

export function resolveDisplayToken(sensor, byKey) {
  const explicit = trimmed(sensor && sensor.token);
  const key = sensorKey(sensor);
  const cached = key === undefined ? undefined : byKey.get(key);
  if (explicit !== undefined) {
    return { token: explicit, source: 'explicit', pendingRestart: cached !== undefined && cached.token !== explicit };
  }
  if (cached && cached.tokenSource !== 'explicit' && trimmed(cached.token) !== undefined) {
    return { token: cached.token, source: 'auto' };
  }
  return { source: 'none' };
}
