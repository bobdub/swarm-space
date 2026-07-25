/**
 * syncVault — per-peer local storage backed by sealed SWARM coins.
 * Read-through cache + verifier. Never introduces new transports.
 */
import { get, getAll, put, remove } from "@/lib/store";
import type { SwarmCoin } from "./types";
import { COIN_MAX_WEIGHT } from "./types";

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

export type VaultCoinRole = "canonical" | "receiver";

export interface VaultCoinRef {
  coinId: string;
  role: VaultCoinRole;
  fillBytes: number;
  capacityBytes: number;
  createdAt: string;
}

export interface VaultIndexEntry {
  coinId: string;
  offset: number;
  length: number;
  mime?: string;
  storedAt: string;
  ref?: string;
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
  if (coin) coin.fillBytes = Math.min(coin.capacityBytes, coin.fillBytes + entry.length);
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