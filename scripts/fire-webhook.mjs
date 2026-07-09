#!/usr/bin/env node
// Fires a UniFi Protect Alarm Manager-shaped webhook at this plugin's listener,
// so you can exercise the incoming sensor path with `npm run watch`. Zero deps.
//
//   node scripts/fire-webhook.mjs --token <token> [--port 51828] [--method POST]
//                                 [--secret <shared-secret>] [--name "Front Door"]
//
// The plugin logs each sensor's ready-to-paste URL at startup — copy the token
// from there (or from test/hbConfig/config.json when using the dev bridge).
import { request } from 'node:http';

const argValue = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const port = Number(argValue('port', 51828));
const token = argValue('token', 'dev-doorbell-token-change-me');
const method = String(argValue('method', 'POST')).toUpperCase();
const secret = argValue('secret', undefined);
const name = argValue('name', 'Dev Test Alarm');

const payload = JSON.stringify({
  alarm: {
    name,
    triggers: [{ key: 'ring', device: 'AA:BB:CC:DD:EE:FF', eventId: 'dev-event', timestamp: Date.now() }],
  },
  timestamp: Date.now(),
});

const headers = { 'content-type': 'application/json' };
if (secret) {
  headers.authorization = `Bearer ${secret}`;
}

const req = request({ host: '127.0.0.1', port, path: `/webhook/${token}`, method, headers }, (response) => {
  let body = '';
  response.on('data', (chunk) => {
    body += chunk;
  });
  response.on('end', () => {
    const masked = token.length > 8 ? `${token.slice(0, 4)}***` : '***';
    console.log(`[fire-webhook] ${method} /webhook/${masked} → HTTP ${response.statusCode} ${body.trim()}`);
    const ok = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300;
    process.exit(ok ? 0 : 1);
  });
});

req.on('error', (error) => {
  console.error(`[fire-webhook] request failed: ${error.message}`);
  process.exit(1);
});

if (method === 'POST') {
  req.write(payload);
}
req.end();
