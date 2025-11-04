// Local authentication and identity management

import { genIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey, computeUserId } from "./crypto";
import { put, get, getAll } from "./store";
import { awardGenesisCredits } from "./credits";

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

const UNWRAPPED_KEY_SESSION_KEY = "me:privateKey";

function cacheUnlockedPrivateKey(privateKey: string) {
  try {
    window.sessionStorage.setItem(UNWRAPPED_KEY_SESSION_KEY, privateKey);
  } catch (error) {
    console.warn("[auth] Unable to cache unlocked private key", error);
  }
}

function clearUnlockedPrivateKeyCache() {
  try {
    window.sessionStorage.removeItem(UNWRAPPED_KEY_SESSION_KEY);
  } catch (error) {
    console.warn("[auth] Unable to clear unlocked private key cache", error);
  }
}

// Helper to log consistent auth errors
function logAuthError(message: string, error: unknown) {
  console.error(`[auth] ${message}`, error);
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
  
  // Award genesis credits
  await awardGenesisCredits(userId);
  
  // Notify other components about login
  window.dispatchEvent(new Event("user-login"));

  cacheUnlockedPrivateKey(keys.privateKey);

  return userMeta;
}

// Get current logged in user
export function getCurrentUser(): UserMeta | null {
  const stored = localStorage.getItem("me");
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Login (unwrap keys)
export async function loginUser(passphrase?: string): Promise<string | null> {
  const user = getCurrentUser();
  if (!user) return null;

  const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
  if (!wrappedData) return null;

  const wrapped = wrappedData.v;

  if (wrapped.rawStored) {
    // No passphrase needed
    cacheUnlockedPrivateKey(wrapped.wrapped);
    return wrapped.wrapped;
  }

  if (!passphrase) {
    throw new Error("Passphrase required");
  }

  const privateKey = await unwrapPrivateKey(wrapped, passphrase);
  cacheUnlockedPrivateKey(privateKey);
  return privateKey;
}

// Logout
export function logoutUser() {
  localStorage.removeItem("me");
  clearUnlockedPrivateKeyCache();
  // Notify other components about logout
  window.dispatchEvent(new Event("user-logout"));
  // Could also clear session keys from memory
}

// List locally stored accounts (from IndexedDB)
function isLocalAccountMeta(entry: unknown): entry is UserMeta {
  if (!entry || typeof entry !== "object") {
    return false;
  }

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
    if (!match) {
      return null;
    }

    if (!match.wrappedKeyRef) {
      logAuthError(
        "Attempted to restore account without wrapped key metadata",
        new Error(`Missing wrappedKeyRef for ${userId}`)
      );
      return null;
    }

    localStorage.setItem("me", JSON.stringify(match));
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
  
  return userMeta;
}
