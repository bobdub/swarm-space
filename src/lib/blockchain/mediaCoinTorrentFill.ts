/**
 * mediaCoinTorrentFill — a media coin completes the post's own torrent.
 *
 * A coin carries the whole plaintext file. When it was launched from a
 * post's file, it also carries a binding to that file's torrent manifest
 * (file id, signed manifest, per-chunk IVs and sizes). On arrival:
 *
 *   1. Skip files the user flushed (the flush still holds).
 *   2. Use the local manifest when this device has the post's media,
 *      otherwise save the coin's copy (signature checked).
 *   3. Count which chunks are already here (how far the torrent got).
 *   4. Check every slice (present chunks too) and store missing ones only:
 *      re-encrypt the coin's slice with the
 *      file key and that chunk's IV. AES-GCM is deterministic for a fixed
 *      key and IV, so this reproduces the original chunk exactly; it is
 *      stored only when its hash equals the manifest's chunk ref.
 *
 * The local manifest's refs are the authority: a coin can only add chunks
 * the torrent already commits to, never replace or invent one.
 */
import { get, put } from "@/lib/store";
import { isAssetFlushed } from "@/lib/p2p/flushedAssets";
import type { MediaCoinTorrentBinding } from "./mediaCoin.standalone";

/** Event the mesh listens for to announce seeding and refresh the post. */
export const TORRENT_FILLED_EVENT = "media-coin-torrent-filled";

export interface TorrentFillResult {
  fileId: string;
  status: "flushed" | "invalid" | "complete" | "partial";
  /** Chunks this device already had before the coin arrived. */
  had: number;
  /** Chunks rebuilt from the coin. */
  filled: number;
  /** Chunks whose rebuilt hash did not match the manifest (left missing). */
  mismatched: number;
  total: number;
}

interface FileManifestLike {
  fileId?: string;
  chunks?: unknown;
  mime?: string;
  originalName?: string;
  fileKey?: string;
  fileKeyRaw?: string;
  fileKeyWrapped?: boolean;
  fileKeySalt?: string;
  fileKeyIv?: string;
  [key: string]: unknown;
}

interface StoredChunk {
  ref: string;
  seq: number;
  total: number;
  size: number;
  iv: string;
  cipher: string;
  meta: { mime?: string; originalName?: string };
}

function ab2b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const BLOCK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + BLOCK, bytes.length)));
  }
  return btoa(binary);
}

function b642bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same chunk ref as fileEncryption / adaptiveChunker: sha256(cipherB64 + seq). */
async function chunkRef(cipherB64: string, seq: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cipherB64 + seq));
  return `chunk-${hex(digest)}`;
}

function chunkRefsOf(manifest: FileManifestLike | undefined): string[] | null {
  if (!manifest || !Array.isArray(manifest.chunks)) return null;
  const refs = manifest.chunks.filter((r): r is string => typeof r === "string" && r.length > 0);
  return refs.length === manifest.chunks.length && refs.length > 0 ? refs : null;
}

function sameRefs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

function hasKey(m: FileManifestLike): boolean {
  return Boolean(m.fileKeyRaw || m.fileKey);
}

/**
 * Build the binding a launching coin carries, from the post's local file.
 * Returns null when the manifest or any chunk is missing locally.
 */
export async function buildTorrentBinding(fileId: string): Promise<MediaCoinTorrentBinding | null> {
  try {
    const manifest = await get<FileManifestLike>("manifests", fileId);
    const refs = chunkRefsOf(manifest);
    if (!manifest || !refs) return null;
    const chunkIvs: string[] = [];
    const chunkSizes: number[] = [];
    for (const ref of refs) {
      const chunk = await get<StoredChunk>("chunks", ref);
      if (!chunk || typeof chunk.iv !== "string" || typeof chunk.size !== "number") return null;
      chunkIvs.push(chunk.iv);
      chunkSizes.push(chunk.size);
    }
    return { fileId, manifest: { ...manifest, fileId }, chunkIvs, chunkSizes };
  } catch {
    return null;
  }
}

async function carriedManifestIsValid(m: FileManifestLike): Promise<boolean> {
  try {
    const { verifyManifestSignature } = await import("@/lib/p2p/replication");
    return await verifyManifestSignature(m as unknown as Parameters<typeof verifyManifestSignature>[0]);
  } catch {
    return false;
  }
}

/**
 * Fill the missing chunks of the post's torrent from a coin's plaintext
 * bytes. Idempotent: chunks already present are left untouched.
 */
export async function fillTorrentFromCoin(
  binding: MediaCoinTorrentBinding,
  bytes: Uint8Array,
): Promise<TorrentFillResult> {
  const fileId = binding?.fileId;
  const result: TorrentFillResult = { fileId, status: "invalid", had: 0, filled: 0, mismatched: 0, total: 0 };
  if (typeof fileId !== "string" || !fileId) return result;
  if (isAssetFlushed(fileId)) return { ...result, status: "flushed" };

  const carried = binding.manifest as FileManifestLike | undefined;
  const carriedRefs = carried && carried.fileId === fileId ? chunkRefsOf(carried) : null;

  // 1. The post's media already here? Its manifest is the authority.
  let manifest = await get<FileManifestLike>("manifests", fileId);
  let refs = chunkRefsOf(manifest);
  if (!manifest || !refs) {
    if (!carried || !carriedRefs || !(await carriedManifestIsValid(carried))) return result;
    manifest = { ...carried, fileId };
    refs = carriedRefs;
    await put("manifests", manifest);
  } else if (!hasKey(manifest) && carried && carriedRefs && sameRefs(refs, carriedRefs) && hasKey(carried)
    && (await carriedManifestIsValid(carried))) {
    // Same torrent, but our copy had no readable key: keep the keyed one.
    manifest = { ...carried, fileId };
    await put("manifests", manifest);
  }

  const total = refs.length;
  result.total = total;
  const { chunkIvs, chunkSizes } = binding;
  if (!Array.isArray(chunkIvs) || !Array.isArray(chunkSizes)
    || chunkIvs.length !== total || chunkSizes.length !== total) return result;
  const sizeSum = chunkSizes.reduce((a, n) => a + (Number.isInteger(n) && n >= 0 ? n : NaN), 0);
  if (sizeSum !== bytes.byteLength) return result;

  // 2. How far did the torrent get?
  const present: boolean[] = [];
  for (let i = 0; i < total; i++) {
    present.push(Boolean(await get("chunks", refs[i])));
    if (present[i]) result.had++;
  }

  // 3. Check every slice of the coin against the manifest (chunks already
  //    here too, so a coin carrying other bytes can never pass as this
  //    torrent), and store only the empty spots.
  let key: CryptoKey;
  try {
    const { importFileKey } = await import("@/lib/fileEncryption");
    key = await importFileKey(manifest);
  } catch {
    return result;
  }
  let at = 0;
  for (let i = 0; i < total; i++) {
    const offset = at;
    at += chunkSizes[i];
    try {
      const slice = bytes.subarray(offset, offset + chunkSizes[i]);
      const iv = b642bytes(chunkIvs[i]);
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(slice));
      const cipherB64 = ab2b64(cipher);
      if ((await chunkRef(cipherB64, i)) !== refs[i]) {
        result.mismatched++;
        continue;
      }
      if (present[i]) continue; // already here: verified, never rewritten
      const chunk: StoredChunk = {
        ref: refs[i],
        seq: i,
        total,
        size: chunkSizes[i],
        iv: chunkIvs[i],
        cipher: cipherB64,
        meta: { mime: manifest.mime, originalName: manifest.originalName },
      };
      await put("chunks", chunk);
      result.filled++;
    } catch {
      result.mismatched++;
    }
  }

  // Complete only when the coin is this torrent, byte for byte, and every
  // chunk is now here; otherwise the caller keeps the coin as its own copy.
  result.status = result.mismatched === 0 && result.had + result.filled === total ? "complete" : "partial";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TORRENT_FILLED_EVENT, { detail: { ...result } }));
  }
  return result;
}
