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

let unsubs: Array<() => void> = [];

async function storeUnpacked(u: MediaCoinUnpacked): Promise<void> {
  const { genFileKey, chunkAndEncryptFile } = await import("@/lib/fileEncryption");
  const copy = new Uint8Array(u.bytes.byteLength);
  copy.set(u.bytes);
  const file = new File([copy], u.manifest.name, { type: u.manifest.mimeType });
  const stored = await chunkAndEncryptFile(file, await genFileKey());
  await enrollContent({
    contentHash: stored.fileId,
    ownerPeerId: u.route.creatorId,
    isSelf: false,
    name: u.manifest.name,
    mime: u.manifest.mimeType,
    size: u.manifest.totalSize,
    ref: stored.fileId,
  });
  emitMediaCustody({ coinId: u.manifest.coinId, pieceHash: stored.fileId, ownerId: u.route.creatorId });
}

export function startMediaCoinRuntime(transport: MeshTransportAdapter): void {
  if (getActiveMediaCoinEngine()) return;
  const engine = getMediaCoinEngine(transport);
  engine.start();
  unsubs.push(engine.onUnpack((u) => storeUnpacked(u).catch((err) => {
    console.warn("[mediaCoinRuntime] could not store unpacked coin", err);
  })));
}

export function stopMediaCoinRuntime(): void {
  for (const u of unsubs) u();
  unsubs = [];
  resetMediaCoinEngine();
}

/**
 * Engrave a self-created file's bytes onto a real mined coin and send the
 * coin on its loop. Best-effort: returns false when the engine is not
 * running, the bytes are not local, or the file is too large to carry.
 */
export async function launchMediaCoinLoop(
  walletCoinId: string,
  file: { ref?: string; contentHash: string; name?: string; mime?: string },
): Promise<boolean> {
  const engine = getActiveMediaCoinEngine();
  if (!engine) return false;
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
