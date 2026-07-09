import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { RequestOptions } from 'node:https';

import type { HttpMethod } from './config.js';

export interface WebhookRequestSpec {
  readonly url: URL;
  readonly method: HttpMethod;
  /** Sent as X-API-KEY when set (UniFi Protect Integration API). */
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
  /** UniFi consoles serve self-signed certificates; when true, TLS verification is skipped for this request. */
  readonly allowSelfSigned: boolean;
  /** External abort, e.g. Homebridge shutdown. */
  readonly signal?: AbortSignal;
}

export type WebhookFailureReason = 'http-status' | 'timeout' | 'aborted' | 'network' | 'internal';

export type WebhookResult =
  | { readonly ok: true; readonly status: number; readonly durationMs: number }
  | { readonly ok: false; readonly reason: WebhookFailureReason; readonly status?: number; readonly message: string };

type RequestFn = (url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => ClientRequest;

/** Injectable for tests, so TLS option handling can be asserted without a real TLS server. */
export interface Transport {
  readonly httpRequest: RequestFn;
  readonly httpsRequest: RequestFn;
}

const DEFAULT_TRANSPORT: Transport = { httpRequest, httpsRequest };

/**
 * Minimal zero-dependency HTTP client. Node's built-in fetch cannot skip TLS
 * verification for the self-signed certificates UniFi consoles use without
 * pulling in undici, so this rides on node:http(s) directly.
 */
export class WebhookClient {
  constructor(private readonly transport: Transport = DEFAULT_TRANSPORT) {}

  /** Fires the webhook. Always resolves — a failed webhook is a result, not an exception. */
  async send(spec: WebhookRequestSpec): Promise<WebhookResult> {
    try {
      return await this.dispatch(spec);
    } catch (error) {
      return { ok: false, reason: 'internal', message: scrub(describeError(error), spec.apiKey) };
    }
  }

  private dispatch(spec: WebhookRequestSpec): Promise<WebhookResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const isHttps = spec.url.protocol === 'https:';

      const headers: OutgoingHttpHeaders = {};
      if (spec.apiKey !== undefined) {
        headers['X-API-KEY'] = spec.apiKey;
      }
      if (spec.method === 'POST') {
        headers['Content-Length'] = 0;
      }

      const timeoutSignal = AbortSignal.timeout(spec.timeoutMs);
      const signals = spec.signal ? [timeoutSignal, spec.signal] : [timeoutSignal];

      const options: RequestOptions = {
        method: spec.method,
        headers,
        // A fresh socket per request: webhook volume is tiny, and pooling
        // could reuse a socket across different TLS verification settings.
        agent: false,
        signal: AbortSignal.any(signals),
        ...(isHttps ? { rejectUnauthorized: !spec.allowSelfSigned } : {}),
      };

      const requestFn = isHttps ? this.transport.httpsRequest : this.transport.httpRequest;
      const request = requestFn(spec.url, options, (response) => {
        response.resume(); // drain — only the status matters
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status, durationMs: Date.now() - startedAt });
        } else {
          resolve({
            ok: false,
            reason: 'http-status',
            status,
            message: `HTTP ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}`,
          });
        }
      });

      request.on('error', (error) => {
        if (timeoutSignal.aborted) {
          resolve({ ok: false, reason: 'timeout', message: `no response within ${spec.timeoutMs} ms` });
        } else if (spec.signal?.aborted) {
          resolve({ ok: false, reason: 'aborted', message: 'request aborted' });
        } else {
          resolve({ ok: false, reason: 'network', message: scrub(describeError(error), spec.apiKey) });
        }
      });

      request.end();
    });
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/** Paranoia: make sure an API key can never leak through an error message. */
function scrub(text: string, apiKey: string | undefined): string {
  return apiKey ? text.split(apiKey).join('***') : text;
}
