/**
 * Personal Archive (.zip) export: one Markdown file per post with YAML
 * frontmatter and its threaded conversation, decrypted media linked by
 * relative path, and a README summary. Built entirely in the browser.
 */
import { get, getAll } from "../store";
import type { Comment, Post } from "@/types";
import { getCurrentUser } from "../auth";
import type { Manifest } from "../fileEncryption";
import { decryptAndReassembleFile, importFileKey } from "../fileEncryption";
import { buildZip, type ZipFileEntry } from "../archive/zip";
import { mediaPath, postPath, renderArchiveReadme, renderPostMarkdown, type ArchiveMediaRef } from "../archive/archiveFormat";

const textEncoder = new TextEncoder();

export interface ExportRequestOptions {
  includePosts: boolean;
  includeMedia: boolean;
  postIds?: string[];
  manifestIds?: string[];
  fileName?: string;
}

export interface ExportProgressUpdate {
  bytesWritten: number;
  percent: number;
  currentFile: string | null;
  totalBytes: number;
}

export interface ExportSummary {
  generatedAt: string;
  selection: {
    includePosts: boolean;
    includeMedia: boolean;
    postIds?: string[];
    manifestIds?: string[];
  };
  counts: {
    posts: number;
    comments: number;
    attachments: number;
    files: number;
  };
  attachments: Array<{
    manifestId: string;
    fileName: string;
    size?: number;
    mime?: string;
    createdAt?: string;
  }>;
  /** Exactly what went into the zip; Free up space clears only these. */
  contents: {
    postIds: string[];
    commentIds: string[];
    manifestIds: string[];
    chunkRefs: string[];
  };
  warnings: string[];
}

export interface ExportStreamResult {
  stream: ReadableStream<Uint8Array>;
  summary: ExportSummary;
  fileName: string;
}

export interface AttachmentResolution {
  manifest: Manifest;
  data: ArrayBuffer;
}

export interface ExporterDependencies {
  loadPosts(): Promise<Post[]>;
  loadComments(): Promise<Comment[]>;
  resolveAttachment(manifestId: string): Promise<AttachmentResolution | null>;
}

const defaultDependencies: ExporterDependencies = {
  async loadPosts(): Promise<Post[]> {
    try {
      const posts = await getAll<Post>("posts");
      const currentUser = getCurrentUser();
      if (!currentUser) return posts;
      return posts.filter((post) => post.author === currentUser.id);
    } catch (error) {
      console.error("[exporter] Failed to load posts", error);
      return [];
    }
  },
  async loadComments(): Promise<Comment[]> {
    try {
      return await getAll<Comment>("comments");
    } catch (error) {
      console.error("[exporter] Failed to load comments", error);
      return [];
    }
  },
  async resolveAttachment(manifestId: string): Promise<AttachmentResolution | null> {
    try {
      const manifest = (await get<Manifest>("manifests", manifestId)) ?? null;
      if (!manifest) {
        return null;
      }
      if (!manifest.fileKey) {
        console.warn(`[exporter] Manifest ${manifestId} is missing a file key`);
        return null;
      }
      const key = await importFileKey(manifest);
      const blob = await decryptAndReassembleFile(manifest, key);
      const buffer = await blob.arrayBuffer();
      return { manifest, data: buffer };
    } catch (error) {
      console.error(`[exporter] Failed to resolve attachment ${manifestId}`, error);
      return null;
    }
  },
};

export interface CreateExportStreamContext {
  onProgress?: (update: ExportProgressUpdate) => void;
  dependencies?: Partial<ExporterDependencies>;
}

function safeDate(value: string | undefined, fallback: Date): Date {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms) : fallback;
}

export async function createAccountExportStream(
  options: ExportRequestOptions,
  context?: CreateExportStreamContext,
): Promise<ExportStreamResult> {
  const includePosts = options.includePosts ?? false;
  const includeMedia = options.includeMedia ?? false;
  const dependencies: ExporterDependencies = {
    ...defaultDependencies,
    ...(context?.dependencies ?? {}),
  };

  const allPosts = await dependencies.loadPosts();
  const selectedPostIds = options.postIds ? new Set(options.postIds) : null;
  const selectedPosts = selectedPostIds
    ? allPosts.filter((post) => selectedPostIds.has(post.id))
    : allPosts;
  const postsToInclude = includePosts ? selectedPosts : [];

  const attachments: AttachmentResolution[] = [];
  const warnings: string[] = [];

  if (includeMedia) {
    const manifestIds = new Set<string>();
    for (const post of selectedPosts) {
      if (Array.isArray(post.manifestIds)) {
        for (const manifestId of post.manifestIds) {
          if (manifestId) manifestIds.add(manifestId);
        }
      }
    }
    if (Array.isArray(options.manifestIds)) {
      for (const id of options.manifestIds) {
        if (id) manifestIds.add(id);
      }
    }

    for (const manifestId of manifestIds) {
      const resolved = await dependencies.resolveAttachment(manifestId);
      if (!resolved) {
        warnings.push(`Skipped media asset ${manifestId} (unavailable or failed to decrypt).`);
        continue;
      }
      attachments.push(resolved);
    }
  }

  const entries: ZipFileEntry[] = [];
  const generatedAt = new Date();

  // Media first, so each post can link the files that really made it in.
  const mediaByManifest = new Map<string, ArchiveMediaRef>();
  for (const attachment of attachments) {
    const manifest = attachment.manifest;
    const ref: ArchiveMediaRef = {
      path: mediaPath(manifest.fileId, manifest.originalName ?? manifest.fileId),
      manifestId: manifest.fileId,
      name: manifest.originalName ?? manifest.fileId,
      mime: manifest.mime || "application/octet-stream",
      size: manifest.size,
    };
    mediaByManifest.set(manifest.fileId, ref);
    entries.push({ name: ref.path, data: new Uint8Array(attachment.data), lastModified: safeDate(manifest.createdAt, generatedAt) });
  }

  let commentTotal = 0;
  const includedCommentIds: string[] = [];
  if (includePosts) {
    const postIds = new Set(postsToInclude.map((p) => p.id));
    const commentsByPost = new Map<string, Comment[]>();
    for (const comment of await dependencies.loadComments()) {
      if (!postIds.has(comment.postId)) continue;
      if (!commentsByPost.has(comment.postId)) commentsByPost.set(comment.postId, []);
      commentsByPost.get(comment.postId)!.push(comment);
    }
    const usedPaths = new Set<string>();
    for (const post of postsToInclude) {
      const media = (post.manifestIds ?? []).map((id) => mediaByManifest.get(id)).filter((m): m is ArchiveMediaRef => !!m);
      const comments = commentsByPost.get(post.id) ?? [];
      commentTotal += comments.length;
      for (const c of comments) includedCommentIds.push(c.id);
      let path = postPath(post);
      for (let n = 2; usedPaths.has(path); n++) path = postPath(post).replace(/\.md$/, `_${n}.md`);
      usedPaths.add(path);
      entries.push({
        name: path,
        data: textEncoder.encode(renderPostMarkdown(post, media, comments)),
        lastModified: safeDate(post.editedAt ?? post.createdAt, generatedAt),
      });
    }
  }

  const summary: ExportSummary = {
    generatedAt: generatedAt.toISOString(),
    selection: {
      includePosts,
      includeMedia,
      postIds: options.postIds,
      manifestIds: options.manifestIds,
    },
    counts: {
      posts: postsToInclude.length,
      comments: commentTotal,
      attachments: attachments.length,
      files: 0,
    },
    attachments: attachments.map(({ manifest }) => ({
      manifestId: manifest.fileId,
      fileName: manifest.originalName ?? manifest.fileId,
      size: manifest.size,
      mime: manifest.mime,
      createdAt: manifest.createdAt,
    })),
    contents: {
      postIds: postsToInclude.map((p) => p.id),
      commentIds: includedCommentIds,
      manifestIds: attachments.map(({ manifest }) => manifest.fileId),
      chunkRefs: attachments.flatMap(({ manifest }) => manifest.chunks ?? []),
    },
    warnings,
  };

  const me = getCurrentUser();
  entries.unshift({
    name: "README.md",
    data: textEncoder.encode(renderArchiveReadme({
      generatedAt: summary.generatedAt,
      username: me?.username,
      displayName: me?.displayName,
      userId: me?.id,
      posts: summary.counts.posts,
      comments: commentTotal,
      media: attachments.length,
      warnings,
    })),
    lastModified: generatedAt,
  });

  summary.counts.files = entries.length;

  const { chunks, totalSize } = buildZip(entries);
  const stamp = summary.generatedAt.slice(0, 10);
  const fileName = options.fileName ?? `swarm-archive-${me?.username ? `${me.username}-` : ""}${stamp}.zip`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      context?.onProgress?.({
        bytesWritten: 0,
        percent: chunks.length === 0 ? 100 : 0,
        currentFile: null,
        totalBytes: totalSize,
      });

      let written = 0;

      const emitChunk = (index: number) => {
        if (index >= chunks.length) {
          context?.onProgress?.({
            bytesWritten: written,
            percent: 100,
            currentFile: null,
            totalBytes: totalSize,
          });
          controller.close();
          return;
        }

        const chunk = chunks[index];
        controller.enqueue(chunk.data);
        written += chunk.data.length;
        const percent = totalSize === 0 ? 100 : Math.min(100, (written / totalSize) * 100);
        context?.onProgress?.({
          bytesWritten: written,
          percent,
          currentFile: chunk.name ?? null,
          totalBytes: totalSize,
        });
        queueMicrotask(() => emitChunk(index + 1));
      };

      emitChunk(0);
    },
  });

  return { stream, summary, fileName };
}

