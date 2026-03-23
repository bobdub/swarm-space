import { get, type Manifest as StoredManifest } from "@/lib/store";
import {
  decryptAndReassembleFile,
  importKeyRaw,
  type Manifest as EncryptedManifest,
} from "@/lib/fileEncryption";

interface EnsureManifestOptions {
  includeChunks?: boolean;
  sourcePeerId?: string;
}

type EnsureManifestFn = (
  manifestId: string,
  options?: EnsureManifestOptions
) => Promise<StoredManifest | null>;

export interface BlogHeroLoadResult {
  heroUrl: string | null;
  pendingManifestIds: string[];
}

/**
 * Resolve the best image hero for a blog post from local store / mesh.
 * Returns a blob URL when an image can be fully decrypted.
 */
export async function loadBlogHeroImage(
  manifestIds: string[] | undefined,
  ensureManifest: EnsureManifestFn,
): Promise<BlogHeroLoadResult> {
  if (!Array.isArray(manifestIds) || manifestIds.length === 0) {
    return { heroUrl: null, pendingManifestIds: [] };
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
      continue;
    }

    const mime = manifest.mime ?? "";
    if (!mime.startsWith("image/")) {
      continue;
    }

    try {
      const fileKey = await importKeyRaw(manifest.fileKey);
      const decryptableManifest: EncryptedManifest = {
        ...manifest,
        mime: manifest.mime ?? "application/octet-stream",
        size: manifest.size ?? 0,
        originalName: manifest.originalName ?? manifest.fileId,
      };
      const blob = await decryptAndReassembleFile(decryptableManifest, fileKey);
      return {
        heroUrl: URL.createObjectURL(blob),
        pendingManifestIds: Array.from(pendingManifestIds),
      };
    } catch (error) {
      console.warn(`[BlogHero] Failed to decrypt manifest ${manifestId}:`, error);
      pendingManifestIds.add(manifestId);
    }
  }

  return {
    heroUrl: null,
    pendingManifestIds: Array.from(pendingManifestIds),
  };
}
