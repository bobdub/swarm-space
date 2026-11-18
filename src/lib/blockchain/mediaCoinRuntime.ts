/**
 * mediaCoinRuntime — connects the Media Coin engine to the app.
 *
 *  - Starts the engine on the live mesh transport (called by SwarmMesh).
 *  - Unpack: a coin that arrives whole is stored once in the regular
 *    chunk store (manifest + encrypted chunks), enrolled in the creator's
 *    vault as peer content, and announced on the media custody bus.
 *    At rest each device keeps one copy; the coin keeps only pointers.
 *  - Launch: when the wrap sweep engraves a self-created file onto a real
 *    mined coin, that coin's bytes are minted into the engine and sent
 *    on its loop.
 */
import {
  getMediaCoinEngine,
  getActiveMediaCoinEngine,
  resetMediaCoinEngine,
  MEDIA_COIN_PASS_MAX_BYTES,
  type MeshTransportAdapter,
  type MediaCoinUnpacked,
} from "./mediaCoin.standalone";
import { emitMediaCustody } from "./mediaCoin.bus";
import { enrollContent } from "./vaultEnroll";
import { readEntryBytes } from "./vaultLookup";
import { findVaultEntry, listAwaitingFiles } from "./syncVault";

let unsubs: Array<() => void> = [];

/** Stable identity for a coin's content: its chunks' Merkle root never changes between hops. */
export function unpackedContentHash(merkleRoot: string): string {
  return `media-coin-content:${merkleRoot}`;
}

async function alreadyStored(contentHash: string): Promise<boolean> {
  if (await findVaultEntry(contentHash)) return true;
  return (await listAwaitingFiles()).some(({ file }) => file.contentHash === contentHash);
}

let unpackQueue: Promise<void> = Promise.resolve();

async function storeUnpacked(u: MediaCoinUnpacked): Promise<void> {
  // One copy at rest: skip a coin whose content this device already stored.
  const contentHash = unpackedContentHash(u.manifest.merkleRoot);
  if (await alreadyStored(contentHash)) return;
  const { genFileKey, chunkAndEncryptFile } = await import("@/lib/fileEncryption");
  const copy = new Uint8Array(u.bytes.byteLength);
  copy.set(u.bytes);
  const file = new File([copy], u.manifest.name, { type: u.manifest.mimeType });
  const stored = await chunkAndEncryptFile(file, await genFileKey());
  await enrollContent({
    contentHash,
    ownerPeerId: u.route.creatorId,
    isSelf: false,
    name: u.manifest.name,
    mime: u.manifest.mimeType,
    size: u.manifest.totalSize,
    ref: stored.fileId,
  });
  emitMediaCustody({ coinId: u.manifest.coinId, pieceHash: contentHash, ownerId: u.route.creatorId });
}

// ── Launches requested before the mesh is online ───────────────────────

interface PendingLaunch {
  walletCoinId: string;
  file: { ref?: string; contentHash: string; name?: string; mime?: string };
}

const PENDING_KEY = "media-coin-pending-launches";

function readPending(): PendingLaunch[] {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingLaunch[]): void {
  try {
    if (list.length) globalThis.localStorage?.setItem(PENDING_KEY, JSON.stringify(list));
    else globalThis.localStorage?.removeItem(PENDING_KEY);
  } catch { /* storage unavailable */ }
}

function queueLaunch(item: PendingLaunch): void {
  const list = readPending().filter((p) => p.walletCoinId !== item.walletCoinId);
  writePending([...list, item]);
}

function removePending(walletCoinId: string): void {
  writePending(readPending().filter((p) => p.walletCoinId !== walletCoinId));
}

/**
 * Run queued launches one at a time. Each item leaves the persisted queue
 * only after its launch finishes, so a reload or a failing item never
 * drops the launches behind it.
 */
async function drainPendingLaunches(): Promise<void> {
  for (const item of readPending()) {
    try {
      await launchMediaCoinLoop(item.walletCoinId, item.file);
    } catch (err) {
      console.warn("[mediaCoinRuntime] queued launch failed; will retry next start", item.walletCoinId, err);
      continue;
    }
    removePending(item.walletCoinId);
  }
}

export function startMediaCoinRuntime(transport: MeshTransportAdapter): void {
  if (getActiveMediaCoinEngine()) return;
  const engine = getMediaCoinEngine(transport);
  engine.start();
  unsubs.push(engine.onUnpack((u) => {
    // Serialize so two arrivals of the same content cannot both store it.
    unpackQueue = unpackQueue.then(() => storeUnpacked(u)).catch((err) => {
      console.warn("[mediaCoinRuntime] could not store unpacked coin", err);
    });
    return unpackQueue;
  }));
  void drainPendingLaunches().catch(() => {});
}

export function stopMediaCoinRuntime(): void {
  for (const u of unsubs) u();
  unsubs = [];
  resetMediaCoinEngine();
}

/**
 * Engrave a self-created file's bytes onto a real mined coin and send the
 * coin on its loop. When the mesh is not online yet the launch is queued
 * (in localStorage) and runs when the runtime starts. Returns false when
 * the launch was queued, the bytes are not local, or the file is too
 * large to carry.
 */
export async function launchMediaCoinLoop(
  walletCoinId: string,
  file: { ref?: string; contentHash: string; name?: string; mime?: string },
): Promise<boolean> {
  const engine = getActiveMediaCoinEngine();
  if (!engine) {
    queueLaunch({ walletCoinId, file: { ref: file.ref, contentHash: file.contentHash, name: file.name, mime: file.mime } });
    return false;
  }
  const bytes = await readEntryBytes(file.ref ?? file.contentHash);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MEDIA_COIN_PASS_MAX_BYTES) return false;
  const creatorId = engine.localPeerId;
  await engine.mint(
    { name: file.name ?? file.contentHash, type: file.mime ?? "application/octet-stream", data: bytes },
    creatorId,
    { encrypt: true, coinId: walletCoinId },
  );
  return engine.launch(walletCoinId);
}
