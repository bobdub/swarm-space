/**
 * vaultMigration — one-time index-only enroll of already-completed
 * torrents/files into per-peer Sync Vaults.
 *
 * Does NOT copy bytes: entries reference existing chunk/manifest storage.
 * Guarded by a sessionStorage flag so it runs at most once per session.
 */
import { enrollContent } from "./vaultEnroll";

const SESSION_FLAG = "vault-migration-v1-done";

export interface MigrationCandidate {
  contentHash: string;
  ownerPeerId: string; // "self" for local-owned
  isSelf: boolean;
  name: string;
  mime: string;
  size: number;
  ref: string;
}

export interface MigrationResult {
  enrolled: number;
  skipped: number;
  needsCoin: boolean;
}

export async function migrateCompletedIntoVaults(
  candidates: MigrationCandidate[],
): Promise<MigrationResult> {
  const result: MigrationResult = { enrolled: 0, skipped: 0, needsCoin: false };
  if (!candidates.length) return result;

  for (const c of candidates) {
    try {
      const outcome = await enrollContent(c);
      if (outcome === "enrolled") result.enrolled += 1;
      else if (outcome === "archived") { result.enrolled += 1; result.needsCoin = true; }
      else result.skipped += 1;
    } catch (err) {
      console.warn("[vaultMigration] skipped", c.contentHash, err);
      result.skipped += 1;
    }
  }
  return result;
}

export function migrationAlreadyRan(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === "1";
  } catch {
    return false;
  }
}

export function markMigrationRan(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    /* noop */
  }
}