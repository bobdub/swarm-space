import { get, getAll, getAllByIndex } from "./store";
import type { Post, Comment } from "@/types";
import { getCurrentUser } from "./auth";
import { decryptAndReassembleFile, importKeyRaw, type Manifest } from "./fileEncryption";
import { arrayBufferToBase64 } from "./crypto";
import type {
  ExportArchiveOptions,
  ExporterMediaRecord,
  ExporterRequestPayload,
  ExporterSelection,
} from "@/types/exporter";

export interface ExportProgress {
  bytes: number;
  total?: number;
}

export interface RequestExportOptions extends ExportArchiveOptions {
  postIds: string[];
  filename?: string;
  onProgress?: (progress: ExportProgress) => void;
}

export interface ExportResultSummary {
  blob: Blob;
  filename: string;
  metadata: {
    posts: number;
    comments: number;
    media: number;
    archiveBytes?: number;
    uncompressedBytes?: number;
  };
  bytesTransferred: number;
}

async function loadCommentsForPost(postId: string): Promise<Comment[]> {
  const comments = await getAllByIndex<Comment>("comments", "postId", postId);
  return comments ?? [];
}

async function loadMedia(manifestId: string): Promise<ExporterMediaRecord | null> {
  const manifest = await get<Manifest>("manifests", manifestId);
  if (!manifest || !manifest.fileKey) {
    return null;
  }

  try {
    const fileKey = await importKeyRaw(manifest.fileKey);
    const blob = await decryptAndReassembleFile(manifest, fileKey);
    const buffer = await blob.arrayBuffer();
    return {
      id: manifest.fileId,
      filename: manifest.originalName ?? `${manifest.fileId}.bin`,
      mimeType: manifest.mime,
      size: buffer.byteLength,
      base64Data: arrayBufferToBase64(buffer),
      manifestId: manifest.fileId,
    };
  } catch (error) {
    console.warn("[exporter] Failed to decrypt media", manifestId, error);
    return null;
  }
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(value);
  if (!match) return null;
  const encoded = match[1] ?? match[2];
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function buildSelections(
  posts: Post[],
  options: ExportArchiveOptions,
  commentsMap: Map<string, Comment[]>,
  mediaMap: Map<string, ExporterMediaRecord[]>
): ExporterSelection[] {
  return posts.map((post) => {
    const selection: ExporterSelection = {
      post: {
        id: post.id,
        author: post.author,
        type: post.type,
        content: post.content,
        createdAt: post.createdAt,
        editedAt: post.editedAt,
        tags: post.tags,
        manifestIds: post.manifestIds,
      },
    };
    if (options.includeComments) {
      selection.comments = commentsMap.get(post.id) ?? [];
    }
    if (options.includeMedia) {
      selection.media = mediaMap.get(post.id) ?? [];
    }
    return selection;
  });
}

export async function requestAccountExport(options: RequestExportOptions): Promise<ExportResultSummary> {
  const user = getCurrentUser();
  if (!user) {
    throw new Error("No active user");
  }
  if (options.postIds.length === 0) {
    throw new Error("Select at least one post to export");
  }

  const posts = (
    await Promise.all(options.postIds.map((id) => get<Post>("posts", id)))
  ).filter((post): post is Post => Boolean(post));
  if (posts.length === 0) {
    throw new Error("No posts available for export");
  }

  const commentsMap = new Map<string, Comment[]>();
  const mediaMap = new Map<string, ExporterMediaRecord[]>();

  if (options.includeComments) {
    await Promise.all(
      posts.map(async (post) => {
        const comments = await loadCommentsForPost(post.id);
        commentsMap.set(post.id, comments);
      })
    );
  }

  if (options.includeMedia) {
    await Promise.all(
      posts.map(async (post) => {
        if (!post.manifestIds?.length) {
          return;
        }
        const mediaRecords: ExporterMediaRecord[] = [];
        for (const manifestId of post.manifestIds) {
          const media = await loadMedia(manifestId);
          if (media) {
            mediaRecords.push(media);
          }
        }
        if (mediaRecords.length > 0) {
          mediaMap.set(post.id, mediaRecords);
        }
      })
    );
  }

  const selections = buildSelections(posts, options, commentsMap, mediaMap);
  const payload: ExporterRequestPayload & { filename?: string } = {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    },
    options: {
      includePosts: options.includePosts,
      includeComments: options.includeComments,
      includeMedia: options.includeMedia,
    },
    selections,
    requestedAt: new Date().toISOString(),
    ...(options.filename ? { filename: options.filename } : {}),
  };

  const response = await fetch("/api/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to start export");
  }

  const totalHeader = response.headers.get("X-Export-Archive-Bytes") ??
    response.headers.get("Content-Length") ??
    response.headers.get("X-Export-Uncompressed-Bytes");
  const total = totalHeader ? Number(totalHeader) || undefined : undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      bytes += value.length;
      options.onProgress?.({ bytes, total });
    }
  }

  const blob = new Blob(chunks, { type: "application/zip" });
  const filename =
    options.filename ||
    parseContentDispositionFilename(response.headers.get("Content-Disposition")) ||
    `imagination-export-${Date.now()}.zip`;

  const metadata = {
    posts: Number(response.headers.get("X-Export-Post-Count") ?? posts.length),
    comments: Number(response.headers.get("X-Export-Comment-Count") ?? commentsMap.size),
    media: Number(response.headers.get("X-Export-Media-Count") ?? mediaMap.size),
    archiveBytes: total,
    uncompressedBytes: Number(response.headers.get("X-Export-Uncompressed-Bytes") ?? "0") || undefined,
  } satisfies ExportResultSummary["metadata"];

  return {
    blob,
    filename,
    metadata,
    bytesTransferred: bytes,
  };
}

export async function downloadAccountExport(options: RequestExportOptions): Promise<ExportResultSummary> {
  const result = await requestAccountExport(options);
  const url = URL.createObjectURL(result.blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return result;
}

export async function listExportablePosts(): Promise<Post[]> {
  const user = getCurrentUser();
  if (!user) return [];
  const allPosts = await getAll<Post>("posts");
  return allPosts.filter((post) => post.author === user.id);
}
