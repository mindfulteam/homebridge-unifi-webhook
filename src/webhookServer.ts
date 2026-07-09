import { timingSafeEqual } from 'node:crypto';
import { createServer as defaultCreateServer } from 'node:http';
import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Logging } from 'homebridge';

import { redactPath } from './redact.js';

/** What the server needs from a sensor: a display name and a way to fire it. */
export interface WebhookTarget {
  readonly name: string;
  trigger(source?: string): void;
}

export interface WebhookServerOptions {
  readonly port: number;
  readonly host: string;
  /** token → sensor. Tokens are the per-sensor secret path segment. */
  readonly routes: ReadonlyMap<string, WebhookTarget>;
  /** Optional shared secret required on every request, on top of the path token. */
  readonly secret: string | undefined;
}

type ServerLog = Pick<Logging, 'info' | 'warn' | 'error' | 'debug'>;

/** Injectable so tests can drive the handler without binding a real socket. */
export type CreateServer = (listener: RequestListener) => Server;

/** The URL shape: http://<host>:<port>/webhook/<token>. */
export const PATH_PREFIX = '/webhook/';

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
/** Cap the alarm name pulled from the body into logs, so a hostile body can't flood them. */
const MAX_ALARM_NAME_LENGTH = 80;

interface BodyResult {
  readonly body?: Buffer;
  readonly tooLarge?: boolean;
}

/**
 * Zero-dependency HTTP receiver for UniFi Protect Alarm Manager webhooks. One
 * listener multiplexes every sensor by the secret token in its URL path; a
 * matching request pulses that sensor. Rides on node:http directly to keep the
 * plugin dependency-free.
 */
export class WebhookServer {
  private readonly createServer: CreateServer;
  private server: Server | undefined;

  constructor(
    private readonly log: ServerLog,
    createServer: CreateServer = (listener) => defaultCreateServer(listener),
  ) {
    this.createServer = createServer;
  }

  /** Binds the listener. Failures are logged, never thrown — Homebridge stays up. */
  start(options: WebhookServerOptions): void {
    if (this.server) {
      return;
    }

    const server = this.createServer((req, res) => {
      try {
        this.handleRequest(req, res, options);
      } catch (error) {
        // A handler bug must never take down the http server or leak a stack to a caller.
        this.log.error(`Webhook handler error: ${describeError(error)}`);
        this.respond(res, 500, 'Internal Server Error');
      }
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;

    server.on('error', (error: NodeJS.ErrnoException) => {
      this.server = undefined;
      this.log.error(`${listenErrorHint(error, options)} Sensors will not fire until this is fixed.`);
    });

    server.listen(options.port, options.host, () => {
      const count = options.routes.size;
      const where = options.host === '0.0.0.0' ? 'all interfaces' : options.host;
      this.log.info(
        `Webhook listener ready on port ${options.port} (${where}), path ${PATH_PREFIX}<token> — ` +
        `${count} sensor${count === 1 ? '' : 's'}.`,
      );
    });

    this.server = server;
  }

  /** Stops accepting new requests. Safe to call when not started. */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  /** The bound address once listening; undefined before start / after a listen error. For tests. */
  address(): AddressInfo | undefined {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? addr : undefined;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse, options: WebhookServerOptions): void {
    const source = req.socket.remoteAddress ?? 'unknown';

    const method = req.method ?? '';
    if (method !== 'GET' && method !== 'POST') {
      this.reject(req, res, 405, 'Method Not Allowed', `method ${method || '(none)'}`, source);
      return;
    }

    const token = extractToken(req.url);
    const target = token !== undefined ? options.routes.get(token) : undefined;
    if (target === undefined) {
      // Unknown or malformed token → 404, indistinguishable from any random path.
      this.reject(req, res, 404, 'Not Found', `no sensor for ${redactPath(req.url)}`, source);
      return;
    }

    if (options.secret !== undefined && !hasValidSecret(req, options.secret)) {
      this.reject(req, res, 401, 'Unauthorized', `bad or missing secret for "${target.name}"`, source);
      return;
    }

    this.consumeBody(req, (result) => {
      if (result.tooLarge) {
        // Stop buffering, but let consumeBody keep draining to end so the client
        // still gets this clean 413 instead of a mid-upload connection reset.
        this.log.warn(`"${target.name}": webhook body exceeded ${MAX_BODY_BYTES} bytes — ignoring the request.`);
        this.respond(res, 413, 'Payload Too Large');
        return;
      }
      // Acknowledge first (UniFi retries on non-2xx), then pulse the sensor.
      this.respond(res, 200, 'OK');
      target.trigger(describeSource(source, result.body));
    });
  }

  private reject(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    message: string,
    reason: string,
    source: string,
  ): void {
    req.resume(); // drain any body so the socket is freed promptly
    this.respond(res, status, message);
    const line = `Rejected webhook (${status}) from ${source}: ${reason}`;
    if (status === 401) {
      this.log.warn(line);
    } else {
      this.log.debug(line);
    }
  }

  private consumeBody(req: IncomingMessage, done: (result: BodyResult) => void): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (result: BodyResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      done(result);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settle({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle({ body: Buffer.concat(chunks) }));
    req.on('error', () => settle({}));
  }

  private respond(res: ServerResponse, status: number, message: string): void {
    if (res.writableEnded) {
      return;
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`${message}\n`);
  }
}

function extractToken(rawUrl: string | undefined): string | undefined {
  if (rawUrl === undefined) {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
  if (!pathname.startsWith(PATH_PREFIX)) {
    return undefined;
  }
  let rest = pathname.slice(PATH_PREFIX.length);
  if (rest.endsWith('/')) {
    rest = rest.slice(0, -1);
  }
  // Exactly one path segment after the prefix; tokens are base64url (no slash).
  if (rest.length === 0 || rest.includes('/')) {
    return undefined;
  }
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}

function hasValidSecret(req: IncomingMessage, secret: string): boolean {
  const provided = extractProvidedSecret(req);
  return provided !== undefined && safeEqual(provided, secret);
}

/** Accepts the secret as `Authorization: Bearer <s>` or `X-Webhook-Token: <s>`. */
function extractProvidedSecret(req: IncomingMessage): string | undefined {
  const auth = firstHeader(req.headers.authorization);
  if (auth !== undefined) {
    const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (bearer?.[1] !== undefined) {
      return bearer[1];
    }
  }
  const custom = firstHeader(req.headers['x-webhook-token']);
  return custom === undefined ? undefined : custom.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // Length isn't the secret; bail before timingSafeEqual, which requires equal lengths.
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function describeSource(ip: string, body: Buffer | undefined): string {
  const alarmName = body ? alarmNameFrom(body) : undefined;
  return alarmName ? `${ip} (alarm "${alarmName}")` : ip;
}

/** Best-effort: UniFi POSTs a fixed JSON with `alarm.name`; used only to enrich logs. */
function alarmNameFrom(body: Buffer): string | undefined {
  if (body.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    const alarm = isRecord(parsed) ? parsed.alarm : undefined;
    const name = isRecord(alarm) ? alarm.name : undefined;
    if (typeof name === 'string' && name.trim().length > 0) {
      return name.trim().slice(0, MAX_ALARM_NAME_LENGTH);
    }
  } catch {
    // Not the expected UniFi JSON — the token already routed the request, so this is fine.
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function listenErrorHint(error: NodeJS.ErrnoException, options: WebhookServerOptions): string {
  if (error.code === 'EADDRINUSE') {
    return `Cannot start the webhook listener: port ${options.port} on ${options.host} is already in use. ` +
      'Change "port" in the plugin settings.';
  }
  if (error.code === 'EACCES') {
    return `Cannot start the webhook listener: permission denied for port ${options.port}. Use a port above 1024.`;
  }
  return `Webhook listener error: ${describeError(error)}.`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}
