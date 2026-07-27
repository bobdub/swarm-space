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
const vaultQueues = new Map<string, Promise<void>>();

async function withVaultQueue<T>(peerId: string, task: () => Promise<T>): Promise<T> {
  const previous = vaultQueues.get(peerId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  vaultQueues.set(peerId, queued);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (vaultQueues.get(peerId) === queued) vaultQueues.delete(peerId);
  }
}

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

async function saveVaultUnlocked(v: SyncVault): Promise<void> {
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
function normalizeMediaCapacity(ref: VaultCoinRef): boolean {
  if (ref.role !== "media") return false;
  if (!Number.isFinite(ref.capacityBytes) || ref.capacityBytes <= 0) {
    ref.capacityBytes = MEDIA_COIN_CAPACITY_BYTES;
    return true;
  }
  if (ref.capacityBytes < MEDIA_COIN_CAPACITY_BYTES) {
    ref.capacityBytes = MEDIA_COIN_CAPACITY_BYTES;
    return true;
  }
  return false;
}

function entriesForCoin(v: SyncVault, coinId: string): VaultIndexEntry[] {
  return Object.values(v.index).filter((entry) => entry.coinId === coinId);
}

function entriesAreComplete(entries: VaultIndexEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => !entry.awaitingSync && (Boolean(entry.completedAt) || entry.length > 0));
}

function reconcileVaultInMemory(v: SyncVault): boolean {
  let dirty = false;
  const keep: VaultCoinRef[] = [];
  const now = new Date().toISOString();

  for (const raw of v.coins) {
    const role = raw.role as string;
    const legacy = role === "receiver" || role === "archive";
    const ref: VaultCoinRef = legacy ? { ...raw, role: "media" } : raw;
    if (legacy) dirty = true;
    if (normalizeMediaCapacity(ref)) dirty = true;

    const entries = entriesForCoin(v, ref.coinId);
    if (ref.role === "media") {
      if (entries.length === 0 && !ref.sealed && !ref.wrapped) {
        dirty = true;
        continue;
      }
      if (legacy && entries.length > 0) {
        stampSeal(ref, "reconcile", now);
        dirty = true;
      }
      const sealBytes = Math.floor(ref.capacityBytes * MEDIA_COIN_SEAL_FRACTION);
      if (!ref.sealed && ref.fillBytes >= sealBytes && entriesAreComplete(entries)) {
        stampSeal(ref, "reconcile", now);
        dirty = true;
      }
    }
    keep.push(ref);
  }

  v.coins = keep;
  if (consolidateUnsealedMediaCoins(v)) dirty = true;
  return dirty;
}

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
  return withVaultQueue(peerId, async () => {
    const vault = await ensureVault(peerId);
    const repaired = reconcileVaultInMemory(vault);
    const size = safeByteSize(incomingBytes);

    if (size >= MEDIA_COIN_CAPACITY_BYTES) {
      const ref = allocateMediaCoinRef(vault, size);
      await saveVaultUnlocked(vault);
      return { ...ref };
    }

    const sealBytes = Math.floor(MEDIA_COIN_CAPACITY_BYTES * MEDIA_COIN_SEAL_FRACTION);
    const active = activeMediaCoin(vault);
    if (active) {
      if (active.fillBytes + size <= sealBytes) {
        if (repaired) await saveVaultUnlocked(vault);
        return { ...active };
      }
      if (active.fillBytes > 0) {
        stampSeal(active, "pre-engrave-rollover", new Date().toISOString());
      } else {
        vault.coins = vault.coins.filter((c) => c.coinId !== active.coinId);
      }
    }

    const ref = allocateMediaCoinRef(vault, MEDIA_COIN_CAPACITY_BYTES);
    await saveVaultUnlocked(vault);
    return { ...ref };
  });
}

export interface EnrollVaultEntryInput {
  contentHash: string;
  mime?: string;
  ref?: string;
  name?: string;
  size: number;
  completedAt?: string;
}

export async function enrollVaultEntry(
  peerId: string,
  input: EnrollVaultEntryInput,
): Promise<"skipped" | "enrolled"> {
  return withVaultQueue(peerId, async () => {
    const existing = await findVaultEntry(input.contentHash);
    if (existing) {
      // Already in THIS vault → truly a duplicate, skip.
      if (existing.vault.peerId === peerId) return "skipped";
      // Otherwise the entry is stranded in a different vault (typically
      // `archive:global` from an earlier session when the owner was
      // unknown). Relocate it: drop from the old vault so the target
      // peer vault can engrave the bytes into its own media coin.
      try {
        const stale = await getVault(existing.vault.peerId);
        if (stale && stale.index[input.contentHash]) {
          delete stale.index[input.contentHash];
          await saveVaultUnlocked(stale);
        }
      } catch { /* best-effort — proceed to enrol */ }
    }

    const vault = await ensureVault(peerId);
    reconcileVaultInMemory(vault);
    const size = safeByteSize(input.size);
    let ref: VaultCoinRef;

    if (size >= MEDIA_COIN_CAPACITY_BYTES) {
      ref = allocateMediaCoinRef(vault, size);
    } else {
      const sealBytes = Math.floor(MEDIA_COIN_CAPACITY_BYTES * MEDIA_COIN_SEAL_FRACTION);
      const active = activeMediaCoin(vault);
      if (active && active.fillBytes + size <= sealBytes) {
        ref = active;
      } else {
        if (active) {
          if (active.fillBytes > 0) stampSeal(active, "pre-engrave-rollover", new Date().toISOString());
          else vault.coins = vault.coins.filter((c) => c.coinId !== active.coinId);
        }
        ref = allocateMediaCoinRef(vault, MEDIA_COIN_CAPACITY_BYTES);
      }
    }

    const now = new Date().toISOString();
    ref.phase = "writing";
    ref.lastProgressAt = now;
    vault.index[input.contentHash] = {
      coinId: ref.coinId,
      offset: ref.fillBytes,
      length: size,
      mime: input.mime,
      ref: input.ref,
      name: input.name,
      pending: true,
      firstSeenAt: now,
      completedAt: input.completedAt ?? now,
      storedAt: now,
    };
    ref.fillBytes = Math.min(ref.capacityBytes, ref.fillBytes + size);
    ref.lastProgressAt = now;
    if (size >= MEDIA_COIN_CAPACITY_BYTES) {
      stampSeal(ref, "oversized-complete", now);
    } else {
      ref.phase = "filling";
    }
    await saveVaultUnlocked(vault);
    return "enrolled";
  });
}

/**
 * One-shot cleanup callable from boot / UI refresh. Walks every vault
 * and enforces the single-filling-coin invariant. Safe to run often —
 * no-op when vaults are already clean.
 */
export async function reconcileMediaCoins(): Promise<number> {
  let changed = 0;
  for (const v of await listVaults()) {
    const didChange = await withVaultQueue(v.peerId, async () => {
      const latest = await getVault(v.peerId);
      if (!latest) return false;
      if (!reconcileVaultInMemory(latest)) return false;
      await saveVaultUnlocked(latest);
      return true;
    });
    if (didChange) {
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
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c || c.role !== "media") return;
    const now = new Date().toISOString();
    stampSeal(c, reason, now);
    await saveVaultUnlocked(v);
  });
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
  return withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return false;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c || c.role !== "media" || c.failed) return false;
    const entries = entriesForCoin(v, coinId);
    if (!entriesAreComplete(entries)) return false;
    stampSeal(c, reason, new Date().toISOString());
    await saveVaultUnlocked(v);
    return true;
  });
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
  const wrapped = await withVaultQueue(peerId, async () => {
    const vault = await getVault(peerId);
    if (!vault) return null;
    const ref = vault.coins.find((c) => c.coinId === coinId);
    if (!ref || ref.role !== "media" || !ref.sealed || ref.wrapped || ref.failed) return null;

    const hashes: string[] = [];
    for (const [hash, entry] of Object.entries(vault.index)) {
      if (entry.coinId !== coinId) continue;
      vault.index[hash] = { ...entry, coinId: freeWalletCoin.coinId, pending: false };
      hashes.push(hash);
    }

    ref.coinId = freeWalletCoin.coinId;
    ref.wrapped = true;
    ref.lastWrapAttemptAt = new Date().toISOString();
    if (sealAssistCoin) ref.sealAssistedByCoinId = sealAssistCoin.coinId;
    if (peerId.startsWith("archive:")) ref.wrappedBadge = "archived";
    const fillBytes = ref.fillBytes;
    const capacityBytes = ref.capacityBytes;
    await saveVaultUnlocked(vault);
    return { contentHashes: hashes, fillBytes, capacityBytes };
  });
  if (!wrapped) return false;

  // Engrave the underlying SwarmCoin so guards exclude it everywhere.
  freeWalletCoin.kind = "media";
  freeWalletCoin.sealBytes = wrapped.fillBytes;
  freeWalletCoin.mediaCapacityBytes = wrapped.capacityBytes;
  freeWalletCoin.mediaTargets = [{ peerId, contentHashes: wrapped.contentHashes }];
  freeWalletCoin.mediaRole = "primary";
  if (sealAssistCoin) freeWalletCoin.mediaAssistCoinIds = [sealAssistCoin.coinId];
  await put("swarmCoins", freeWalletCoin);
  if (sealAssistCoin) {
    sealAssistCoin.kind = "media";
    sealAssistCoin.sealBytes = 0;
    sealAssistCoin.mediaCapacityBytes = 0;
    sealAssistCoin.mediaTargets = [{ peerId, contentHashes: wrapped.contentHashes }];
    sealAssistCoin.mediaRole = "seal-assist";
    sealAssistCoin.mediaPrimaryCoinId = freeWalletCoin.coinId;
    await put("swarmCoins", sealAssistCoin);
  }
  return true;
}

/** Stamp a wrap attempt as "tried, insufficient" so the 24h cooldown starts. */
export async function markWrapAttempt(peerId: string, coinId: string): Promise<void> {
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c) return;
    c.lastWrapAttemptAt = new Date().toISOString();
    await saveVaultUnlocked(v);
  });
}

// ── Phase / stuck-write helpers ────────────────────────────────────────

export async function markCoinPhase(
  peerId: string,
  coinId: string,
  phase: NonNullable<VaultCoinRef["phase"]>,
): Promise<void> {
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c || c.role !== "media") return;
    c.phase = phase;
    c.lastProgressAt = new Date().toISOString();
    if (phase === "sealed" && !c.sealed) {
      stampSeal(c, "manual", c.lastProgressAt);
    }
    await saveVaultUnlocked(v);
  });
}

/**
 * Seal a media coin as an immutable failed archive. Never wraps, never
 * serves; kept for auditing.
 */
export async function markCoinFailed(peerId: string, coinId: string): Promise<void> {
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c || c.role !== "media" || c.wrapped) return;
    c.failed = true;
    stampSeal(c, "failed-stall", new Date().toISOString());
    await saveVaultUnlocked(v);
  });
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
  return withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return [];
    const detached: Array<{ contentHash: string; entry: VaultIndexEntry }> = [];
    for (const [hash, entry] of Object.entries(v.index)) {
      if (entry.coinId !== coinId) continue;
      detached.push({ contentHash: hash, entry });
      delete v.index[hash];
    }
    if (detached.length) await saveVaultUnlocked(v);
    return detached;
  });
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
  return reconcileVaultCoinState();
}

export async function reconcileVaultCoinState(): Promise<number> {
  let changed = 0;
  for (const v of await listVaults()) {
    const didChange = await withVaultQueue(v.peerId, async () => {
      const latest = await getVault(v.peerId);
      if (!latest) return false;
      if (!reconcileVaultInMemory(latest)) return false;
      await saveVaultUnlocked(latest);
      return true;
    });
    if (didChange) changed += 1;
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
  await withVaultQueue(peerId, async () => {
    const vault = await ensureVault(peerId);
    vault.index[contentHash] = { ...entry, storedAt: new Date().toISOString() };
    const coin = vault.coins.find((c) => c.coinId === entry.coinId);
    if (coin) {
      normalizeMediaCapacity(coin);
      coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + safeByteSize(entry.length));
      coin.lastProgressAt = new Date().toISOString();
      if (!coin.phase && coin.role === "media" && !coin.sealed) coin.phase = "filling";
    }
    await saveVaultUnlocked(vault);
  });
}

export async function updateVaultEntryPendingStates(
  peerId: string,
  pendingByHash: Map<string, boolean>,
): Promise<void> {
  if (pendingByHash.size === 0) return;
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    let changed = false;
    for (const [hash, pending] of pendingByHash) {
      const entry = v.index[hash];
      if (!entry) continue;
      if (!!entry.pending === pending) continue;
      v.index[hash] = { ...entry, pending };
      changed = true;
    }
    if (changed) await saveVaultUnlocked(v);
  });
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
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    if (kind === "hit") v.hits += 1;
    else v.misses += 1;
    await saveVaultUnlocked(v);
  });
}