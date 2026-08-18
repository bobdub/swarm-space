import { get, put, remove } from '@/lib/store';

const DEVICE_KEY_ID = 'device-key:v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface DeviceKeyRecord {
  id: string;
  key: CryptoKey;
}

interface CredentialRecord {
  id: string;
  userId: string;
  serverId: string;
  iv: string;
  ciphertext: string;
  version: 1;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function credentialId(userId: string, serverId: string): string {
  return `credential:${userId}:${serverId}`;
}

function additionalData(userId: string, serverId: string): Uint8Array {
  return encoder.encode(`personal-server:v1:${userId}:${serverId}`);
}

async function getDeviceKey(): Promise<CryptoKey> {
  const existing = await get<DeviceKeyRecord>('personalServerSecrets', DEVICE_KEY_ID);
  if (existing?.key) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  await put<DeviceKeyRecord>('personalServerSecrets', { id: DEVICE_KEY_ID, key });
  return key;
}

export async function persistPersonalServerCredentials(
  userId: string,
  serverId: string,
  credentials: Record<string, string>,
): Promise<void> {
  if (!userId) throw new Error('Sign in before linking a personal server.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(additionalData(userId, serverId)) },
    await getDeviceKey(),
    encoder.encode(JSON.stringify(credentials)),
  );
  await put<CredentialRecord>('personalServerSecrets', {
    id: credentialId(userId, serverId),
    userId,
    serverId,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    version: 1,
  });
}

export async function readPersonalServerCredentials(
  userId: string,
  serverId: string,
): Promise<Record<string, string> | null> {
  const record = await get<CredentialRecord>('personalServerSecrets', credentialId(userId, serverId));
  if (!record || record.userId !== userId || record.serverId !== serverId) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: asArrayBuffer(fromBase64(record.iv)),
        additionalData: asArrayBuffer(additionalData(userId, serverId)),
      },
      await getDeviceKey(),
      asArrayBuffer(fromBase64(record.ciphertext)),
    );
    const parsed: unknown = JSON.parse(decoder.decode(plaintext));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : null;
  } catch {
    return null;
  }
}

export async function removePersonalServerCredentials(userId: string, serverId: string): Promise<void> {
  await remove('personalServerSecrets', credentialId(userId, serverId));
}

export async function hasPersonalServerCredentials(userId: string, serverId: string): Promise<boolean> {
  return (await readPersonalServerCredentials(userId, serverId)) !== null;
}