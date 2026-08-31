import { get, type Manifest as StoredManifest } from "@/lib/store";
import {
  decryptAndReassembleFile,
  importFileKey,
  type Manifest as EncryptedManifest,
} from "@/lib/fileEncryption";
import { reportDeliveryEvent } from "@/lib/pipeline/deliveryTelemetry";

interface EnsureManifestOptions {
  includeChunks?: boolean;
  sourcePeerId?: string;
}

type EnsureManifestFn = (
  manifestId: string,
  options?: EnsureManifestOptions
) => Promise<StoredManifest | null>;

export interface BlogHeroMedia {
  url: string;
  kind: "image" | "video";
  mime: string;
}

export interface BlogHeroLoadResult {
  /** Blob URL of the resolved hero, or null when nothing could be decrypted. */
  heroUrl: string | null;
  /** Full hero descriptor (kind + mime) when resolved. */
  hero: BlogHeroMedia | null;
  pendingManifestIds: string[];
}

/**
 * Resolve the best banner hero for a blog post from local store / mesh.
 * Accepts both images and short video clips — the first attachment of a
 * displayable type wins, so authors control the banner by attachment order.
 */
export async function loadBlogHeroImage(
  manifestIds: string[] | undefined,
  ensureManifest: EnsureManifestFn,
): Promise<BlogHeroLoadResult> {
  if (!Array.isArray(manifestIds) || manifestIds.length === 0) {
    return { heroUrl: null, hero: null, pendingManifestIds: [] };
  }

  const pendingManifestIds = new Set<string>();

  for (const manifestId of manifestIds) {
    let manifest = await get<StoredManifest>("manifests", manifestId);
    const manifestIncomplete = !manifest?.fileKey || !manifest?.chunks?.length;

    if (manifestIncomplete) {
      const ensured = await ensureManifest(manifestId, { includeChunks: true });
      if (ensured) {
        manifest = ensured;
      }
    }

    if (!manifest?.fileKey || !manifest?.chunks?.length) {
      pendingManifestIds.add(manifestId);
      reportDeliveryEvent({ kind: 'manifest-pending', manifestId });
      continue;
    }

    const mime = manifest.mime ?? "";
    const kind: "image" | "video" | null = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : null;
    if (!kind) {
      continue;
    }

    try {
      const fileKey = await importFileKey(manifest);
      const decryptableManifest: EncryptedManifest = {
        ...manifest,
        mime: manifest.mime ?? "application/octet-stream",
        size: manifest.size ?? 0,
        originalName: manifest.originalName ?? manifest.fileId,
      };
      const blob = await decryptAndReassembleFile(decryptableManifest, fileKey);
      reportDeliveryEvent({ kind: 'manifest-resolved', manifestId });
      const url = URL.createObjectURL(blob);
      return {
        heroUrl: url,
        hero: { url, kind, mime },
        pendingManifestIds: Array.from(pendingManifestIds),
      };
    } catch (error) {
      // Chunks may not have arrived yet — this is expected during P2P sync.
      // Demote to debug to avoid console spam on the explore feed.
      console.debug(`[BlogHero] Manifest ${manifestId} pending sync:`, error);
      pendingManifestIds.add(manifestId);
      reportDeliveryEvent({ kind: 'manifest-pending', manifestId });
      reportDeliveryEvent({ kind: 'decrypt-retry', manifestId });
    }
  }

  return {
    heroUrl: null,
    hero: null,
    pendingManifestIds: Array.from(pendingManifestIds),
  };
}
