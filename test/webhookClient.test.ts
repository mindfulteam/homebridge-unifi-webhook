import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { ClientRequest, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebhookClient, type Transport, type WebhookRequestSpec } from '../src/webhookClient.js';

type SpecOverrides = Partial<WebhookRequestSpec> & { url: URL };

function spec(overrides: SpecOverrides): WebhookRequestSpec {
  return {
    method: 'POST',
    apiKey: 'test-key',
    timeoutMs: 2000,
    allowSelfSigned: true,
    ...overrides,
  };
}

const servers: Server[] = [];

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}/hook/abcdef123456`);
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

describe('WebhookClient against a real http server', () => {
  it('POSTs with the api key header and an empty body', async () => {
    let seen: { method?: string; apiKey?: string; contentLength?: string } = {};
    const url = await startServer((req, res) => {
      seen = {
        method: req.method,
        apiKey: req.headers['x-api-key'] as string,
        contentLength: req.headers['content-length'] as string,
      };
      res.statusCode = 204;
      res.end();
    });

    const result = await new WebhookClient().send(spec({ url }));

    expect(result).toMatchObject({ ok: true, status: 204 });
    expect(seen).toEqual({ method: 'POST', apiKey: 'test-key', contentLength: '0' });
  });

  it('GETs without an api key header when no key is configured', async () => {
    let sawHeader = true;
    const url = await startServer((req, res) => {
      sawHeader = 'x-api-key' in req.headers;
      res.statusCode = 200;
      res.end('ok');
    });

    const result = await new WebhookClient().send(spec({ url, method: 'GET', apiKey: undefined }));

    expect(result.ok).toBe(true);
    expect(sawHeader).toBe(false);
  });

  it('reports non-2xx statuses as failures', async () => {
    const url = await startServer((_req, res) => {
      res.statusCode = 401;
      res.end();
    });

    const result = await new WebhookClient().send(spec({ url }));

    expect(result).toMatchObject({ ok: false, reason: 'http-status', status: 401 });
  });

  it('times out when the server never answers', async () => {
    const url = await startServer(() => {
      // hold the request open
    });

    const result = await new WebhookClient().send(spec({ url, timeoutMs: 150 }));

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('reports connection failures as network errors', async () => {
    const url = await startServer((_req, res) => res.end());
    const heldPort = (new URL(url)).port;
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }

    const result = await new WebhookClient().send(spec({ url: new URL(`http://127.0.0.1:${heldPort}/hook/x`) }));

    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect((result as { message: string }).message).toContain('ECONNREFUSED');
  });

  it('resolves as aborted when the external signal fires', async () => {
    const url = await startServer(() => {
      // hold the request open
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await new WebhookClient().send(spec({ url, signal: controller.signal, timeoutMs: 5000 }));

    expect(result).toMatchObject({ ok: false, reason: 'aborted' });
  });
});

interface CapturedCall {
  url: URL;
  options: Record<string, unknown>;
}

function createFakeTransport(): { transport: Transport; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const requestFn = (url: URL, options: unknown, _callback: (res: IncomingMessage) => void): ClientRequest => {
    calls.push({ url, options: options as Record<string, unknown> });
    const request = new EventEmitter() as unknown as ClientRequest;
    (request as unknown as { end: () => void }).end = () => {
      queueMicrotask(() => (request as unknown as EventEmitter).emit('error', new Error('fake transport')));
    };
    return request;
  };
  return { transport: { httpRequest: requestFn, httpsRequest: requestFn }, calls };
}

describe('WebhookClient TLS and socket options', () => {
  it('disables certificate verification only when self-signed certs are allowed', async () => {
    const { transport, calls } = createFakeTransport();
    const client = new WebhookClient(transport);

    await client.send(spec({ url: new URL('https://console.local/hook/x'), allowSelfSigned: true }));
    await client.send(spec({ url: new URL('https://console.local/hook/x'), allowSelfSigned: false }));

    expect(calls[0]?.options.rejectUnauthorized).toBe(false);
    expect(calls[1]?.options.rejectUnauthorized).toBe(true);
  });

  it('never sets TLS options for plain http and always disables pooling', async () => {
    const { transport, calls } = createFakeTransport();
    const client = new WebhookClient(transport);

    await client.send(spec({ url: new URL('http://console.local/hook/x'), allowSelfSigned: true }));

    expect('rejectUnauthorized' in (calls[0]?.options ?? {})).toBe(false);
    expect(calls[0]?.options.agent).toBe(false);
  });

  it('routes https urls to the https transport', async () => {
    const httpRequest = vi.fn();
    const { transport } = createFakeTransport();
    const client = new WebhookClient({ httpRequest, httpsRequest: transport.httpsRequest });

    await client.send(spec({ url: new URL('https://console.local/hook/x') }));

    expect(httpRequest).not.toHaveBeenCalled();
  });
});

describe('WebhookClient failure hygiene', () => {
  it('never rejects, even when the transport throws synchronously', async () => {
    const throwing: Transport = {
      httpRequest: () => {
        throw new Error('boom with test-key inside');
      },
      httpsRequest: () => {
        throw new Error('boom with test-key inside');
      },
    };

    const result = await new WebhookClient(throwing).send(spec({ url: new URL('http://x/hook/y') }));

    expect(result).toMatchObject({ ok: false, reason: 'internal' });
  });

  it('scrubs the api key out of error messages', async () => {
    const throwing: Transport = {
      httpRequest: () => {
        throw new Error('denied for key test-key');
      },
      httpsRequest: () => {
        throw new Error('denied for key test-key');
      },
    };

    const result = await new WebhookClient(throwing).send(spec({ url: new URL('http://x/hook/y') }));

    expect((result as { message: string }).message).not.toContain('test-key');
    expect((result as { message: string }).message).toContain('***');
  });
});
