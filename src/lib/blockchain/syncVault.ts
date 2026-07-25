/**
 * syncVault — per-peer local storage backed by sealed SWARM coins.
 * Read-through cache + verifier. Never introduces new transports.
 */
import { get, getAll, put, remove } from "@/lib/store";
import type { SwarmCoin } from "./types";
import {
  COIN_MAX_WEIGHT,
  MEDIA_COIN_CAPACITY_BYTES,
  MEDIA_COIN_SEAL_FRACTION,
} from "./types";

/**
 * Vault-usable predicate — any wallet-held coin that isn't already spent
 * can serve as a container. Vaults don't consume the coin, so the spend
 * guard doesn't apply.
 */
function isVaultUsable(coin: SwarmCoin): boolean {
  return coin.status === "wallet" && coin.fillState !== "spent";
}

export const VAULT_COIN_CAPACITY_BYTES = COIN_MAX_WEIGHT * 1024 * 1024;
export const VAULT_ROLLOVER_FRACTION = 0.8;

export type VaultCoinRole = "canonical" | "receiver" | "archive" | "media";

export interface VaultCoinRef {
  coinId: string;
  role: VaultCoinRole;
  fillBytes: number;
  capacityBytes: number;
  createdAt: string;
  sealed?: boolean;
  sealedAt?: string;
  wrapped?: boolean;
  wrappedBadge?: "archived";
  lastWrapAttemptAt?: string;
  /** Lifecycle phase for stuck-write detection. */
  phase?: "filling" | "encrypting" | "writing" | "sealed";
  /** True when this coin was sealed as a failed archive (never serves, never wraps). */
  failed?: boolean;
  /** Bumped on every recordVaultEntry / phase step. Drives stuck detection. */
  lastProgressAt?: string;
  /** Breadcrumb: original coin this ref was reallocated from after a stall. */
  stalledFromCoinId?: string;
}

export interface VaultIndexEntry {
  coinId: string;
  offset: number;
  length: number;
  mime?: string;
  storedAt: string;
  ref?: string;
  name?: string;
  pending?: boolean;
  firstSeenAt?: string;
  completedAt?: string;
  /** True when the underlying bytes aren't yet local — enrolment created a
   *  placeholder; seal is blocked until sync completes. */
  awaitingSync?: boolean;
}

export interface SyncVault {
  peerId: string;
  coins: VaultCoinRef[];
  index: Record<string, VaultIndexEntry>;
  hits: number;
  misses: number;
  updatedAt: string;
}

const STORE = "syncVaults";

export async function getVault(peerId: string): Promise<SyncVault | null> {
  const v = await get<SyncVault>(STORE, peerId);
  return v ?? null;
}

export async function listVaults(): Promise<SyncVault[]> {
  return getAll<SyncVault>(STORE);
}

export async function saveVault(v: SyncVault): Promise<void> {
  v.updatedAt = new Date().toISOString();
  await put(STORE, v);
}

export async function purgeVault(peerId: string): Promise<void> {
  await remove(STORE, peerId);
}

export async function ensureVault(peerId: string): Promise<SyncVault> {
  const existing = await getVault(peerId);
  if (existing) return existing;
  const fresh: SyncVault = {
    peerId,
    coins: [],
    index: {},
    hits: 0,
    misses: 0,
    updatedAt: new Date().toISOString(),
  };
  await saveVault(fresh);
  return fresh;
}

function activeReceiverCoin(v: SyncVault): VaultCoinRef | null {
  const receivers = v.coins.filter((c) => c.role === "receiver");
  for (let i = receivers.length - 1; i >= 0; i--) {
    const c = receivers[i];
    if (c.fillBytes / c.capacityBytes < VAULT_ROLLOVER_FRACTION) return c;
  }
  return null;
}

export async function ensureArchiveCoin(peerId: string): Promise<VaultCoinRef> {
  const vault = await ensureVault(peerId);
  const archiveId = `archive:${peerId}`;
  const existing = vault.coins.find((c) => c.coinId === archiveId);
  if (existing) return existing;
  const ref: VaultCoinRef = {
    coinId: archiveId,
    role: "archive",
    fillBytes: 0,
    capacityBytes: Number.POSITIVE_INFINITY,
    createdAt: new Date().toISOString(),
  };
  vault.coins.push(ref);
  await saveVault(vault);
  return ref;
}

// ── Media Coin (Sync Vault container) ──────────────────────────────────

/**
 * Active (unsealed) media coin ref for a vault, or null if none.
 * An "active" coin is any unsealed media coin — the caller decides
 * whether it still has room for the incoming file.
 */
function activeMediaCoin(v: SyncVault): VaultCoinRef | null {
  for (let i = v.coins.length - 1; i >= 0; i--) {
    const c = v.coins[i];
    if (c.role !== "media" || c.sealed) continue;
    return c;
  }
  return null;
}

/**
 * Enforce the "one filling coin per vault" invariant. Legacy vaults
 * (or races) can leave multiple unsealed media coins around; this
 * seals every unsealed media coin with content except the newest one
 * and drops any empty duplicates. Returns true if the vault changed.
 */
function consolidateUnsealedMediaCoins(v: SyncVault): boolean {
  const unsealed = v.coins.filter((c) => c.role === "media" && !c.sealed);
  if (unsealed.length <= 1) return false;
  // Keep the newest by createdAt as the sole "filling" coin.
  const sorted = [...unsealed].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
  const keep = sorted[sorted.length - 1];
  const drop = new Set<string>();
  const now = new Date().toISOString();
  for (const c of sorted) {
    if (c.coinId === keep.coinId) continue;
    if (c.fillBytes > 0) {
      c.sealed = true;
      c.sealedAt = c.sealedAt ?? now;
    } else {
      drop.add(c.coinId);
    }
  }
  if (drop.size) v.coins = v.coins.filter((c) => !drop.has(c.coinId));
  return true;
}

function allocateMediaCoinRef(vault: SyncVault, capacityBytes: number): VaultCoinRef {
  const idx = vault.coins.filter((c) => c.role === "media").length;
  const ref: VaultCoinRef = {
    coinId: `archive:media:${vault.peerId}:${idx}:${Date.now().toString(36)}`,
    role: "media",
    fillBytes: 0,
    capacityBytes,
    createdAt: new Date().toISOString(),
  };
  vault.coins.push(ref);
  return ref;
}

/**
 * Size-aware media coin allocator. Files are never split across coins:
 *
 *  - Oversized file (`size ≥ MEDIA_COIN_CAPACITY_BYTES`) → a fresh
 *    dedicated coin sized exactly to the file. Caller seals it after
 *    the entry is recorded.
 *  - Normal file → reuse the active unsealed coin if it can hold the
 *    file *without* crossing the seal threshold. If it can't, seal the
 *    current coin (leaving it below the seal line) and allocate a
 *    fresh one for this file.
 */
export async function getOrCreateMediaCoin(
  peerId: string,
  incomingBytes: number = 0,
): Promise<VaultCoinRef> {
  const vault = await ensureVault(peerId);
  // Repair invariant before doing anything else.
  consolidateUnsealedMediaCoins(vault);
  const size = Math.max(0, incomingBytes | 0);

  // Oversized single file gets its own dedicated coin.
  if (size >= MEDIA_COIN_CAPACITY_BYTES) {
    const ref = allocateMediaCoinRef(vault, size);
    await saveVault(vault);
    return ref;
  }

  const sealBytes = Math.floor(MEDIA_COIN_CAPACITY_BYTES * MEDIA_COIN_SEAL_FRACTION);
  const active = activeMediaCoin(vault);
  if (active) {
    // Fits without crossing seal line → reuse.
    if (active.fillBytes + size <= sealBytes) return active;
    // Would push the coin over the seal threshold: seal current (only
    // if it already carries content) and allocate a fresh coin for
    // this file. Sealing happens BEFORE the new engrave starts.
    if (active.fillBytes > 0) {
      active.sealed = true;
      active.sealedAt = new Date().toISOString();
    } else {
      // Empty active coin can't hold this file even at zero fill
      // (size > sealBytes). Drop it so we don't leave orphan refs.
      vault.coins = vault.coins.filter((c) => c.coinId !== active.coinId);
    }
  }

  const ref = allocateMediaCoinRef(vault, MEDIA_COIN_CAPACITY_BYTES);
  await saveVault(vault);
  return ref;
}

/**
 * One-shot cleanup callable from boot / UI refresh. Walks every vault
 * and enforces the single-filling-coin invariant. Safe to run often —
 * no-op when vaults are already clean.
 */
export async function reconcileMediaCoins(): Promise<number> {
  let changed = 0;
  for (const v of await listVaults()) {
    if (consolidateUnsealedMediaCoins(v)) {
      await saveVault(v);
      changed += 1;
    }
  }
  return changed;
}

/** Flip a media coin to sealed. Idempotent. */
export async function sealMediaCoin(peerId: string, coinId: string): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c || c.role !== "media" || c.sealed) return;
  c.sealed = true;
  c.sealedAt = new Date().toISOString();
  await saveVault(v);
}

/**
 * List every sealed-but-unwrapped media coin across all vaults. Used by
 * the wrap sweep to attempt promotion when the user gains SWARM.
 */
export async function listSealedMediaCoins(): Promise<Array<{ peerId: string; ref: VaultCoinRef }>> {
  const out: Array<{ peerId: string; ref: VaultCoinRef }> = [];
  for (const v of await listVaults()) {
    for (const c of v.coins) {
      if (c.role === "media" && c.sealed && !c.wrapped && !c.failed) out.push({ peerId: v.peerId, ref: c });
    }
  }
  return out;
}

/**
 * Wrap a sealed media coin against a free wallet coin. Marks the wallet
 * coin `kind: "media"` (so it leaves the fungible pool/market/wallet),
 * rewrites the vault entries to point at the new coinId, and if the
 * source was the global archive it earns an `archived` badge.
 */
export async function attemptWrapMediaCoin(
  peerId: string,
  coinId: string,
  freeWalletCoin: SwarmCoin,
): Promise<boolean> {
  const vault = await getVault(peerId);
  if (!vault) return false;
  const ref = vault.coins.find((c) => c.coinId === coinId);
  if (!ref || ref.role !== "media" || !ref.sealed || ref.wrapped || ref.failed) return false;

  // Rewrite every entry that lived on the virtual media coin.
  const contentHashes: string[] = [];
  for (const [hash, entry] of Object.entries(vault.index)) {
    if (entry.coinId !== coinId) continue;
    vault.index[hash] = { ...entry, coinId: freeWalletCoin.coinId, pending: false };
    contentHashes.push(hash);
  }

  // Rename the ref (keep sealed/fill/etc), stamp wrap metadata.
  ref.coinId = freeWalletCoin.coinId;
  ref.wrapped = true;
  ref.lastWrapAttemptAt = new Date().toISOString();
  if (peerId.startsWith("archive:")) ref.wrappedBadge = "archived";
  await saveVault(vault);

  // Engrave the underlying SwarmCoin so guards exclude it everywhere.
  freeWalletCoin.kind = "media";
  freeWalletCoin.sealBytes = ref.fillBytes;
  freeWalletCoin.mediaCapacityBytes = ref.capacityBytes;
  freeWalletCoin.mediaTargets = [{ peerId, contentHashes }];
  await put("swarmCoins", freeWalletCoin);
  return true;
}

/** Stamp a wrap attempt as "tried, insufficient" so the 24h cooldown starts. */
export async function markWrapAttempt(peerId: string, coinId: string): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c) return;
  c.lastWrapAttemptAt = new Date().toISOString();
  await saveVault(v);
}

/**
 * Move every entry currently sitting on an `archive:*` coin onto a real
 * receiver coin (allocating/rolling as needed). Returns count promoted.
 */
export async function promoteArchivedEntries(
  peerId: string,
  candidateCoins: SwarmCoin[],
): Promise<number> {
  const vault = await getVault(peerId);
  if (!vault) return 0;
  let promoted = 0;
  for (const [hash, entry] of Object.entries(vault.index)) {
    if (!entry.coinId.startsWith("archive:")) continue;
    const receiver = await getOrRolloverReceiverCoin(peerId, candidateCoins);
    if (!receiver) break;
    // Re-read (getOrRolloverReceiverCoin may have mutated vault)
    const fresh = (await getVault(peerId)) ?? vault;
    fresh.index[hash] = {
      ...entry,
      coinId: receiver.coinId,
      offset: receiver.fillBytes,
      pending: false,
    };
    const coin = fresh.coins.find((c) => c.coinId === receiver.coinId);
    if (coin) coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + (entry.length || 0));
    await saveVault(fresh);
    promoted += 1;
  }
  return promoted;
}

export async function allocateVaultCoin(
  peerId: string,
  role: VaultCoinRole,
  candidateCoins: SwarmCoin[],
): Promise<VaultCoinRef | null> {
  const vault = await ensureVault(peerId);
  const taken = new Set(
    (await listVaults()).flatMap((v) => v.coins.map((c) => c.coinId)),
  );
  const pick = candidateCoins.find((c) => isVaultUsable(c) && !taken.has(c.coinId));
  if (!pick) return null;
  const ref: VaultCoinRef = {
    coinId: pick.coinId,
    role,
    fillBytes: 0,
    capacityBytes: VAULT_COIN_CAPACITY_BYTES,
    createdAt: new Date().toISOString(),
  };
  vault.coins.push(ref);
  await saveVault(vault);
  return ref;
}

export async function getOrRolloverReceiverCoin(
  peerId: string,
  candidateCoins: SwarmCoin[],
): Promise<VaultCoinRef | null> {
  const vault = await ensureVault(peerId);
  const active = activeReceiverCoin(vault);
  if (active) return active;
  return allocateVaultCoin(peerId, "receiver", candidateCoins);
}

export async function recordVaultEntry(
  peerId: string,
  contentHash: string,
  entry: Omit<VaultIndexEntry, "storedAt">,
): Promise<void> {
  const vault = await ensureVault(peerId);
  vault.index[contentHash] = { ...entry, storedAt: new Date().toISOString() };
  const coin = vault.coins.find((c) => c.coinId === entry.coinId);
  if (coin) {
    coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + entry.length);
    coin.lastProgressAt = new Date().toISOString();
    if (!coin.phase && coin.role === "media" && !coin.sealed) coin.phase = "filling";
  }
  await saveVault(vault);
}

export async function findVaultEntry(
  contentHash: string,
): Promise<{ vault: SyncVault; entry: VaultIndexEntry } | null> {
  const vaults = await listVaults();
  for (const v of vaults) {
    const entry = v.index[contentHash];
    if (entry) return { vault: v, entry };
  }
  return null;
}

export async function bumpVaultCounter(
  peerId: string,
  kind: "hit" | "miss",
): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  if (kind === "hit") v.hits += 1;
  else v.misses += 1;
  await saveVault(v);
}