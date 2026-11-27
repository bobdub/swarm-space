/**
 * Torrent-side handling of a post's attachments (posts of 50 MB or less).
 *
 * Files are held raw until Publish, then encrypted into the torrent store
 * here. This module knows nothing about Media Coins: a post over the
 * torrent size never reaches it, so Media Coin content is never written
 * to, read from or synced through the torrent store.
 */
import { chunkAndEncryptFile, deleteManifest, genFileKey } from "@/lib/fileEncryption";
import { getAdaptiveChunkSize } from "@/lib/p2p/torrentSwarm.standalone";

export interface TorrentAttachmentInput {
  file: File;
}

/**
 * Encrypt each attachment into the torrent store and return the manifest
 * ids, in order. `onStored` reports each id as soon as it is written, so
 * a caller can discard them if the post is not saved.
 */
export async function encryptTorrentAttachments(
  attachments: TorrentAttachmentInput[],
  onStored?: (fileId: string) => void,
): Promise<string[]> {
  const ids: string[] = [];
  for (const { file } of attachments) {
    const key = await genFileKey();
    const manifest = await chunkAndEncryptFile(file, key, getAdaptiveChunkSize(file.size));
    ids.push(manifest.fileId);
    onStored?.(manifest.fileId);
  }
  return ids;
}

/** Drop torrent copies written for a post that was never saved. */
export async function discardTorrentAttachments(fileIds: string[]): Promise<void> {
  for (const id of fileIds) {
    try {
      await deleteManifest(id);
    } catch (err) {
      console.warn("[torrentAttachments] could not discard", id, err);
    }
  }
}
