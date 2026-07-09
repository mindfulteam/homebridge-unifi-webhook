#!/usr/bin/env node
// Local stand-in for a UniFi Protect webhook endpoint. Zero dependencies.
//
//   node scripts/mock-webhook.mjs [--port 8580] [--status 204] [--delay 0]
//
// Pair it with `npm run watch` and test/hbConfig/config.json to exercise the
// plugin end-to-end: success (default), failures (--status 500), and
// timeouts (--delay 15000).
import { createServer } from 'node:http';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

const port = arg('port', 8580);
const status = arg('status', 204);
const delay = arg('delay', 0);

createServer((request, response) => {
  const key = request.headers['x-api-key'] ?? '(no key)';
  console.log(`[mock-webhook] ${request.method} ${request.url} x-api-key=${key}`);
  request.resume();
  request.on('end', () => {
    setTimeout(() => {
      response.statusCode = status;
      response.end();
    }, delay);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`[mock-webhook] listening on http://127.0.0.1:${port} (status=${status}, delay=${delay}ms)`);
});
