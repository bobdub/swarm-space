/**
 * Personal Archive (.zip) import — restores posts, their conversations and
 * media from an exported archive into this browser.
 *
 * Rules:
 *  - Only posts authored by the signed-in identity are restored; an archive
 *    cannot plant posts under someone else's name.
 *  - Existing posts and comments are never overwritten.
 *  - Media is re-encrypted into local chunk storage, so restored posts point
 *    at fresh manifests that display immediately. A manifest that still
 *    exists locally is reused instead.
 *  - Exported signatures are dropped; posts are re-signed on next broadcast.
 */

import type { Comment, Post } from "@/types";
import { readZip, type ZipReadEntry } from "./zip";
import { parseFrontmatter, parsePostMarkdown, ARCHIVE_FORMAT } from "./archiveFormat";

export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

export interface ArchiveImportResult {
  posts: number;
  skippedExisting: number;
  skippedForeign: number;
  comments: number;
  media: number;
  mediaFailed: number;
  warnings: string[];
}

export interface ArchiveImportDependencies {
  currentUserId(): string | null;
  hasPost(id: string): Promise<boolean>;
  savePost(post: Post): Promise<void>;
  hasComment(id: string): Promise<boolean>;
  saveComment(comment: Comment): Promise<void>;
  hasManifest(id: string): Promise<boolean>;
  /** Encrypt + chunk a file into local storage; returns the new manifest id. */
  storeMedia(file: File): Promise<string>;
  notifyChanged?(): void;
}

export interface ArchiveImportProgress {
  done: number;
  total: number;
  current: string | null;
}

async function defaultDependencies(): Promise<ArchiveImportDependencies> {
  const [{ get, put }, auth, fileEnc] = await Promise.all([
    import("../store"),
    import("../auth"),
    import("../fileEncryption"),
  ]);
  return {
    currentUserId: () => auth.getCurrentUser()?.id ?? null,
    hasPost: async (id) => !!(await get("posts", id)),
    savePost: (post) => put("posts", post),
    hasComment: async (id) => !!(await get("comments", id)),
    saveComment: (comment) => put("comments", comment),
    hasManifest: async (id) => !!(await get("manifests", id)),
    storeMedia: async (file) => {
      const key = await fileEnc.genFileKey();
      const manifest = await fileEnc.chunkAndEncryptFile(file, key);
      return manifest.fileId;
    },
    notifyChanged: () => {
      try { window.dispatchEvent(new CustomEvent("p2p-posts-updated")); } catch { /* non-browser */ }
    },
  };
}

const textDecoder = new TextDecoder();

export async function importPersonalArchive(
  archive: Uint8Array,
  options: { dependencies?: Partial<ArchiveImportDependencies>; onProgress?: (p: ArchiveImportProgress) => void } = {},
): Promise<ArchiveImportResult> {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Archive is larger than 2 GB.");
  const deps: ArchiveImportDependencies = { ...(await defaultDependencies()), ...(options.dependencies ?? {}) };
  const me = deps.currentUserId();
  if (!me) throw new Error("Sign in before importing an archive.");

  const entries = readZip(archive);
  const byName = new Map<string, ZipReadEntry>(entries.map((e) => [e.name, e]));
  const result: ArchiveImportResult = { posts: 0, skippedExisting: 0, skippedForeign: 0, comments: 0, media: 0, mediaFailed: 0, warnings: [] };

  const readme = byName.get("README.md");
  if (readme) {
    const { fields } = parseFrontmatter(textDecoder.decode(await readme.read()));
    if (fields.format !== ARCHIVE_FORMAT) result.warnings.push("README.md is not a Swarm Space archive summary; importing posts anyway.");
    else if (typeof fields.user_id === "string" && fields.user_id !== me) {
      result.warnings.push("This archive was exported by a different identity; only posts you authored are restored.");
    }
  }

  const postEntries = entries.filter((e) => /^posts\/[^/]+\.md$/.test(e.name));
  if (postEntries.length === 0) throw new Error("No posts found. Is this a Swarm Space personal archive?");

  const mediaCache = new Map<string, string | null>();
  const storeMediaRef = async (path: string, name: string, mime: string): Promise<string | null> => {
    if (mediaCache.has(path)) return mediaCache.get(path)!;
    const entry = byName.get(path);
    let id: string | null = null;
    if (entry) {
      try {
        const data = await entry.read();
        id = await deps.storeMedia(new File([data as BlobPart], name, { type: mime }));
        result.media++;
      } catch (error) {
        console.warn("[archiveImport] media failed", path, error);
      }
    }
    if (!id) {
      result.mediaFailed++;
      result.warnings.push(`Could not restore ${path}.`);
    }
    mediaCache.set(path, id);
    return id;
  };

  let done = 0;
  for (const entry of postEntries) {
    options.onProgress?.({ done, total: postEntries.length, current: entry.name });
    done++;
    let parsed;
    try {
      parsed = parsePostMarkdown(textDecoder.decode(await entry.read()));
    } catch (error) {
      result.warnings.push(`Skipped ${entry.name}: ${(error as Error).message}`);
      continue;
    }
    if (!parsed) {
      result.warnings.push(`Skipped ${entry.name}: not a Swarm Space post.`);
      continue;
    }
    if (parsed.post.author !== me) {
      result.skippedForeign++;
      continue;
    }
    if (await deps.hasPost(parsed.post.id)) {
      result.skippedExisting++;
      continue;
    }

    const manifestIds: string[] = [];
    for (const ref of parsed.media) {
      const id = (await deps.hasManifest(ref.manifestId)) ? ref.manifestId : await storeMediaRef(ref.path, ref.name, ref.mime);
      if (id) manifestIds.push(id);
    }

    const post: Post = {
      ...parsed.post,
      ...(manifestIds.length ? { manifestIds } : {}),
      commentCount: parsed.comments.length,
      _origin: "local",
      _syncedToMesh: false,
    };
    await deps.savePost(post);
    result.posts++;

    for (const comment of parsed.comments) {
      if (await deps.hasComment(comment.id)) continue;
      await deps.saveComment(comment);
      result.comments++;
    }
  }
  options.onProgress?.({ done, total: postEntries.length, current: null });
  deps.notifyChanged?.();
  return result;
}
