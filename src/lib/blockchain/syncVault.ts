/**
 * syncVault — per-peer local storage backed by sealed SWARM coins.
 * Read-through cache + verifier. Never introduces new transports.
 */
import { get, getAll, put, remove } from "@/lib/store";
import type { SwarmCoin } from "./types";
import {
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

export type VaultCoinRole = "canonical" | "media";
export type VaultSealReason =
  | "pre-engrave-rollover"
  | "oversized-complete"
  | "completed-stall"
  | "reconcile"
  | "manual"
  | "failed-stall";

export interface VaultCoinRef {
  coinId: string;
  role: VaultCoinRole;
  fillBytes: number;
  capacityBytes: number;
  createdAt: string;
  sealed?: boolean;
  sealedAt?: string;
  /** When seal was first requested; sealing itself is metadata-only. */
  sealRequestedAt?: string;
  /** Why this coin became sealed; used to recover jammed large-file writes. */
  sealReason?: VaultSealReason;
  /** Optional extra wallet coin attached during wrap for oversized payload pressure. */
  sealAssistedByCoinId?: string;
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

function safeByteSize(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.floor(bytes);
}

function stampSeal(ref: VaultCoinRef, reason: VaultSealReason, now: string): void {
  ref.sealRequestedAt = ref.sealRequestedAt ?? now;
  ref.sealReason = ref.sealReason ?? reason;
  ref.sealed = true;
  ref.phase = "sealed";
  ref.sealedAt = ref.sealedAt ?? now;
  ref.lastProgressAt = now;
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
      stampSeal(c, "reconcile", now);
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
  const repaired = consolidateUnsealedMediaCoins(vault);
  const size = safeByteSize(incomingBytes);

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
    if (active.fillBytes + size <= sealBytes) {
      if (repaired) await saveVault(vault);
      return active;
    }
    // Would push the coin over the seal threshold: seal current (only
    // if it already carries content) and allocate a fresh coin for
    // this file. Sealing happens BEFORE the new engrave starts.
    if (active.fillBytes > 0) {
      stampSeal(active, "pre-engrave-rollover", new Date().toISOString());
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
export async function sealMediaCoin(
  peerId: string,
  coinId: string,
  reason: VaultSealReason = "manual",
): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c || c.role !== "media") return;
  const now = new Date().toISOString();
  stampSeal(c, reason, now);
  await saveVault(v);
}

/**
 * Force-seal a completed media coin after bytes have already been recorded.
 * This is the safe recovery path for large files: it never detaches entries,
 * never adds bytes to a full coin, and only succeeds when recorded entries are
 * locally complete enough to serve or fall back through the existing chunk path.
 */
export async function forceSealCompletedMediaCoin(
  peerId: string,
  coinId: string,
  reason: Extract<VaultSealReason, "oversized-complete" | "completed-stall">,
): Promise<boolean> {
  const v = await getVault(peerId);
  if (!v) return false;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c || c.role !== "media" || c.failed) return false;
  const entries = Object.values(v.index).filter((entry) => entry.coinId === coinId);
  if (entries.length === 0) return false;
  const complete = entries.every((entry) => !entry.awaitingSync && (Boolean(entry.completedAt) || entry.length > 0));
  if (!complete) return false;
  stampSeal(c, reason, new Date().toISOString());
  await saveVault(v);
  return true;
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
  sealAssistCoin?: SwarmCoin,
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
  if (sealAssistCoin) ref.sealAssistedByCoinId = sealAssistCoin.coinId;
  if (peerId.startsWith("archive:")) ref.wrappedBadge = "archived";
  await saveVault(vault);

  // Engrave the underlying SwarmCoin so guards exclude it everywhere.
  freeWalletCoin.kind = "media";
  freeWalletCoin.sealBytes = ref.fillBytes;
  freeWalletCoin.mediaCapacityBytes = ref.capacityBytes;
  freeWalletCoin.mediaTargets = [{ peerId, contentHashes }];
  freeWalletCoin.mediaRole = "primary";
  if (sealAssistCoin) freeWalletCoin.mediaAssistCoinIds = [sealAssistCoin.coinId];
  await put("swarmCoins", freeWalletCoin);
  if (sealAssistCoin) {
    sealAssistCoin.kind = "media";
    sealAssistCoin.sealBytes = 0;
    sealAssistCoin.mediaCapacityBytes = 0;
    sealAssistCoin.mediaTargets = [{ peerId, contentHashes }];
    sealAssistCoin.mediaRole = "seal-assist";
    sealAssistCoin.mediaPrimaryCoinId = freeWalletCoin.coinId;
    await put("swarmCoins", sealAssistCoin);
  }
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

// ── Phase / stuck-write helpers ────────────────────────────────────────

export async function markCoinPhase(
  peerId: string,
  coinId: string,
  phase: NonNullable<VaultCoinRef["phase"]>,
): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c || c.role !== "media") return;
  c.phase = phase;
  c.lastProgressAt = new Date().toISOString();
  if (phase === "sealed" && !c.sealed) {
    stampSeal(c, "manual", c.lastProgressAt);
  }
  await saveVault(v);
}

/**
 * Seal a media coin as an immutable failed archive. Never wraps, never
 * serves; kept for auditing.
 */
export async function markCoinFailed(peerId: string, coinId: string): Promise<void> {
  const v = await getVault(peerId);
  if (!v) return;
  const c = v.coins.find((x) => x.coinId === coinId);
  if (!c || c.role !== "media" || c.wrapped) return;
  c.failed = true;
  stampSeal(c, "failed-stall", new Date().toISOString());
  await saveVault(v);
}

/**
 * Detach every entry that currently points at coinId, returning them so
 * the caller can requeue enrolment onto a fresh coin. Entries are removed
 * from the vault index (breadcrumbs live on the failed ref via `stalledFromCoinId`).
 */
export async function detachEntriesFromCoin(
  peerId: string,
  coinId: string,
): Promise<Array<{ contentHash: string; entry: VaultIndexEntry }>> {
  const v = await getVault(peerId);
  if (!v) return [];
  const detached: Array<{ contentHash: string; entry: VaultIndexEntry }> = [];
  for (const [hash, entry] of Object.entries(v.index)) {
    if (entry.coinId !== coinId) continue;
    detached.push({ contentHash: hash, entry });
    delete v.index[hash];
  }
  if (detached.length) await saveVault(v);
  return detached;
}

/**
 * List every unsealed media coin across all vaults for stuck detection.
 */
export async function listUnsealedMediaCoins(): Promise<Array<{ peerId: string; ref: VaultCoinRef }>> {
  const out: Array<{ peerId: string; ref: VaultCoinRef }> = [];
  for (const v of await listVaults()) {
    for (const c of v.coins) {
      if (c.role === "media" && !c.sealed && !c.failed) out.push({ peerId: v.peerId, ref: c });
    }
  }
  return out;
}

/**
 * Boot-time repair for pre-pipeline vaults. Coerces legacy
 * `receiver` / `archive` coin refs into sealed `media` refs so their
 * entries keep serving, and drops empty legacy refs.
 */
export async function reconcileLegacyVaultCoins(): Promise<number> {
  let changed = 0;
  for (const v of await listVaults()) {
    let dirty = false;
    const keep: VaultCoinRef[] = [];
    for (const c of v.coins) {
      const role = c.role as string;
      if (role !== "receiver" && role !== "archive") {
        keep.push(c);
        continue;
      }
      const hasEntries = Object.values(v.index).some((e) => e.coinId === c.coinId);
      if (!hasEntries) { dirty = true; continue; }
      const coerced: VaultCoinRef = { ...c, role: "media" };
      const cap = Number.isFinite(coerced.capacityBytes) && coerced.capacityBytes > 0
        ? coerced.capacityBytes
        : MEDIA_COIN_CAPACITY_BYTES;
      coerced.capacityBytes = cap;
      stampSeal(coerced, "reconcile", new Date().toISOString());
      keep.push(coerced);
      dirty = true;
    }
    if (dirty) {
      v.coins = keep;
      await saveVault(v);
      changed += 1;
    }
  }
  return changed;
}

// isVaultUsable retained for potential future allocators that pick
// wallet coins directly (wrap sweep uses its own filter today).
void isVaultUsable;

export async function recordVaultEntry(
  peerId: string,
  contentHash: string,
  entry: Omit<VaultIndexEntry, "storedAt">,
): Promise<void> {
  const vault = await ensureVault(peerId);
  vault.index[contentHash] = { ...entry, storedAt: new Date().toISOString() };
  const coin = vault.coins.find((c) => c.coinId === entry.coinId);
  if (coin) {
    coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + safeByteSize(entry.length));
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