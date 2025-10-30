import { get, getAll } from "../store";
import type { Post } from "@/types";
import { getCurrentUser } from "../auth";
import type { Manifest } from "../fileEncryption";
import { decryptAndReassembleFile, importKeyRaw } from "../fileEncryption";

const textEncoder = new TextEncoder();

interface ZipFileEntry {
  name: string;
  data: Uint8Array;
  lastModified?: Date;
}

interface BuiltZip {
  chunks: ZipChunk[];
  totalSize: number;
}

interface ZipChunk {
  type: "file" | "central" | "eocd";
  name?: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function dosDateTime(date: Date): { date: number; time: number } {
  let year = date.getFullYear();
  if (year < 1980) {
    year = 1980;
  } else if (year > 2107) {
    year = 2107;
  }
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { date: dosDate, time: dosTime };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodeFile(entry: ZipFileEntry, offset: number): { fileChunk: ZipChunk; centralChunk: ZipChunk; length: number } {
  const nameBytes = textEncoder.encode(entry.name);
  const dataBytes = entry.data;
  const crc = crc32(dataBytes);
  const modified = entry.lastModified ?? new Date();
  const { date, time } = dosDateTime(modified);

  const localHeader = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true); // version needed
  localView.setUint16(6, 0, true); // flags
  localView.setUint16(8, 0, true); // compression method: store
  localView.setUint16(10, time, true);
  localView.setUint16(12, date, true);
  localView.setUint32(14, crc, true);
  localView.setUint32(18, dataBytes.length, true);
  localView.setUint32(22, dataBytes.length, true);
  localView.setUint16(26, nameBytes.length, true);
  localView.setUint16(28, 0, true); // extra length
  localHeader.set(nameBytes, 30);

  const fileRecord = concatChunks([localHeader, dataBytes]);

  const centralHeader = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(centralHeader.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 0x031e, true); // version made by (3.0 UNIX)
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint16(12, time, true);
  centralView.setUint16(14, date, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, dataBytes.length, true);
  centralView.setUint32(24, dataBytes.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint16(30, 0, true);
  centralView.setUint16(32, 0, true);
  centralView.setUint16(34, 0, true);
  centralView.setUint16(36, 0, true);
  centralView.setUint32(38, 0, true);
  centralView.setUint32(42, offset, true);
  centralHeader.set(nameBytes, 46);

  return {
    fileChunk: { type: "file", name: entry.name, data: fileRecord },
    centralChunk: { type: "central", name: entry.name, data: centralHeader },
    length: fileRecord.length,
  };
}

function buildZip(entries: ZipFileEntry[]): BuiltZip {
  const fileChunks: ZipChunk[] = [];
  const centralChunks: ZipChunk[] = [];
  let offset = 0;

  for (const entry of entries) {
    const { fileChunk, centralChunk, length } = encodeFile(entry, offset);
    fileChunks.push(fileChunk);
    centralChunks.push(centralChunk);
    offset += length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);
  eocdView.setUint16(20, 0, true);

  const chunks = [...fileChunks, ...centralChunks, { type: "eocd" as const, data: eocd }];
  const totalSize = offset + centralSize + eocd.length;

  return { chunks, totalSize };
}

function sanitizeFilename(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

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
      const key = await importKeyRaw(manifest.fileKey);
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

  const summary: ExportSummary = {
    generatedAt: new Date().toISOString(),
    selection: {
      includePosts,
      includeMedia,
      postIds: options.postIds,
      manifestIds: options.manifestIds,
    },
    counts: {
      posts: postsToInclude.length,
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
    warnings,
  };

  if (includePosts) {
    const postsJson = JSON.stringify(postsToInclude, null, 2);
    entries.push({
      name: "posts/posts.json",
      data: textEncoder.encode(postsJson),
    });
  }

  for (const attachment of attachments) {
    const manifest = attachment.manifest;
    const safeName = sanitizeFilename(manifest.originalName ?? manifest.fileId, manifest.fileId);
    const dir = `media/${manifest.fileId}`;
    entries.push({
      name: `${dir}/${safeName}`,
      data: new Uint8Array(attachment.data),
    });
    const manifestJson = JSON.stringify(manifest, null, 2);
    entries.push({
      name: `${dir}/manifest.json`,
      data: textEncoder.encode(manifestJson),
    });
  }

  const summaryJson = JSON.stringify(summary, null, 2);
  entries.push({
    name: "summary.json",
    data: textEncoder.encode(summaryJson),
  });

  summary.counts.files = entries.length;

  const { chunks, totalSize } = buildZip(entries);
  const fileName = options.fileName ?? `flux-export-${Date.now()}.zip`;

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

