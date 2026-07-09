/* Custom settings UI for homebridge-unifi-webhook. Client-only: uses the
 * window.homebridge API injected by homebridge-config-ui-x. No server, no deps. */
import { buildUrl, cachedSensorTokens, generateToken, normalizeHost, resolveDisplayToken, sensorKey } from './lib.js';

const PLUGIN = 'homebridge-unifi-webhook';
const TABS = ['settings', 'webhooks', 'support'];

try {
  homebridge.showSchemaForm();
} catch (error) {
  // Older config-ui-x without showSchemaForm — nothing to fall back to.
}

const els = {
  cover: document.getElementById('uw-cover-img'),
  host: document.getElementById('uw-host'),
  list: document.getElementById('uw-list'),
  secretNote: document.getElementById('uw-secret-note'),
};

const current = { config: { platform: 'UniFiWebhook' }, byKey: new Map() };
let hostOverride;

function uiCall(method) {
  try {
    if (typeof homebridge[method] === 'function') {
      homebridge[method]();
    }
  } catch (error) {
    // Tolerate older config-ui-x builds lacking this method.
  }
}

function setTab(name) {
  for (const tab of TABS) {
    const active = tab === name;
    const btn = document.getElementById('uw-tab-' + tab);
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-secondary', !active);
    btn.setAttribute('aria-pressed', String(active));
    const panel = document.getElementById('uw-panel-' + tab);
    if (panel) {
      panel.classList.toggle('d-none', !active);
    }
  }
  uiCall(name === 'settings' ? 'showSchemaForm' : 'hideSchemaForm');
  uiCall('fixScrollHeight');
}

async function firstConfig() {
  const configs = await homebridge.getPluginConfig();
  return (configs && configs[0]) ? configs[0] : { platform: 'UniFiWebhook' };
}

async function fetchCachedTokens() {
  if (typeof homebridge.getCachedAccessories !== 'function') {
    return new Map();
  }
  try {
    return cachedSensorTokens(await homebridge.getCachedAccessories(), PLUGIN);
  } catch (error) {
    return new Map();
  }
}

function hasStableId(sensor) {
  return Boolean(sensor && typeof sensor.id === 'string' && sensor.id.trim() !== '');
}

function defaultHost() {
  const bindHost = typeof current.config.bindHost === 'string' ? current.config.bindHost.trim() : '';
  if (bindHost !== '' && bindHost !== '0.0.0.0' && bindHost !== '::') {
    return bindHost;
  }
  return window.location.hostname || '';
}

function hostForUrls() {
  if (hostOverride !== undefined && hostOverride !== '') {
    return hostOverride;
  }
  const host = defaultHost();
  return host === '' ? '<homebridge-ip>' : host;
}

async function copyText(text, name, node) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      homebridge.toast.success('Webhook URL copied', name);
      return;
    } catch (error) {
      // Not a secure context — fall through to the legacy path.
    }
  }
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.left = '-9999px';
  document.body.appendChild(scratch);
  scratch.select();
  let copied;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  scratch.remove();
  if (copied) {
    homebridge.toast.success('Webhook URL copied', name);
    return;
  }
  if (node && window.getSelection) {
    window.getSelection().selectAllChildren(node);
  }
  homebridge.toast.error('Could not copy automatically — press Ctrl/Cmd+C to copy the selected URL.');
}

async function setToken(index, name, replacing) {
  const warning = 'Replace the secret for "' + name + '"? Its webhook URL changes — re-paste it into every UniFi alarm action that uses it.';
  if (replacing && !window.confirm(warning)) {
    return;
  }
  const config = await firstConfig();
  config.sensors = Array.isArray(config.sensors) ? config.sensors : [];
  if (!config.sensors[index]) {
    return;
  }
  config.sensors[index].token = generateToken();
  await homebridge.updatePluginConfig([config]);
  try {
    await homebridge.savePluginConfig();
    homebridge.toast.success('Secret saved — restart Homebridge for the URL to go live.', name);
  } catch (error) {
    homebridge.toast.warning('Secret set — fill any required fields, then Save.', name);
  }
  await refresh();
}

function button(text, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  if (onClick) {
    el.addEventListener('click', onClick);
  }
  return el;
}

function badge(text, className) {
  const el = document.createElement('span');
  el.className = 'badge ' + className;
  el.textContent = text;
  return el;
}

function generateHandler(el, index, name, replacing) {
  return async () => {
    el.disabled = true;
    try {
      await setToken(index, name, replacing);
    } catch (error) {
      homebridge.toast.error('Could not generate a secret.');
    }
    el.disabled = false;
  };
}

function sensorRow(sensor, index, resolution, duplicate) {
  const name = (sensor && sensor.name) ? sensor.name : 'Sensor ' + (index + 1);
  const row = document.createElement('div');
  row.className = 'uw-sensor';

  const label = document.createElement('div');
  label.className = 'uw-name';
  label.textContent = name;
  if (duplicate) {
    label.appendChild(badge('duplicate ID — skipped at startup', 'bg-warning text-dark'));
  } else if (resolution.pendingRestart) {
    label.appendChild(badge('restart required', 'bg-info text-dark'));
  }
  row.appendChild(label);

  if (resolution.source === 'none') {
    const genBtn = button('Generate secret', 'btn btn-secondary btn-sm');
    genBtn.addEventListener('click', generateHandler(genBtn, index, name, false));
    const hint = document.createElement('span');
    hint.className = 'uw-hint';
    hint.textContent = sensorKey(sensor) === undefined
      ? 'Add a Stable ID (or generate a secret) — this sensor is skipped at startup until then.'
      : 'No secret yet — generate one now, or restart Homebridge to auto-generate it.';
    row.appendChild(genBtn);
    row.appendChild(hint);
    return row;
  }

  const url = buildUrl(hostForUrls(), current.config.port, resolution.token);
  const wrap = document.createElement('div');
  wrap.className = 'uw-url-row';

  const code = document.createElement('code');
  code.className = 'uw-url';
  code.textContent = url;
  code.title = resolution.source === 'auto' ? 'Auto-generated secret (persisted by the plugin)' : 'Secret from config.json';

  const copyBtn = button('Copy', 'btn btn-primary btn-sm', () => copyText(code.textContent, name, code));

  const regenBtn = button('Regenerate', 'btn btn-outline-secondary btn-sm');
  regenBtn.addEventListener('click', generateHandler(regenBtn, index, name, true));
  if (!hasStableId(sensor)) {
    regenBtn.disabled = true;
    regenBtn.title = 'Add a Stable ID first — regenerating an ID-less sensor recreates the accessory and its automations.';
  }

  wrap.appendChild(code);
  wrap.appendChild(copyBtn);
  wrap.appendChild(regenBtn);
  row.appendChild(wrap);
  return row;
}

function draw() {
  if (hostOverride === undefined) {
    els.host.value = defaultHost();
  }
  const hasSecret = typeof current.config.webhookSecret === 'string' && current.config.webhookSecret.trim() !== '';
  els.secretNote.classList.toggle('d-none', !hasSecret);

  const sensors = Array.isArray(current.config.sensors) ? current.config.sensors : [];
  els.list.innerHTML = '';
  if (sensors.length === 0) {
    const empty = document.createElement('em');
    empty.className = 'uw-hint';
    empty.textContent = 'Add a sensor in the Settings tab to get its webhook URL here.';
    els.list.appendChild(empty);
  } else {
    const seen = new Set();
    sensors.forEach((sensor, index) => {
      const key = sensorKey(sensor);
      const duplicate = key !== undefined && seen.has(key);
      if (key !== undefined) {
        seen.add(key);
      }
      els.list.appendChild(sensorRow(sensor, index, resolveDisplayToken(sensor, current.byKey), duplicate));
    });
  }
  uiCall('fixScrollHeight');
}

async function refresh() {
  try {
    current.config = await firstConfig();
  } catch (error) {
    return;
  }
  current.byKey = await fetchCachedTokens();
  draw();
}

if (els.cover) {
  const hideCover = () => els.cover.parentElement.classList.add('d-none');
  if (els.cover.complete && els.cover.naturalWidth === 0) {
    hideCover();
  } else {
    els.cover.addEventListener('error', hideCover);
  }
}

for (const tab of TABS) {
  document.getElementById('uw-tab-' + tab).addEventListener('click', () => setTab(tab));
}

els.host.addEventListener('input', () => {
  hostOverride = normalizeHost(els.host.value);
  draw();
});

setTab('settings');
await refresh();
homebridge.addEventListener('configChanged', () => {
  refresh().catch(() => {});
});
