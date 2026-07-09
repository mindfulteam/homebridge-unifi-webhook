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
    segments[segments.length - 1] = last.length > 8 ? `${last.slice(0, 4)}***` : '***';
  }

  const query = parsed.search.length > 0 ? '?***' : '';
  return `${parsed.origin}${segments.join('/')}${query}`;
}
