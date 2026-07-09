/**
 * Masks a secret string (a webhook id or token) for logging: enough of a prefix
 * to correlate log lines, never enough to reconstruct the credential.
 */
export function redactToken(secret: string): string {
  if (secret.length === 0) {
    return secret;
  }
  return secret.length > 8 ? `${secret.slice(0, 4)}***` : '***';
}

/**
 * UniFi webhook URLs embed the alarm trigger id as the final path segment,
 * which is effectively a bearer credential. Every log line that mentions a
 * URL goes through here so ids and query strings never reach the logs.
 */
export function redactUrl(url: URL | string): string {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return '<invalid url>';
  }

  const segments = parsed.pathname.split('/');
  const last = segments[segments.length - 1] ?? '';
  if (last.length > 0) {
    segments[segments.length - 1] = redactToken(last);
  }

  const query = parsed.search.length > 0 ? '?***' : '';
  return `${parsed.origin}${segments.join('/')}${query}`;
}

/**
 * Masks the token segment of an incoming request path (`/webhook/<token>`) so
 * per-request logs never carry the secret.
 */
export function redactPath(rawPath: string | undefined): string {
  if (rawPath === undefined) {
    return '<none>';
  }
  let pathname: string;
  try {
    pathname = new URL(rawPath, 'http://localhost').pathname;
  } catch {
    return '<invalid path>';
  }
  const segments = pathname.split('/');
  const last = segments[segments.length - 1] ?? '';
  segments[segments.length - 1] = redactToken(last);
  return segments.join('/');
}
