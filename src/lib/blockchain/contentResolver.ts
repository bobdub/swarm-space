/**
 * contentResolver — single façade for reading verified content bytes.
 *
 * Serving priority:
 *   1. Media Coin (sealed, not failed)   — via vaultLookup
 *   2. Local torrent / file transfer     — via IndexedDB `chunks`
 *   3. Pending                           — caller falls back to network path
 *
 * This module never triggers new transport calls; it's a read-only
 * resolver. Callers keep their existing peer-request logic and use
 * this to decide *which* local source (if any) to serve from first.
 */
import { resolveFromVaults, type VaultHit } from "./vaultLookup";
import { getChunk } from "@/lib/store";

export type ContentSource = "coin" | "chunk" | "pending";

export interface ResolvedContent {
  bytes: Uint8Array | null;
  mime?: string;
  source: ContentSource;
  coinId?: string;
  peerId?: string;
}

export interface ResolveHint {
  mime?: string;
  ref?: string;
}

export async function resolveContent(
  contentHash: string,
  hint?: ResolveHint,
): Promise<ResolvedContent> {
  // 1. Media coin first — sealed & !failed gated inside vaultLookup.
  try {
    const hit: VaultHit | null = await resolveFromVaults(contentHash);
    if (hit) {
      return {
        bytes: hit.bytes,
        mime: hit.mime ?? hint?.mime,
        source: "coin",
        coinId: hit.coinId,
        peerId: hit.peerId,
      };
    }
  } catch { /* fall through */ }

  // 2. Torrent / file transfer local chunk store.
  try {
    const ref = hint?.ref ?? contentHash;
    const bytes = await getChunk(ref);
    if (bytes) return { bytes, mime: hint?.mime, source: "chunk" };
  } catch { /* fall through */ }

  // 3. Pending — caller decides whether to request from peers.
  return { bytes: null, mime: hint?.mime, source: "pending" };
}