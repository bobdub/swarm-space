/**
 * S3-compatible adapter — AWS S3, Cloudflare R2, Backblaze B2, MinIO.
 *
 * Two modes:
 *   1. signed-url: caller obtains a pre-signed URL (e.g. via the Lovable
 *      AWS S3 connector's /api/v1/sign_storage_url edge function) and we
 *      simply PUT/GET that URL. Bucket can stay private.
 *   2. direct-sigv4: caller supplies endpoint + region + access key + secret
 *      key + bucket; we sign requests in-browser with Web Crypto (no Node
 *      polyfill). Used for R2/B2/MinIO when no connector is available.
 *
 * Object key layout: imagination/<userId>/chunks/<hash>
 */

export interface S3DirectCreds {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3DirectConfig {
  endpoint: string;   // e.g. https://<account>.r2.cloudflarestorage.com
  region: string;     // e.g. auto | us-east-1
  bucket: string;
  userId: string;
}

export function s3ChunkKey(userId: string, hash: string): string {
  return `imagination/${userId}/chunks/${hash}`;
}

// ─── SigV4 helpers (Web Crypto, no deps) ──────────────────────────────

const enc = new TextEncoder();

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data).buffer : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
}

async function deriveSigningKey(
  secret: string, dateStamp: string, region: string, service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, 'aws4_request');
}

function amzDate(d = new Date()): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amz: iso, date: iso.slice(0, 8) };
}

interface SignedRequest { url: string; headers: Record<string, string>; }

async function signS3(
  cfg: S3DirectConfig, creds: S3DirectCreds, method: string, key: string, body: ArrayBuffer | null,
): Promise<SignedRequest> {
  const endpoint = cfg.endpoint.replace(/\/$/, '');
  const host = new URL(endpoint).host;
  // Path-style: /<bucket>/<key>
  const path = `/${encodeURIComponent(cfg.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const { amz, date } = amzDate();
  const payloadHash = body ? await sha256Hex(body) : await sha256Hex('');

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest =
    `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amz}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await deriveSigningKey(creds.secretAccessKey, date, cfg.region, 's3');
  const signature = hex(new Uint8Array(await hmac(signingKey, stringToSign)));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${endpoint}${path}`,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      Authorization: authorization,
    },
  };
}

// ─── Public API: direct SigV4 ─────────────────────────────────────────

export async function s3DirectPut(
  cfg: S3DirectConfig, creds: S3DirectCreds, hash: string, body: ArrayBuffer,
): Promise<void> {
  const key = s3ChunkKey(cfg.userId, hash);
  const req = await signS3(cfg, creds, 'PUT', key, body);
  const res = await fetch(req.url, {
    method: 'PUT',
    headers: { ...req.headers, 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!res.ok) throw new Error(`S3 PUT failed: ${res.status} ${await res.text().catch(() => '')}`);
}

export async function s3DirectGet(
  cfg: S3DirectConfig, creds: S3DirectCreds, hash: string,
): Promise<ArrayBuffer | null> {
  const key = s3ChunkKey(cfg.userId, hash);
  const req = await signS3(cfg, creds, 'GET', key, null);
  const res = await fetch(req.url, { headers: req.headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 GET failed: ${res.status}`);
  return await res.arrayBuffer();
}

export async function s3DirectHead(
  cfg: S3DirectConfig, creds: S3DirectCreds, hash: string,
): Promise<boolean> {
  const key = s3ChunkKey(cfg.userId, hash);
  const req = await signS3(cfg, creds, 'HEAD', key, null);
  const res = await fetch(req.url, { method: 'HEAD', headers: req.headers });
  return res.ok;
}

export async function s3DirectDelete(
  cfg: S3DirectConfig, creds: S3DirectCreds, hash: string,
): Promise<void> {
  const key = s3ChunkKey(cfg.userId, hash);
  const req = await signS3(cfg, creds, 'DELETE', key, null);
  const res = await fetch(req.url, { method: 'DELETE', headers: req.headers });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`S3 DELETE failed: ${res.status}`);
  }
}