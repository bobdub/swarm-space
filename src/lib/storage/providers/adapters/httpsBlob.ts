/**
 * HTTPS Blob adapter — talks to any self-hosted server implementing the
 * tiny REST contract documented in docs/runbooks/personal-server-reference.md.
 *
 *   PUT    /chunks/:hash    body: ciphertext        -> 200/201
 *   GET    /chunks/:hash                            -> 200 ciphertext | 404
 *   HEAD   /chunks/:hash                            -> 200 | 404
 *   DELETE /chunks/:hash                            -> 204
 *   GET    /health                                  -> { ok, used, cap, version }
 *
 * Bearer token auth. CORS must allow the app origin (probe surfaces this).
 */

export interface HttpsBlobCreds {
  token: string;
}

export interface HttpsBlobHealth {
  ok: boolean;
  used?: number;
  cap?: number;
  version?: string;
}

function authHeaders(creds: HttpsBlobCreds): Record<string, string> {
  return { Authorization: `Bearer ${creds.token}` };
}

function chunkUrl(baseUrl: string, hash: string): string {
  const base = baseUrl.replace(/\/$/, '');
  // Hash is hex; safe in URL but encode defensively.
  return `${base}/chunks/${encodeURIComponent(hash)}`;
}

export async function httpsBlobPut(
  baseUrl: string, creds: HttpsBlobCreds, hash: string, body: ArrayBuffer,
): Promise<void> {
  const res = await fetch(chunkUrl(baseUrl, hash), {
    method: 'PUT',
    headers: { ...authHeaders(creds), 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!res.ok && res.status !== 201) {
    throw new Error(`PUT failed: ${res.status} ${res.statusText}`);
  }
}

export async function httpsBlobGet(
  baseUrl: string, creds: HttpsBlobCreds, hash: string,
): Promise<ArrayBuffer | null> {
  const res = await fetch(chunkUrl(baseUrl, hash), { headers: authHeaders(creds) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return await res.arrayBuffer();
}

export async function httpsBlobHead(
  baseUrl: string, creds: HttpsBlobCreds, hash: string,
): Promise<boolean> {
  const res = await fetch(chunkUrl(baseUrl, hash), { method: 'HEAD', headers: authHeaders(creds) });
  return res.ok;
}

export async function httpsBlobDelete(
  baseUrl: string, creds: HttpsBlobCreds, hash: string,
): Promise<void> {
  const res = await fetch(chunkUrl(baseUrl, hash), { method: 'DELETE', headers: authHeaders(creds) });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`DELETE failed: ${res.status}`);
  }
}

export async function httpsBlobHealth(
  baseUrl: string, creds: HttpsBlobCreds,
): Promise<HttpsBlobHealth> {
  const base = baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/health`, { headers: authHeaders(creds) });
  if (!res.ok) return { ok: false };
  try { return { ok: true, ...(await res.json()) }; } catch { return { ok: true }; }
}