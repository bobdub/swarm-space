import { describe, expect, it } from 'vitest';
import { isLocalHostname } from '../adapters/netError';
import { isUrlAcceptable, isLocalServerUrl } from '../personalServerStore';
import { s3PublicChunkKey, s3PublicChunkUrl } from '../adapters/s3Compatible';

describe('personal server URL rules', () => {
  it('accepts HTTPS anywhere', () => {
    expect(isUrlAcceptable('https://store.example.com').ok).toBe(true);
  });

  it('accepts plain HTTP for local and private addresses', () => {
    for (const url of [
      'http://localhost:7777',
      'http://127.0.0.1:7777',
      'http://my-desktop.local:7777',
      'http://192.168.1.20:7777',
      'http://10.0.0.5:9000',
      'http://172.20.3.4:9000',
    ]) {
      expect(isUrlAcceptable(url), url).toEqual({ ok: true });
      expect(isLocalServerUrl(url), url).toBe(true);
    }
  });

  it('rejects plain HTTP for public addresses', () => {
    expect(isUrlAcceptable('http://store.example.com').ok).toBe(false);
    expect(isUrlAcceptable('http://172.32.0.1:9000').ok).toBe(false);
    expect(isLocalServerUrl('https://store.example.com')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isUrlAcceptable('not a url').ok).toBe(false);
  });

  it('classifies hostnames', () => {
    expect(isLocalHostname('8.8.8.8')).toBe(false);
    expect(isLocalHostname('169.254.1.1')).toBe(true);
  });
});

describe('probe key derivation', () => {
  it('uses the SHA-256 of the payload as the object key', async () => {
    const body = new TextEncoder().encode('probe-body').buffer;
    const digest = await crypto.subtle.digest('SHA-256', body);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toHaveLength(64);
    // The public mirror key is derived from the same content hash.
    expect(s3PublicChunkKey(hex)).toBe(`imagination/public/chunks/${hex}`);
  });
});

describe('public mirror URLs', () => {
  it('builds a credential-free path-style URL', () => {
    expect(s3PublicChunkUrl('https://minio.example.com/', 'swarmspace', 'abc123'))
      .toBe('https://minio.example.com/swarmspace/imagination/public/chunks/abc123');
  });
});
