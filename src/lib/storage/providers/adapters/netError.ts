/**
 * Shared fetch wrapper for personal-server adapters.
 *
 * A browser-blocked request (CORS preflight rejected, DNS failure, TLS
 * error, tailnet offline, mixed content) surfaces as a bare
 * `TypeError: Failed to fetch` with no detail. This turns that into an
 * actionable message naming the host and the likely cause.
 */

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** True for loopback, *.local and private IPv4 ranges — i.e. a desktop server. */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function localHint(url: string): string {
  try {
    const u = new URL(url);
    if (!isLocalHostname(u.hostname)) return '';
    return ` This looks like a server on your own machine or network (${u.host}). Check that: ` +
      `the server process is actually running; the port matches; your OS firewall allows it; ` +
      `and the server answers the browser's private-network preflight with ` +
      `"Access-Control-Allow-Private-Network: true" on OPTIONS (Chrome/Edge require it when an ` +
      `HTTPS page calls a local address).`;
  } catch { return ''; }
}

export async function adapterFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const host = hostOf(url);
    throw new Error(
      `Browser could not reach ${host}. The server may be offline/unreachable from this device, ` +
      `or it is blocking this app via CORS. Allow origin ${typeof location !== 'undefined' ? location.origin : 'this app'} ` +
      `for GET, PUT, HEAD, DELETE and the Authorization / x-amz-* headers.${localHint(url)} ` +
      `(${(e as Error).message})`,
    );
  }
}

/** Turn an HTTP failure into a message that names the likely cause. */
export function describeHttpFailure(
  op: string, status: number, body: string, ctx: { endpoint?: string; bucket?: string } = {},
): string {
  const detail = body.slice(0, 300).replace(/\s+/g, ' ').trim();
  let hint = '';
  if (status === 400 && /region/i.test(detail)) {
    hint = ' Region mismatch — MinIO/R2 usually need region "us-east-1" or "auto".';
  } else if (status === 401 || status === 403) {
    hint = /signature/i.test(detail)
      ? ' Access key/secret rejected or region does not match the server. MinIO usually needs region "us-east-1".'
      : ' Credentials rejected — check the access key, secret, and that it can write to this bucket.';
  } else if (status === 404) {
    hint = ctx.bucket
      ? ` Bucket "${ctx.bucket}" not found at ${ctx.endpoint ?? 'this endpoint'}.`
      : ' Path not found on the server.';
  } else if (status === 405 || status === 501) {
    hint = ' Endpoint rejected the request method — it may not support path-style S3 requests.';
  } else if (status === 413) {
    hint = ' Server refused the payload size.';
  }
  return `${op} failed: ${status}${detail ? ` ${detail}` : ''}.${hint}`;
}