// Local authentication and identity management

import { genIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey, computeUserId, arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";
import { put, get, getAll } from "./store";
import { awardGenesisCredits } from "./credits";
import { vault, type SealedValue } from "./crypto/memoryVault";
import { setFeatureFlag } from "../config/featureFlags";
import { updateConnectionState, type NetworkMode } from "./p2p/connectionState";

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

// ── Session flags ───────────────────────────────────────────────────────────
// `me` in localStorage is the fast session entry; `meta:lastActiveUserId` in
// IndexedDB is the durable marker; `session-signed-out` records an INTENTIONAL
// sign-out. All three are written through the helpers below so they can never
// drift apart.

const SIGNED_OUT_KEY = "session-signed-out";

/** True when the user deliberately signed out on this device. */
export function hasIntentionalSignOut(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) != null;
  } catch {
    return false;
  }
}

function setSignOutMarker(): void {
  try {
    localStorage.setItem(SIGNED_OUT_KEY, new Date().toISOString());
  } catch { /* ignore quota */ }
}

function clearSignOutMarker(): void {
  try {
    localStorage.removeItem(SIGNED_OUT_KEY);
  } catch { /* ignore */ }
}

/**
 * Single writer for "this account is now the active session".
 * Writes every session flag together and announces the login.
 */
async function activateSession(user: UserMeta, options: { announce?: boolean } = {}): Promise<void> {
  const { announce = true } = options;

  clearSignOutMarker();
  try {
    localStorage.setItem("me", JSON.stringify(user));
  } catch (error) {
    logAuthError("Failed to write session entry", error);
  }
  await setLastActiveUserId(user.id);
  if (announce) window.dispatchEvent(new Event("user-login"));
}

/**
 * Refresh the stored session entry after a profile edit. Keeps the fast
 * entry and the durable marker in step — callers must not write `me` directly.
 */
export async function updateActiveSessionUser(
  user: { id: string } & Partial<UserMeta>
): Promise<void> {
  const current = getCurrentUser();
  if (!current || current.id !== user.id) return;
  await activateSession({ ...current, ...user } as UserMeta, { announce: false });
}

export type SessionRestoreResult =

  | { status: "restored"; user: UserMeta }
  | { status: "none" }
  | { status: "unavailable"; reason: string };

/**
 * Attempt to resolve the session, distinguishing "no account on this device"
 * from "local storage could not be read right now" (blocked DB upgrade, Brave
 * shields, private mode). Callers must NOT treat `unavailable` as signed out.
 */
export async function restoreSessionAttempt(): Promise<SessionRestoreResult> {
  const current = getCurrentUser();
  if (current) return { status: "restored", user: current };

  if (hasIntentionalSignOut()) return { status: "none" };

  let accounts: UserMeta[];
  try {
    // Deliberately unguarded: a throw here means storage is unreadable.
    const stored = await getAll<UserMeta>("users");
    accounts = stored.filter(isLocalAccountMeta);
  } catch (error) {
    logAuthError("Session restore could not read local accounts", error);
    return { status: "unavailable", reason: (error as Error)?.name ?? "storage-error" };
  }

  if (accounts.length === 0) return { status: "none" };

  const lastId = await getLastActiveUserId();
  const match = lastId ? accounts.find((a) => a.id === lastId) : undefined;
  const chosen = match ?? (accounts.length === 1 ? accounts[0] : undefined);

  if (!chosen) {
    // Marker lost and several identities exist — we can't guess which one.
    return { status: "none" };
  }

  await activateSession(chosen);
  return { status: "restored", user: chosen };
}


// Create new local account
export async function createLocalAccount(
  username: string,
  displayName: string,
  passphrase: string,
  options: { networkMode?: NetworkMode } = {}
): Promise<UserMeta> {
  const normalizedPassphrase = passphrase.trim();
  if (!normalizedPassphrase) {
    throw new Error("Passphrase is required to secure the identity key");
  }

  const networkMode = options.networkMode === "builder" ? "builder" : "swarm";

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
  
  // Store user in users store for profile lookup
  await put("users", userMeta);

  // Write every session flag together (fast entry + durable marker) and
  // clear any prior intentional sign-out.
  await activateSession(userMeta, { announce: false });

  
  // Award genesis credits
  await awardGenesisCredits(userId);

  // Signup's "Offline Mode" is carried via networkMode === 'builder' for
  // backward compatibility with the wizard, but the persisted mode stays
  // 'swarm' — Builder is the User-Cell engine, not a boot mode.
  const startOffline = networkMode === "builder";
  updateConnectionState({
    enabled: !startOffline,
    mode: "swarm",
    lastConnectedAt: startOffline ? null : Date.now(),
  });
  setFeatureFlag("swarmMeshMode", true);
  
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
 * Back-compat wrapper over `restoreSessionAttempt`. Prefer the session store
 * (`src/lib/session/sessionStore.ts`) — this collapses "storage unavailable"
 * into `null`, which callers must not read as "signed out".
 */
export async function attemptSessionRestore(): Promise<UserMeta | null> {
  const result = await restoreSessionAttempt();
  return result.status === "restored" ? result.user : null;
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
  // Record that this sign-out was intentional so boot never silently
  // restores the session. Cleared by every sign-in path.
  setSignOutMarker();
  try { localStorage.removeItem("me"); } catch { /* ignore */ }
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

    await activateSession(match);
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
  await put("users", userMeta);
  await activateSession(userMeta);

  
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
  await put("users", userMeta);
  await awardGenesisCredits(userId);
  await cacheUnlockedPrivateKey(privateKeyBase64);
  await activateSession(userMeta);


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
