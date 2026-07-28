/**
 * syncVault — per-peer local storage backed by MINED SWARM coins only.
 *
 * Vaults never fabricate coins. Completed files are recorded in
 * `files[]` as "awaiting-engraver"; a real mined wallet coin is
 * required before the file becomes an index entry served through
 * `sealedCoins[]`. See vaultEngraver.ts for the engraving worker.
 */
import { get, getAll, put, remove } from "@/lib/store";
import type { SwarmCoin } from "./types";
import { MEDIA_COIN_CAPACITY_BYTES } from "./types";

export type VaultCoinRole = "media";
export type VaultSealReason = "engraved" | "reconcile" | "manual";

export interface VaultCoinRef {
  /** Real mined wallet coin id — never synthesized by the vault layer. */
  coinId: string;
  role: VaultCoinRole;
  fillBytes: number;
  capacityBytes: number;
  createdAt: string;
  /** Sealed vault coins are the only kind we keep; retained for compat. */
  sealed: true;
  sealedAt?: string;
  sealReason?: VaultSealReason;
  /** Content hashes engraved onto this real coin. */
  engravedHashes?: string[];
  /** True — vault refs are backed by wallet coins, i.e. always "wrapped". */
  wrapped: true;
  wrappedBadge?: "archived";
  /** Marked failed only through explicit admin action. */
  failed?: boolean;
}

/**
 * A file received into a vault that has NOT yet been engraved onto a
 * real mined wallet coin. Sits here indefinitely — no fabrication, no
 * timeout. Engraver picks these up when the wallet has a free coin.
 */
export interface VaultFileEntry {
  contentHash: string;
  size: number;
  mime?: string;
  name?: string;
  ref?: string;
  ownerPeerId?: string;
  receivedAt: string;
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
  awaitingSync?: boolean;
}

export interface SyncVault {
  peerId: string;
  /** Sealed real wallet coins that were engraved and routed to this vault. */
  coins: VaultCoinRef[];
  /** Files received but not yet engraved onto a real mined coin. */
  files: VaultFileEntry[];
  index: Record<string, VaultIndexEntry>;
  hits: number;
  misses: number;
  updatedAt: string;
}

const STORE = "syncVaults";
const vaultQueues = new Map<string, Promise<void>>();

// ── Vault Transfer Protocol addressing ─────────────────────────────────

/** Canonical global archive vault address. */
export const ARCHIVE_VAULT_ADDRESS = "vault:archive:global";

/** Deterministic on-chain address for a peer's vault protocol. */
export function peerVaultAddress(peerId: string): string {
  return `vault:peer:${peerId}`;
}

/**
 * Peer-ID gate. Only well-formed peer ids may receive a peer vault
 * transfer; everything else routes to the global archive vault.
 */
export function isValidPeerId(peerId?: string | null): boolean {
  if (!peerId) return false;
  const id = String(peerId).trim();
  if (!id || id.startsWith("archive:") || id.startsWith("vault:")) return false;
  return /^[A-Za-z0-9_-]{3,128}$/.test(id);
}

/** Resolve the vault address a freshly engraved coin must be sent to. */
export function vaultAddressForFile(file: { ownerPeerId?: string | null }): string {
  return isValidPeerId(file.ownerPeerId)
    ? peerVaultAddress(String(file.ownerPeerId))
    : ARCHIVE_VAULT_ADDRESS;
}

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
  if (!v) return null;
  // Backwards-compat: older persisted vaults have no `files` array.
  if (!Array.isArray((v as SyncVault).files)) (v as SyncVault).files = [];
  return v;
}

export async function listVaults(): Promise<SyncVault[]> {
  const all = await getAll<SyncVault>(STORE);
  for (const v of all) if (!Array.isArray(v.files)) v.files = [];
  return all;
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
    files: [],
    index: {},
    hits: 0,
    misses: 0,
    updatedAt: new Date().toISOString(),
  };
  await saveVault(fresh);
  return fresh;
}

function safeByteSize(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.floor(bytes);
}

function isSyntheticCoinId(id: string): boolean {
  if (!id) return true;
  return id.startsWith("archive:") || id.includes(":media:") || id.startsWith("media-");
}

/**
 * Non-destructive repair of pre-mined-only vaults:
 *  - Fabricated coin refs (synthetic ids like `archive:media:*`) are
 *    deleted, and every index entry that pointed at them is demoted
 *    back into `files[]` as awaiting-engraver.
 *  - Real coin refs are normalized: sealed=true, wrapped=true, role=media.
 */
function reconcileVaultInMemory(v: SyncVault): boolean {
  let dirty = false;
  if (!Array.isArray(v.files)) { v.files = []; dirty = true; }
  const now = new Date().toISOString();
  const droppedCoinIds = new Set<string>();
  const keep: VaultCoinRef[] = [];

  for (const raw of v.coins) {
    if (isSyntheticCoinId(raw.coinId)) {
      droppedCoinIds.add(raw.coinId);
      dirty = true;
      continue;
    }
    const ref: VaultCoinRef = {
      ...raw,
      role: "media",
      sealed: true,
      wrapped: true,
      capacityBytes: Math.max(
        MEDIA_COIN_CAPACITY_BYTES,
        Number.isFinite(raw.capacityBytes) && raw.capacityBytes > 0
          ? raw.capacityBytes
          : 0,
      ),
      sealedAt: raw.sealedAt ?? now,
      sealReason: raw.sealReason ?? "reconcile",
    };
    if (JSON.stringify(ref) !== JSON.stringify(raw)) dirty = true;
    keep.push(ref);
  }
  v.coins = keep;

  // Demote every index entry that pointed at a dropped fabricated coin
  // back into `files[]` so the engraver can pick it up when a real
  // mined coin becomes available.
  const knownAwaiting = new Set(v.files.map((f) => f.contentHash));
  for (const [hash, entry] of Object.entries(v.index)) {
    if (!droppedCoinIds.has(entry.coinId)) continue;
    delete v.index[hash];
    dirty = true;
    if (knownAwaiting.has(hash)) continue;
    v.files.push({
      contentHash: hash,
      size: safeByteSize(entry.length),
      mime: entry.mime,
      name: entry.name,
      ref: entry.ref,
      ownerPeerId: v.peerId.startsWith("archive:") ? undefined : v.peerId,
      receivedAt: entry.storedAt ?? now,
    });
    knownAwaiting.add(hash);
  }

  return dirty;
}

export interface EnrollVaultEntryInput {
  contentHash: string;
  mime?: string;
  ref?: string;
  name?: string;
  size: number;
  completedAt?: string;
  ownerPeerId?: string;
}

/**
 * Record a completed file as awaiting-engraver in the vault. Never
 * touches any coin — real or fabricated. If the file is already
 * engraved (present in `v.index`) or already queued, this is a no-op.
 */
export async function enrollVaultEntry(
  peerId: string,
  input: EnrollVaultEntryInput,
): Promise<"skipped" | "enrolled"> {
  return withVaultQueue(peerId, async () => {
    const vault = await ensureVault(peerId);
    reconcileVaultInMemory(vault);

    // Already engraved somewhere → dedupe.
    const alreadyIndexed = await findVaultEntry(input.contentHash);
    if (alreadyIndexed) return "skipped";
    // Already queued in this vault → dedupe.
    if (vault.files.some((f) => f.contentHash === input.contentHash)) return "skipped";

    vault.files.push({
      contentHash: input.contentHash,
      size: safeByteSize(input.size),
      mime: input.mime,
      name: input.name,
      ref: input.ref,
      ownerPeerId: input.ownerPeerId,
      receivedAt: input.completedAt ?? new Date().toISOString(),
    });
    await saveVaultUnlocked(vault);
    return "enrolled";
  });
}

/**
 * Sweep every vault: drop fabricated coin refs, demote their entries
 * back to awaiting-engraver, normalize real coin refs. Safe to run
 * often — no-op when vaults are already clean.
 */
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

// Backwards-compat aliases; both call reconcileVaultCoinState.
export const reconcileLegacyVaultCoins = reconcileVaultCoinState;
export const reconcileMediaCoins = reconcileVaultCoinState;

/**
 * Engraver-only atomic op: attach a real mined wallet coin to the
 * vault, index the file bytes against it, and remove the file from
 * `files[]`. All mutations happen inside the vault queue.
 */
export interface EngraveFileInput {
  contentHash: string;
  walletCoinId: string;
  size: number;
  mime?: string;
  name?: string;
  ref?: string;
  reason?: VaultSealReason;
}

export async function engraveFileOntoCoin(
  peerId: string,
  input: EngraveFileInput,
): Promise<boolean> {
  return withVaultQueue(peerId, async () => {
    if (isSyntheticCoinId(input.walletCoinId)) return false;
    const vault = await ensureVault(peerId);
    reconcileVaultInMemory(vault);
    // Already engraved elsewhere → nothing to do here.
    if (vault.index[input.contentHash]) return false;
    const now = new Date().toISOString();
    const size = safeByteSize(input.size);
    const capacity = Math.max(size, MEDIA_COIN_CAPACITY_BYTES);

    let ref = vault.coins.find((c) => c.coinId === input.walletCoinId);
    if (!ref) {
      ref = {
        coinId: input.walletCoinId,
        role: "media",
        fillBytes: 0,
        capacityBytes: capacity,
        createdAt: now,
        sealed: true,
        wrapped: true,
        sealedAt: now,
        sealReason: input.reason ?? "engraved",
        engravedHashes: [],
        wrappedBadge: peerId.startsWith("archive:") ? "archived" : undefined,
      };
      vault.coins.push(ref);
    }
    ref.fillBytes = Math.min(ref.capacityBytes, ref.fillBytes + size);
    ref.engravedHashes = [...(ref.engravedHashes ?? []), input.contentHash];
    ref.sealed = true;
    ref.wrapped = true;

    vault.index[input.contentHash] = {
      coinId: input.walletCoinId,
      offset: 0,
      length: size,
      mime: input.mime,
      ref: input.ref,
      name: input.name,
      pending: false,
      firstSeenAt: now,
      completedAt: now,
      storedAt: now,
    };
    vault.files = vault.files.filter((f) => f.contentHash !== input.contentHash);
    await saveVaultUnlocked(vault);
    return true;
  });
}

/** List every awaiting-engraver file across all vaults (oldest first). */
export async function listAwaitingFiles(): Promise<Array<{ peerId: string; file: VaultFileEntry }>> {
  const out: Array<{ peerId: string; file: VaultFileEntry }> = [];
  for (const v of await listVaults()) {
    for (const f of v.files) out.push({ peerId: v.peerId, file: f });
  }
  out.sort((a, b) => (a.file.receivedAt || "").localeCompare(b.file.receivedAt || ""));
  return out;
}

/** Mark an engraved vault coin as failed. Never called automatically. */
export async function markCoinFailed(peerId: string, coinId: string): Promise<void> {
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c) return;
    c.failed = true;
    await saveVaultUnlocked(v);
  });
}

// ── Kept for callers that still touch these names; all become no-ops
// or thin wrappers now that engraving is the single writer.

export async function sealMediaCoin(
  peerId: string,
  coinId: string,
  _reason: VaultSealReason = "manual",
): Promise<void> {
  await withVaultQueue(peerId, async () => {
    const v = await getVault(peerId);
    if (!v) return;
    const c = v.coins.find((x) => x.coinId === coinId);
    if (!c) return;
    c.sealed = true;
    if (!c.sealedAt) c.sealedAt = new Date().toISOString();
    await saveVaultUnlocked(v);
  });
}

/** List sealed vault coins across all vaults. */
export async function listSealedMediaCoins(): Promise<Array<{ peerId: string; ref: VaultCoinRef }>> {
  const out: Array<{ peerId: string; ref: VaultCoinRef }> = [];
  for (const v of await listVaults()) {
    for (const c of v.coins) if (!c.failed) out.push({ peerId: v.peerId, ref: c });
  }
  return out;
}

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
      coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + safeByteSize(entry.length));
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

// Silence unused-import warnings without adding real dependencies.
export type __UnusedSwarmCoin = SwarmCoin;