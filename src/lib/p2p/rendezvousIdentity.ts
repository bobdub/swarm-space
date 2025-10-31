import { arrayBufferToBase64, base64ToArrayBuffer } from '../crypto';
import { createEd25519Signer, type PresenceTicketSigner } from './presenceTicket';

const STORAGE_KEY = 'p2p-rendezvous-ed25519';
let ed25519Support: boolean | null = null;
let ed25519Probe: Promise<boolean> | null = null;

interface StoredIdentity {
  publicKey: string;
  privateKey: string;
  createdAt: number;
}

async function generateIdentity(): Promise<StoredIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  );

  const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const privateKey = arrayBufferToBase64(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));

  const stored: StoredIdentity = {
    publicKey,
    privateKey,
    createdAt: Date.now()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (error) {
    console.warn('[RendezvousIdentity] Failed to persist identity:', error);
  }

  return stored;
}

async function loadIdentity(): Promise<StoredIdentity> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return generateIdentity();
    }
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (!parsed.publicKey || !parsed.privateKey) {
      return generateIdentity();
    }
    return parsed;
  } catch (error) {
    console.warn('[RendezvousIdentity] Unable to load identity, regenerating:', error);
    return generateIdentity();
  }
}

export async function getRendezvousSigner(): Promise<PresenceTicketSigner> {
  const identity = await loadIdentity();
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(identity.privateKey),
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  return createEd25519Signer(privateKey, identity.publicKey);
}

export async function getRendezvousPublicKey(): Promise<string> {
  const identity = await loadIdentity();
  return identity.publicKey;
}

export async function probeEd25519Support(): Promise<boolean> {
  if (ed25519Support !== null) {
    return ed25519Support;
  }

  if (!ed25519Probe) {
    ed25519Probe = (async () => {
      if (typeof crypto === 'undefined' || !crypto.subtle?.generateKey) {
        ed25519Support = false;
        return false;
      }

      try {
        await crypto.subtle.generateKey(
          { name: 'Ed25519', namedCurve: 'Ed25519' },
          false,
          ['sign', 'verify']
        );
        ed25519Support = true;
        return true;
      } catch {
        ed25519Support = false;
        return false;
      }
    })();
  }

  return ed25519Probe;
}
