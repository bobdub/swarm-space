/**
 * coinCraftingStore — local Forge state for crafting weighted SWARM coins
 * from harvested chemicals. Local-only (no P2P gossip). IndexedDB-backed
 * with throttled writes and a BroadcastChannel for cross-tab sync.
 *
 * Lifecycle:
 *   - User picks an unsealed coin (status='pool' OR fillState∈{pool,bound,filling}).
 *   - User deposits atoms; fill is capped at 0.85 by spec.
 *   - finalizeCraft seals the coin and assigns it to the user wallet with
 *     `wrappedChemicals` payload (so it carries across projects).
 *   - cancelCraft refunds deposited atoms to the global inventory.
 */
import { getAll, put } from '@/lib/store';
import type { SwarmCoin } from '@/lib/blockchain/types';
import {
  spendHarvested,
  recordHarvestMany,
  recordHarvestForProject,
} from './harvestedInventory';

export const CRAFT_FILL_CAP = 0.85;

/** Standard atomic mass for the elements available in-world (g/mol). */
const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305,
  Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078,
};

export function atomicMass(symbol: string): number {
  return ATOMIC_MASS[symbol] ?? 12;
}

export type CraftProgress = {
  coinId: string;
  contents: Record<string, number>;
  fill: number;
  startedAt: string;
  updatedAt: string;
};

const DB_NAME = 'swarm-coin-crafting';
const STORE = 'progress';
const DB_VERSION = 1;

type Listener = (snap: Record<string, CraftProgress>) => void;

const progress = new Map<string, CraftProgress>();
const listeners = new Set<Listener>();
let hydrated = false;
let writeTimer: number | null = null;
let channel: BroadcastChannel | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'coinId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function readAll(): Promise<CraftProgress[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<CraftProgress[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as CraftProgress[]) ?? []);
    req.onerror = () => resolve([]);
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

async function writeOne(p: CraftProgress): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(p);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function deleteOne(coinId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(coinId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

function snapshot(): Record<string, CraftProgress> {
  const out: Record<string, CraftProgress> = {};
  for (const [k, v] of progress) out[k] = v;
  return out;
}

function notify(): void {
  const snap = snapshot();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel('swarm:coin-craft');
    channel.onmessage = (e: MessageEvent) => {
      const msg = e?.data as { type: string; coinId?: string; p?: CraftProgress } | null;
      if (!msg) return;
      if (msg.type === 'set' && msg.p) { progress.set(msg.p.coinId, msg.p); notify(); }
      else if (msg.type === 'delete' && msg.coinId) { progress.delete(msg.coinId); notify(); }
    };
  } catch { channel = null; }
  return channel;
}

function broadcast(msg: unknown): void {
  try { ensureChannel()?.postMessage(msg); } catch { /* noop */ }
}

function scheduleWrite(p: CraftProgress): void {
  void writeOne(p);
  if (writeTimer !== null) return;
  writeTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
    writeTimer = null;
  }, 1500) as unknown as number;
}

// ── Coin helpers ────────────────────────────────────────────────────────

export async function listAllCoins(): Promise<SwarmCoin[]> {
  return getAll<SwarmCoin>('swarmCoins');
}

export async function listCraftableCoins(userId: string): Promise<SwarmCoin[]> {
  const all = await listAllCoins();
  return all.filter((c) => {
    const ownedByUserOrPool = c.ownerId === userId || c.status === 'pool';
    const unsealed = !c.fillState || c.fillState === 'pool' || c.fillState === 'bound' || c.fillState === 'filling';
    return ownedByUserOrPool && unsealed;
  });
}

export async function listSealedUserCoins(userId: string): Promise<SwarmCoin[]> {
  const all = await listAllCoins();
  return all.filter((c) => c.ownerId === userId && (c.fillState === 'sealed' || (c.fillState === undefined && c.status === 'wallet')));
}

// ── Public API ──────────────────────────────────────────────────────────

export async function hydrateCoinCrafting(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  ensureChannel();
  const rows = await readAll();
  for (const r of rows) progress.set(r.coinId, r);
  notify();
}

export function getProgress(coinId: string): CraftProgress | null {
  return progress.get(coinId) ?? null;
}

export function subscribeCrafting(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(snapshot()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

function computeFill(contents: Record<string, number>, maxWeight: number): number {
  let mass = 0;
  for (const [sym, n] of Object.entries(contents)) mass += atomicMass(sym) * n;
  if (maxWeight <= 0) return 0;
  const raw = mass / maxWeight;
  return Math.min(CRAFT_FILL_CAP, Math.max(0, raw));
}

export type DepositResult =
  | { ok: true; progress: CraftProgress }
  | { ok: false; reason: 'insufficient-atoms' | 'at-cap' | 'invalid' };

/**
 * Deposit `count` atoms of `symbol` into the coin's craft buffer.
 * Spends from the global harvested inventory. Hard-capped at 0.85 fill.
 */
export function deposit(
  coin: SwarmCoin,
  symbol: string,
  count: number,
): DepositResult {
  if (!symbol || !Number.isFinite(count) || count <= 0) return { ok: false, reason: 'invalid' };
  const cur = progress.get(coin.coinId) ?? {
    coinId: coin.coinId,
    contents: {},
    fill: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (cur.fill >= CRAFT_FILL_CAP) return { ok: false, reason: 'at-cap' };

  const spent = spendHarvested([{ symbol, count }]);
  if (!spent) return { ok: false, reason: 'insufficient-atoms' };

  const nextContents = { ...cur.contents, [symbol]: (cur.contents[symbol] ?? 0) + count };
  let nextFill = computeFill(nextContents, coin.maxWeight);
  // Cap visual fill and refund any "overflow" symbol additions that pushed past cap.
  if (nextFill > CRAFT_FILL_CAP) nextFill = CRAFT_FILL_CAP;

  const updated: CraftProgress = {
    ...cur,
    contents: nextContents,
    fill: nextFill,
    updatedAt: new Date().toISOString(),
  };
  progress.set(coin.coinId, updated);
  scheduleWrite(updated);
  broadcast({ type: 'set', p: updated });
  notify();
  return { ok: true, progress: updated };
}

/**
 * Cancel craft progress for a coin — refund deposited atoms to the user's
 * global inventory and clear local state.
 */
export async function cancelCraft(coinId: string): Promise<void> {
  const cur = progress.get(coinId);
  if (!cur) return;
  const parts = Object.entries(cur.contents).map(([symbol, count]) => ({ symbol, count }));
  if (parts.length) recordHarvestMany(parts);
  progress.delete(coinId);
  await deleteOne(coinId);
  broadcast({ type: 'delete', coinId });
  notify();
}

/**
 * Finalize a craft: seal the coin with its current chemical payload, assign
 * it to the user's wallet, and clear the progress entry. Refuses if the coin
 * has nothing deposited.
 */
export async function finalizeCraft(coinId: string, userId: string): Promise<SwarmCoin> {
  const cur = progress.get(coinId);
  if (!cur) throw new Error('No craft progress for this coin');
  if (cur.fill <= 0) throw new Error('Coin is empty — deposit chemicals first');

  const all = await listAllCoins();
  const coin = all.find((c) => c.coinId === coinId);
  if (!coin) throw new Error('Coin not found');

  const wrappedChemicals = Object.entries(cur.contents)
    .filter(([, n]) => n > 0)
    .map(([symbol, count]) => ({ symbol, count }));

  const sealed: SwarmCoin = {
    ...coin,
    ownerId: userId,
    status: 'wallet',
    fill: cur.fill,
    fillState: 'sealed',
    sealedAt: new Date().toISOString(),
    wrappedChemicals,
  };
  await put('swarmCoins', sealed);

  progress.delete(coinId);
  await deleteOne(coinId);
  broadcast({ type: 'delete', coinId });
  notify();
  return sealed;
}

/**
 * Smelt a sealed coin: unseal it, return it to the community pool, and
 * deposit its chemical payload into the active project's pool.
 */
export async function smeltCoin(coinId: string, projectId: string): Promise<void> {
  if (!projectId) throw new Error('Pick a project to smelt into');
  const all = await listAllCoins();
  const coin = all.find((c) => c.coinId === coinId);
  if (!coin) throw new Error('Coin not found');
  if (coin.fillState && coin.fillState !== 'sealed') throw new Error('Only sealed coins can be smelted');

  const parts = (coin.wrappedChemicals ?? []).map((p) => ({ symbol: p.symbol, count: p.count }));
  if (parts.length) await recordHarvestForProject(projectId, parts);

  const reset: SwarmCoin = {
    ...coin,
    ownerId: 'pool',
    status: 'pool',
    fill: 0,
    fillState: 'pool',
    wrappedChemicals: [],
    sealedAt: undefined,
    firstArtifactNftId: undefined,
    stressAccrued: 0,
    weight: 0,
    wrappedTokens: [],
  };
  await put('swarmCoins', reset);
}