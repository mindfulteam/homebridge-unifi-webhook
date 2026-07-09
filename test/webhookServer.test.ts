import { request } from 'node:http';
import type { Logging } from 'homebridge';
import { afterEach, describe, expect, it } from 'vitest';

import { WebhookServer, type WebhookTarget } from '../src/webhookServer.js';
import { createMockLog } from './mocks/homebridgeApi.js';

interface RecordingTarget extends WebhookTarget {
  readonly calls: (string | undefined)[];
}

function makeTarget(name: string): RecordingTarget {
  const calls: (string | undefined)[] = [];
  return { name, calls, trigger: (source) => calls.push(source) };
}

interface Running {
  readonly server: WebhookServer;
  readonly log: Logging;
  readonly port: number;
}

const running: WebhookServer[] = [];

afterEach(() => {
  while (running.length > 0) {
    running.pop()!.stop();
  }
});

async function start(routes: Map<string, WebhookTarget>, secret?: string): Promise<Running> {
  const log = createMockLog();
  const server = new WebhookServer(log);
  running.push(server);
  server.start({ port: 0, host: '127.0.0.1', routes, secret });
  for (let i = 0; i < 200; i++) {
    const address = server.address();
    if (address) {
      return { server, log, port: address.port };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('server did not start listening');
}

interface Response {
  readonly status: number;
  readonly body: string;
}

function send(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: options.headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function logLines(log: Logging): string[] {
  const levels = [log.info, log.warn, log.error, log.debug] as unknown as { mock: { calls: unknown[][] } }[];
  return levels.flatMap((fn) => fn.mock.calls.map((call) => String(call[0])));
}

const TOKEN = 'aVeryLongSecretToken1234567890';

describe('WebhookServer', () => {
  it('triggers the matching sensor and returns 200 on POST', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    const res = await send(port, `/webhook/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toContain('127.0.0.1');
  });

  it('accepts GET too (UniFi webhooks default to GET)', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    const res = await send(port, `/webhook/${TOKEN}`, { method: 'GET' });

    expect(res.status).toBe(200);
    expect(target.calls).toHaveLength(1);
  });

  it('tolerates a trailing slash on the path', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    expect((await send(port, `/webhook/${TOKEN}/`)).status).toBe(200);
    expect(target.calls).toHaveLength(1);
  });

  it('returns 404 for an unknown token and never triggers', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    expect((await send(port, '/webhook/not-the-token')).status).toBe(404);
    expect((await send(port, '/something/else')).status).toBe(404);
    expect(target.calls).toHaveLength(0);
  });

  it('returns 405 for methods other than GET/POST', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    expect((await send(port, `/webhook/${TOKEN}`, { method: 'DELETE' })).status).toBe(405);
    expect(target.calls).toHaveLength(0);
  });

  it('enriches the trigger source with the alarm name from a UniFi POST body', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    const body = JSON.stringify({ alarm: { name: 'Front Door Ring' }, timestamp: 1 });
    await send(port, `/webhook/${TOKEN}`, { headers: { 'content-type': 'application/json' }, body });

    expect(target.calls[0]).toContain('Front Door Ring');
  });

  it('rejects an oversized body with 413 and never triggers', async () => {
    const target = makeTarget('Doorbell');
    const { port } = await start(new Map([[TOKEN, target]]));

    const res = await send(port, `/webhook/${TOKEN}`, { body: 'x'.repeat(70 * 1024) });

    expect(res.status).toBe(413);
    expect(target.calls).toHaveLength(0);
  });

  describe('with a shared secret', () => {
    const SECRET = 'shared-secret-value';

    it('accepts the secret via Authorization: Bearer', async () => {
      const target = makeTarget('Doorbell');
      const { port } = await start(new Map([[TOKEN, target]]), SECRET);

      const res = await send(port, `/webhook/${TOKEN}`, { headers: { authorization: `Bearer ${SECRET}` } });

      expect(res.status).toBe(200);
      expect(target.calls).toHaveLength(1);
    });

    it('accepts the secret via X-Webhook-Token', async () => {
      const target = makeTarget('Doorbell');
      const { port } = await start(new Map([[TOKEN, target]]), SECRET);

      const res = await send(port, `/webhook/${TOKEN}`, { headers: { 'x-webhook-token': SECRET } });

      expect(res.status).toBe(200);
      expect(target.calls).toHaveLength(1);
    });

    it('returns 401 when the secret is missing or wrong, and never triggers', async () => {
      const target = makeTarget('Doorbell');
      const { port } = await start(new Map([[TOKEN, target]]), SECRET);

      expect((await send(port, `/webhook/${TOKEN}`)).status).toBe(401);
      expect((await send(port, `/webhook/${TOKEN}`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
      expect(target.calls).toHaveLength(0);
    });
  });

  it('never writes the full token to the logs', async () => {
    const target = makeTarget('Doorbell');
    const { port, log } = await start(new Map([[TOKEN, target]]));

    await send(port, `/webhook/${TOKEN}`); // matched
    await send(port, `/webhook/${TOKEN}`, { method: 'DELETE' }); // 405, logs the reason
    await send(port, '/webhook/some-other-secret-token-value'); // 404, logs the redacted path

    for (const line of logLines(log)) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain('some-other-secret-token-value');
    }
  });

  it('logs a clear error and stays down when the port is already in use', async () => {
    const target = makeTarget('Doorbell');
    const first = await start(new Map([[TOKEN, target]]));

    const log = createMockLog();
    const second = new WebhookServer(log);
    running.push(second);
    second.start({ port: first.port, host: '127.0.0.1', routes: new Map([[TOKEN, target]]), secret: undefined });

    // Give the failing bind a moment to emit 'error'.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(second.address()).toBeUndefined();
    expect((log.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('\n'))
      .toContain('already in use');
  });
});
