/**
 * Optional outside timestamps (OpenTimestamps, anchored in Bitcoin).
 *
 * Off by default. When it's on, every epoch, and at most once an hour within
 * one, the newest checkpoint's block hash is sent to the OpenTimestamps
 * calendars. Only that 32-byte hash leaves the device. Each calendar answers
 * with a pending proof, which is kept here as a receipt. Bitcoin confirms it
 * within a few hours, and the standard `ots upgrade` / `ots verify` tools
 * can then complete and check the downloaded .ots file. When no calendar
 * answers, the checkpoint is marked unreachable and retried on the next run.
 */
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/lib/crypto";

export const OTS_CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://a.pool.eternitywall.com",
];
/** Within one epoch, stamp at most this often. */
export const STAMP_INTERVAL_MS = 60 * 60 * 1000;
const ENABLED_KEY = "swarm-external-timestamps-enabled";
const RECEIPTS_KEY = "swarm-external-timestamps-v1";
const MAX_RECEIPTS = 50;

export interface TimestampReceipt {
  blockHash: string;
  height: number;
  epoch: number;
  at: number;
  status: "pending" | "unreachable";
  /** One pending proof per calendar that answered (base64 of the calendar's reply). */
  proofs: { calendar: string; proof: string }[];
}

type Store = Pick<Storage, "getItem" | "setItem">;
function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const listeners = new Set<() => void>();
export function onExternalTimestampsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => { for (const fn of listeners) try { fn(); } catch { /* ignore */ } };
/** Fired only when the switch changes, never by a new receipt, so a failed stamp can't trigger the next one. */
const switchListeners = new Set<() => void>();

export function getExternalTimestampsEnabled(store = defaultStore()): boolean {
  try { return store?.getItem(ENABLED_KEY) === "1"; } catch { return false; }
}

export function setExternalTimestampsEnabled(on: boolean, store = defaultStore()): void {
  try { store?.setItem(ENABLED_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  for (const fn of switchListeners) try { fn(); } catch { /* ignore */ }
  notify();
}

export function getTimestampReceipts(store = defaultStore()): TimestampReceipt[] {
  try {
    const list = JSON.parse(store?.getItem(RECEIPTS_KEY) ?? "[]");
    return Array.isArray(list) ? list as TimestampReceipt[] : [];
  } catch {
    return [];
  }
}

function saveReceipt(receipt: TimestampReceipt, store: Store | null): void {
  const list = getTimestampReceipts(store).filter((r) => r.blockHash !== receipt.blockHash);
  list.push(receipt);
  try { store?.setItem(RECEIPTS_KEY, JSON.stringify(list.slice(-MAX_RECEIPTS))); } catch { /* best effort */ }
  notify();
}

/** Whether the checkpoint should be stamped now, given the receipts we hold. */
export function shouldStamp(
  checkpoint: { hash: string; epoch: number },
  receipts: TimestampReceipt[],
  now: number,
): boolean {
  const prior = receipts.find((r) => r.blockHash === checkpoint.hash);
  if (prior?.status === "pending") return false;
  const lastPending = [...receipts].reverse().find((r) => r.status === "pending");
  if (!lastPending) return true;
  return checkpoint.epoch !== lastPending.epoch || now - lastPending.at >= STAMP_INTERVAL_MS;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Send a block hash to each calendar and keep what they answer. */
export async function stampCheckpoint(
  checkpoint: { hash: string; index: number; epoch?: number },
  { fetchFn = fetch, store = defaultStore(), now = Date.now(), calendars = OTS_CALENDARS } = {},
): Promise<TimestampReceipt | null> {
  const digest = hexToBytes(checkpoint.hash);
  if (!digest) return null;
  const proofs: TimestampReceipt["proofs"] = [];
  await Promise.all(calendars.map(async (calendar) => {
    try {
      const res = await fetchFn(`${calendar}/digest`, {
        method: "POST",
        headers: { Accept: "application/vnd.opentimestamps.v1", "Content-Type": "application/x-www-form-urlencoded" },
        body: digest,
      });
      if (!res.ok) return;
      const proof = await res.arrayBuffer();
      if (proof.byteLength > 0 && proof.byteLength < 10_000) proofs.push({ calendar, proof: arrayBufferToBase64(proof) });
    } catch { /* unreachable: try the others */ }
  }));
  const receipt: TimestampReceipt = {
    blockHash: checkpoint.hash, height: checkpoint.index, epoch: checkpoint.epoch ?? 0, at: now,
    status: proofs.length ? "pending" : "unreachable", proofs,
  };
  saveReceipt(receipt, store);
  return receipt;
}

const OTS_MAGIC = [
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00,
  0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
];

/**
 * A standard detached .ots file for a receipt: header, the block hash as the
 * stamped SHA-256 digest (the block's hash input is the "file"), then each
 * calendar's proof as a branch.
 */
export function receiptToOtsFile(receipt: TimestampReceipt): Uint8Array<ArrayBuffer> | null {
  const digest = hexToBytes(receipt.blockHash);
  if (!digest || receipt.proofs.length === 0) return null;
  const parts: number[] = [...OTS_MAGIC, 0x01, 0x08, ...digest];
  receipt.proofs.forEach(({ proof }, i) => {
    if (i < receipt.proofs.length - 1) parts.push(0xff);
    parts.push(...new Uint8Array(base64ToArrayBuffer(proof)));
  });
  return new Uint8Array(parts);
}

/** One run: stamp our newest checkpoint if it's due. Does nothing while the feature is off. */
export async function runExternalTimestamps(
  chain: { getLatestCheckpoint(): number; getChain(): { hash: string; index: number; epoch?: number }[] },
  options: Parameters<typeof stampCheckpoint>[1] = {},
): Promise<TimestampReceipt | null> {
  const store = options.store ?? defaultStore();
  if (!getExternalTimestampsEnabled(store)) return null;
  const height = chain.getLatestCheckpoint();
  if (height < 0) return null;
  const block = chain.getChain()[height];
  if (!block) return null;
  const now = options.now ?? Date.now();
  if (!shouldStamp({ hash: block.hash, epoch: block.epoch ?? 0 }, getTimestampReceipts(store), now)) return null;
  return stampCheckpoint(block, { ...options, store, now });
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Check every ten minutes while the app runs. Safe to call more than once. */
export function startExternalTimestamps(): () => void {
  if (timer) return () => {};
  const tick = () => {
    if (!getExternalTimestampsEnabled()) return;
    void import("./chain").then(async ({ getSwarmChain }) => {
      const chain = getSwarmChain();
      await chain.whenReady();
      await runExternalTimestamps(chain);
    }).catch(() => { /* next tick */ });
  };
  timer = setInterval(tick, 10 * 60 * 1000);
  switchListeners.add(tick);
  const off = () => { switchListeners.delete(tick); };
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    off();
  };
}
