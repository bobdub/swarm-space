// Local authentication and identity management

import { genIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey, computeUserId } from "./crypto";
import { put, get } from "./store";

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
  };
}

export interface WrappedKey {
  wrapped: string;
  salt: string | null;
  iv: string | null;
  rawStored?: boolean;
}

// Create new local account
export async function createLocalAccount(
  username: string,
  displayName: string,
  passphrase?: string
): Promise<UserMeta> {
  const keys = await genIdentityKeyPair();
  let wrapped: WrappedKey;
  
  if (passphrase) {
    wrapped = await wrapPrivateKey(keys.privateKey, passphrase);
  } else {
    // Store raw but still in wrapped format for consistency
    wrapped = {
      wrapped: keys.privateKey,
      salt: null,
      iv: null,
      rawStored: true,
    };
  }
  
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
    return wrapped.wrapped;
  }
  
  if (!passphrase) {
    throw new Error("Passphrase required");
  }
  
  return await unwrapPrivateKey(wrapped, passphrase);
}

// Logout
export function logoutUser() {
  localStorage.removeItem("me");
  // Could also clear session keys from memory
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
