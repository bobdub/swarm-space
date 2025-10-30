import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";
import type {
  ExportArchiveOptions,
  ExporterArchiveMetadata,
  ExporterRequestPayload,
  ExporterUserSummary,
} from "../src/types/exporter";

interface ZipEntry {
  path: string;
  data: Uint8Array;
  crc32: number;
  size: number;
  modTime: number;
  modDate: number;
  offset: number;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const encoder = new TextEncoder();

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosDate =
    ((year - 1980) << 9) |
    (month << 5) |
    day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;

  return { date: dosDate, time: dosTime };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.replace(/\\+/g, "/").replace(/^\/+/, "");
  const parts = trimmed.split("/").filter(Boolean);
  const sanitized = parts.map((part) =>
    part
      .replace(/[\x00-\x1f<>:"|?*\\]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
  return sanitized.join("/");
}

class ZipStreamBuilder {
  constructor(private readonly entries: ZipEntry[] = []) {}

  addFile(path: string, data: Uint8Array, fileDate?: Date): void {
    const cleanPath = sanitizeFilename(path);
    const normalized = cleanPath.length === 0 ? "file" : cleanPath;
    const now = fileDate ?? new Date();
    const { date, time } = toDosDateTime(now);
    const entry: ZipEntry = {
      path: normalized,
      data,
      crc32: crc32(data),
      size: data.length,
      modDate: date,
      modTime: time,
      offset: 0,
    };
    this.entries.push(entry);
  }

  buildStream(): { stream: ReadableStream<Uint8Array>; size: number; fileCount: number } {
    const chunks: Uint8Array[] = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBytes = encoder.encode(entry.path);
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, entry.modTime, true);
      view.setUint16(12, entry.modDate, true);
      view.setUint32(14, entry.crc32, true);
      view.setUint32(18, entry.size, true);
      view.setUint32(22, entry.size, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      header.set(nameBytes, 30);

      entry.offset = offset;
      offset += header.length + entry.data.length;
      chunks.push(header, entry.data);
    }

    let centralDirectorySize = 0;
    const centralChunks: Uint8Array[] = [];
    for (const entry of this.entries) {
      const nameBytes = encoder.encode(entry.path);
      const central = new Uint8Array(46 + nameBytes.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
      view.setUint16(4, 0x0314, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, entry.modTime, true);
      view.setUint16(14, entry.modDate, true);
      view.setUint32(16, entry.crc32, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.offset, true);
      central.set(nameBytes, 46);
      centralDirectorySize += central.length;
      centralChunks.push(central);
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, this.entries.length, true);
    endView.setUint16(10, this.entries.length, true);
    endView.setUint32(12, centralDirectorySize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    for (const chunk of centralChunks) {
      chunks.push(chunk);
    }
    chunks.push(end);

    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
        } else {
          controller.close();
        }
      },
    });

    return { stream, size, fileCount: this.entries.length };
  }

  getEntries(): ZipEntry[] {
    return this.entries.slice();
  }
}

function decodeBase64(base64: string): Uint8Array {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function ensureMediaFilename(media: { filename: string; id: string }, existing: Map<string, number>): string {
  const baseName = media.filename && media.filename.length > 0 ? media.filename : `${media.id}.bin`;
  const sanitized = sanitizeFilename(baseName);
  const safe = sanitized.length > 0 ? sanitized : `${media.id}.bin`;
  const segments = safe.split("/");
  const leaf = segments.pop() ?? `${media.id}.bin`;
  const extMatch = leaf.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = ext ? leaf.slice(0, -ext.length) : leaf;
  const dir = segments.join("/");
  const key = dir ? `${dir}/${base}` : base;
  const counter = existing.get(key) ?? 0;
  existing.set(key, counter + 1);
  const suffix = counter === 0 ? "" : ` (${counter})`;
  const nextLeaf = `${base}${suffix}${ext}`;
  return dir ? `${dir}/${nextLeaf}` : nextLeaf;
}

function summarizeOptions(options: ExportArchiveOptions): ExportArchiveOptions {
  return {
    includePosts: Boolean(options?.includePosts),
    includeComments: Boolean(options?.includeComments),
    includeMedia: Boolean(options?.includeMedia),
  };
}

function summarizeUser(user: ExporterUserSummary): ExporterUserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? null,
  };
}

function calculateUncompressedBytes(payload: ExporterRequestPayload, options: ExportArchiveOptions): number {
  let total = 0;
  if (options.includePosts) {
    for (const selection of payload.selections) {
      const encoded = encoder.encode(JSON.stringify(selection.post));
      total += encoded.length;
    }
  }
  if (options.includeComments) {
    for (const selection of payload.selections) {
      if (!selection.comments?.length) continue;
      const encoded = encoder.encode(JSON.stringify(selection.comments));
      total += encoded.length;
    }
  }
  if (options.includeMedia) {
    for (const selection of payload.selections) {
      if (!selection.media?.length) continue;
      for (const media of selection.media) {
        total += media.size;
      }
    }
  }
  return total;
}

export interface AssembleExportArchiveResult {
  stream: ReadableStream<Uint8Array>;
  metadata: ExporterArchiveMetadata;
  filename: string;
}

export async function assembleExportArchive(
  payload: ExporterRequestPayload & { filename?: string }
): Promise<AssembleExportArchiveResult> {
  const options = summarizeOptions(payload.options);
  const mediaFilenames = new Map<string, number>();

  const now = new Date();
  const requestedAt = payload.requestedAt ? new Date(payload.requestedAt) : now;
  const user = summarizeUser(payload.user);
  const rawFilename =
    payload.filename || `imagination-export-${requestedAt.toISOString().replace(/[:.]/g, "-")}.zip`;
  const filename = sanitizeFilename(rawFilename) || `imagination-export-${requestedAt.getTime()}.zip`;

  const metadata: ExporterArchiveMetadata = {
    generatedAt: now.toISOString(),
    user,
    options,
    postCount: 0,
    commentCount: 0,
    mediaCount: 0,
    fileCount: 0,
    uncompressedBytes: calculateUncompressedBytes(payload, options),
    archiveBytes: 0,
  };

  const postsCollection: unknown[] = [];
  const commentsCollection: Record<string, unknown[]> = {};
  const mediaIndex: Array<{ id: string; filename: string; size: number; mimeType?: string; manifestId?: string }> = [];
  const attachments: Array<{ path: string; data: Uint8Array }> = [];

  for (const selection of payload.selections) {
    if (options.includePosts) {
      postsCollection.push(selection.post);
      metadata.postCount += 1;
    }
    if (options.includeComments && selection.comments?.length) {
      commentsCollection[selection.post.id] = selection.comments;
      metadata.commentCount += selection.comments.length;
    }
    if (options.includeMedia && selection.media?.length) {
      for (const media of selection.media) {
        const filenameForMedia = ensureMediaFilename(media, mediaFilenames);
        const bytes = decodeBase64(media.base64Data);
        attachments.push({ path: `media/${filenameForMedia}`, data: bytes });
        mediaIndex.push({
          id: media.id,
          filename: filenameForMedia,
          size: media.size,
          mimeType: media.mimeType,
          manifestId: media.manifestId,
        });
        metadata.mediaCount += 1;
      }
    }
  }

  const userJson = encoder.encode(JSON.stringify(user, null, 2));
  const postsJson = options.includePosts
    ? encoder.encode(JSON.stringify(postsCollection, null, 2))
    : undefined;
  const commentsJson = options.includeComments
    ? encoder.encode(JSON.stringify(commentsCollection, null, 2))
    : undefined;
  const mediaIndexJson = options.includeMedia
    ? encoder.encode(JSON.stringify(mediaIndex, null, 2))
    : undefined;

  const buildArchive = (meta: ExporterArchiveMetadata) => {
    const builder = new ZipStreamBuilder();
    builder.addFile("user.json", userJson, requestedAt);
    builder.addFile("metadata.json", encoder.encode(JSON.stringify(meta, null, 2)), requestedAt);
    if (postsJson) {
      builder.addFile("posts/posts.json", postsJson, requestedAt);
    }
    if (commentsJson) {
      builder.addFile("comments/comments.json", commentsJson, requestedAt);
    }
    if (mediaIndexJson) {
      builder.addFile("media/index.json", mediaIndexJson, requestedAt);
    }
    for (const attachment of attachments) {
      builder.addFile(attachment.path, attachment.data, requestedAt);
    }
    return builder.buildStream();
  };

  let archive = buildArchive(metadata);
  let iterations = 0;
  while (
    (archive.size !== metadata.archiveBytes || archive.fileCount !== metadata.fileCount) &&
    iterations < 5
  ) {
    metadata.archiveBytes = archive.size;
    metadata.fileCount = archive.fileCount;
    archive = buildArchive(metadata);
    iterations += 1;
  }

  metadata.archiveBytes = archive.size;
  metadata.fileCount = archive.fileCount;

  return {
    stream: archive.stream,
    metadata,
    filename,
  };
}
