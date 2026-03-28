// Local authentication and identity management

import { genIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey, computeUserId, arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";
import { put, get, getAll } from "./store";
import { awardGenesisCredits } from "./credits";
import { vault, type SealedValue } from "./crypto/memoryVault";

export interface UserMeta {
  id: string;
  username: string;
  displayName?: string;
  publicKey: string;
  wrappedKeyRef: string;
  createdAt: string;
  profile?: {
    bio?: string;
    avatarRef?: string;
    bannerRef?: string;
  };
}

export interface WrappedKey {
  wrapped: string;
  salt: string | null;
  iv: string | null;
  rawStored?: boolean;
}

const LAST_ACTIVE_META_KEY = "meta:lastActiveUserId";

/** In-memory vault-sealed private key (never stored as plaintext in heap) */
let sealedPrivateKey: SealedValue | null = null;

async function cacheUnlockedPrivateKey(privateKey: string) {
  try {
    sealedPrivateKey = await vault.seal(privateKey);
  } catch (error) {
    console.warn("[auth] Unable to vault-seal private key", error);
  }
}

function clearUnlockedPrivateKeyCache() {
  sealedPrivateKey = null;
}

/**
 * Retrieve the cached private key by unsealing from the vault.
 * Returns null if no key is cached.
 */
export async function getCachedPrivateKey(): Promise<string | null> {
  if (!sealedPrivateKey) return null;
  try {
    return await vault.unseal(sealedPrivateKey);
  } catch (error) {
    console.warn("[auth] Failed to unseal cached private key", error);
    return null;
  }
}

function logAuthError(message: string, error: unknown) {
  console.error(`[auth] ${message}`, error);
}

/**
 * Persist the last active user ID into IndexedDB so we can recover
 * even when localStorage is wiped (cache clear, Brave Shields, etc.)
 */
async function setLastActiveUserId(userId: string | null): Promise<void> {
  try {
    await put("meta", { k: LAST_ACTIVE_META_KEY, v: userId });
  } catch (error) {
    console.warn("[auth] Failed to persist lastActiveUserId", error);
  }
}

async function getLastActiveUserId(): Promise<string | null> {
  try {
    const entry = await get<{ k: string; v: string | null }>("meta", LAST_ACTIVE_META_KEY);
    return entry?.v ?? null;
  } catch {
    return null;
  }
}

// Create new local account
export async function createLocalAccount(
  username: string,
  displayName: string,
  passphrase: string
): Promise<UserMeta> {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error("Passphrase is required to secure the identity key");
  }

  const keys = await genIdentityKeyPair();
  const wrapped = await wrapPrivateKey(keys.privateKey, normalizedPassphrase);
  
  const userId = await computeUserId(keys.publicKey);
  const wrappedKeyRef = `meta:wrappedKey:${userId}`;
  
  const userMeta: UserMeta = {
    id: userId,
    username,
    displayName,
    publicKey: keys.publicKey,
    wrappedKeyRef,
    createdAt: new Date().toISOString(),
  };
  
  // Store wrapped key in IndexedDB
  await put("meta", { k: wrappedKeyRef, v: wrapped });
  
  // Store user meta in localStorage for quick access
  localStorage.setItem("me", JSON.stringify(userMeta));
  
  // Store user in users store for profile lookup
  await put("users", userMeta);

  // Track as last active user (survives localStorage wipes)
  await setLastActiveUserId(userId);
  
  // Award genesis credits
  await awardGenesisCredits(userId);
  
  // Notify other components about login
  window.dispatchEvent(new Event("user-login"));

  await cacheUnlockedPrivateKey(keys.privateKey);

  return userMeta;
}

// Get current logged in user from localStorage (fast, synchronous)
export function getCurrentUser(): UserMeta | null {
  const stored = localStorage.getItem("me");
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Attempt to restore a session from IndexedDB when localStorage is empty.
 * Called on app boot by useAuth.  Returns the restored user or null.
 *
 * Strategy:
 *  1. If localStorage already has "me", return that user.
 *  2. Look up lastActiveUserId in IndexedDB.
 *  3. If found, restore that account into localStorage.
 *  4. If not found but exactly one account exists, restore it.
 */
export async function attemptSessionRestore(): Promise<UserMeta | null> {
  // Fast path — localStorage intact
  const current = getCurrentUser();
  if (current) return current;

  try {
    // Check IndexedDB for last active user
    const lastId = await getLastActiveUserId();
    if (lastId) {
      const accounts = await getStoredAccounts();
      const match = accounts.find(a => a.id === lastId);
      if (match) {
        localStorage.setItem("me", JSON.stringify(match));
        window.dispatchEvent(new Event("user-login"));
        return match;
      }
    }

    // Fallback: if only one identity exists, use it
    const accounts = await getStoredAccounts();
    if (accounts.length === 1) {
      localStorage.setItem("me", JSON.stringify(accounts[0]));
      await setLastActiveUserId(accounts[0].id);
      window.dispatchEvent(new Event("user-login"));
      return accounts[0];
    }
  } catch (error) {
    logAuthError("Session restore from IndexedDB failed", error);
  }

  return null;
}

// Login (unwrap keys)
export async function loginUser(passphrase?: string): Promise<string | null> {
  const user = getCurrentUser();
  if (!user) return null;

  const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
  if (!wrappedData) return null;

  const wrapped = wrappedData.v;

  if (wrapped.rawStored) {
    await cacheUnlockedPrivateKey(wrapped.wrapped);
    return wrapped.wrapped;
  }

  if (!passphrase) {
    throw new Error("Passphrase required");
  }

  const privateKey = await unwrapPrivateKey(wrapped, passphrase);
  await cacheUnlockedPrivateKey(privateKey);
  return privateKey;
}

// Logout
export function logoutUser() {
  localStorage.removeItem("me");
  clearUnlockedPrivateKeyCache();
  // Don't clear lastActiveUserId — we want to remember for next restore
  window.dispatchEvent(new Event("user-logout"));
}

// List locally stored accounts (from IndexedDB)
function isLocalAccountMeta(entry: unknown): entry is UserMeta {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<UserMeta>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.publicKey === "string" &&
    typeof candidate.wrappedKeyRef === "string" &&
    candidate.wrappedKeyRef.length > 0 &&
    typeof candidate.createdAt === "string"
  );
}

export async function getStoredAccounts(): Promise<UserMeta[]> {
  try {
    const stored = await getAll<UserMeta>("users");
    return stored.filter(isLocalAccountMeta);
  } catch (error) {
    logAuthError("Failed to load stored accounts", error);
    return [];
  }
}

// Restore a local account into active session
export async function restoreLocalAccount(userId: string): Promise<UserMeta | null> {
  try {
    const storedAccounts = await getStoredAccounts();
    const match = storedAccounts.find((account) => account.id === userId);
    if (!match) return null;

    if (!match.wrappedKeyRef) {
      logAuthError(
        "Attempted to restore account without wrapped key metadata",
        new Error(`Missing wrappedKeyRef for ${userId}`)
      );
      return null;
    }

    localStorage.setItem("me", JSON.stringify(match));
    await setLastActiveUserId(userId);
    window.dispatchEvent(new Event("user-login"));
    return match;
  } catch (error) {
    logAuthError("Failed to restore local account", error);
    return null;
  }
}

// Export backup
export async function exportAccountBackup(): Promise<string> {
  const user = getCurrentUser();
  if (!user) throw new Error("No user logged in");
  
  const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
  if (!wrappedData) throw new Error("Key data not found");
  
  const backup = {
    version: 1,
    user,
    wrappedKey: wrappedData.v,
    exportedAt: new Date().toISOString(),
  };
  
  return JSON.stringify(backup);
}

// Import backup
export async function importAccountBackup(backupJson: string): Promise<UserMeta> {
  const backup = JSON.parse(backupJson);
  
  if (backup.version !== 1) {
    throw new Error("Unsupported backup version");
  }
  
  const userMeta: UserMeta = backup.user;
  
  // Store wrapped key
  await put("meta", { k: userMeta.wrappedKeyRef, v: backup.wrappedKey });
  
  // Store user meta
  localStorage.setItem("me", JSON.stringify(userMeta));
  await put("users", userMeta);
  await setLastActiveUserId(userMeta.id);
  
  return userMeta;
}

// Recovery: Import account from private key (Stage One)
export async function recoverAccountFromPrivateKey(
  privateKeyBase64: string,
  passphrase: string
): Promise<UserMeta> {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error("Passphrase is required to secure the recovered key");
  }

  const privateKeyBuffer = await crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(privateKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", privateKeyBuffer);
  
  const publicKeyImported = await crypto.subtle.importKey(
    "jwk",
    {
      kty: publicKeyJwk.kty,
      crv: publicKeyJwk.crv,
      x: publicKeyJwk.x,
      y: publicKeyJwk.y,
      key_ops: ["deriveBits"],
      ext: true,
    },
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", publicKeyImported);
  const publicKeyBase64 = arrayBufferToBase64(publicKeyRaw);

  const userId = await computeUserId(publicKeyBase64);

  const wrapped = await wrapPrivateKey(privateKeyBase64, normalizedPassphrase);
  const wrappedKeyRef = `meta:wrappedKey:${userId}`;

  const userMeta: UserMeta = {
    id: userId,
    username: `user_${userId.slice(0, 8)}`,
    displayName: `Recovered User`,
    publicKey: publicKeyBase64,
    wrappedKeyRef,
    createdAt: new Date().toISOString(),
  };

  await put("meta", { k: wrappedKeyRef, v: wrapped });
  localStorage.setItem("me", JSON.stringify(userMeta));
  await put("users", userMeta);
  await setLastActiveUserId(userId);
  await awardGenesisCredits(userId);
  cacheUnlockedPrivateKey(privateKeyBase64);
  window.dispatchEvent(new Event("user-login"));

  return userMeta;
}

// Export private key for recovery
export async function exportPrivateKey(passphrase: string): Promise<string> {
  const user = getCurrentUser();
  if (!user) throw new Error("No user logged in");

  const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
  if (!wrappedData) throw new Error("Key data not found");

  const wrapped = wrappedData.v;

  if (wrapped.rawStored) {
    return wrapped.wrapped;
  }

  if (!passphrase) {
    throw new Error("Passphrase required");
  }

  return await unwrapPrivateKey(wrapped, passphrase);
}
