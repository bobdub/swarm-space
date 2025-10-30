import assert from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder } from "node:util";
import type { ExporterRequestPayload } from "../../src/types/exporter";
import { assembleExportArchive } from "../exporter";

const decoder = new TextDecoder();

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function readUint16LE(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readUint32LE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}

interface ParsedEntry {
  filename: string;
  data: Uint8Array;
}

function parseZip(buffer: Uint8Array): Map<string, ParsedEntry> {
  const entries = new Map<string, ParsedEntry>();
  let eocdOffset = buffer.length - 22;
  while (eocdOffset >= 0) {
    if (readUint32LE(buffer, eocdOffset) === 0x06054b50) break;
    eocdOffset--;
  }
  assert.ok(eocdOffset >= 0, "End of central directory not found");
  const centralDirectorySize = readUint32LE(buffer, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(buffer, eocdOffset + 16);
  const totalEntries = readUint16LE(buffer, eocdOffset + 10);

  let cursor = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i++) {
    const signature = readUint32LE(buffer, cursor);
    assert.equal(signature, 0x02014b50, "Invalid central directory signature");
    const fileNameLength = readUint16LE(buffer, cursor + 28);
    const extraLength = readUint16LE(buffer, cursor + 30);
    const commentLength = readUint16LE(buffer, cursor + 32);
    const compressedSize = readUint32LE(buffer, cursor + 20);
    const localHeaderOffset = readUint32LE(buffer, cursor + 42);
    const nameBytes = buffer.slice(cursor + 46, cursor + 46 + fileNameLength);
    const filename = decoder.decode(nameBytes);

    const localSignature = readUint32LE(buffer, localHeaderOffset);
    assert.equal(localSignature, 0x04034b50, "Invalid local file header signature");
    const localNameLength = readUint16LE(buffer, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const data = buffer.slice(dataStart, dataEnd);

    entries.set(filename, { filename, data });

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  const expectedCentralEnd = centralDirectoryOffset + centralDirectorySize;
  assert.ok(expectedCentralEnd <= buffer.length, "Central directory exceeds buffer length");

  return entries;
}

test("assembleExportArchive builds archive with posts, comments, and media", async () => {
  const payload: ExporterRequestPayload & { filename?: string } = {
    user: { id: "u-1", username: "alice", displayName: "Alice" },
    options: { includePosts: true, includeComments: true, includeMedia: true },
    selections: [
      {
        post: {
          id: "post-1",
          author: "u-1",
          type: "text",
          content: "Hello world",
          createdAt: "2024-01-01T00:00:00.000Z",
          manifestIds: ["media-1"],
        },
        comments: [
          {
            id: "comment-1",
            postId: "post-1",
            author: "u-1",
            createdAt: "2024-01-02T00:00:00.000Z",
            text: "Great post!",
          },
        ],
        media: [
          {
            id: "media-1",
            filename: "greeting.txt",
            mimeType: "text/plain",
            size: 12,
            base64Data: Buffer.from("Hello Archive!", "utf8").toString("base64"),
            manifestId: "manifest-1",
          },
        ],
      },
    ],
    requestedAt: "2024-01-05T12:00:00.000Z",
    filename: "Alice Export.zip",
  };

  const result = await assembleExportArchive(payload);
  assert.equal(result.filename, "Alice Export.zip");
  assert.equal(result.metadata.postCount, 1);
  assert.equal(result.metadata.commentCount, 1);
  assert.equal(result.metadata.mediaCount, 1);
  assert.ok(result.metadata.archiveBytes > 0);

  const data = await collectStream(result.stream);
  assert.equal(data.length, result.metadata.archiveBytes);

  const entries = parseZip(data);
  assert.ok(entries.has("user.json"));
  assert.ok(entries.has("metadata.json"));
  assert.ok(entries.has("posts/posts.json"));
  assert.ok(entries.has("comments/comments.json"));
  assert.ok(entries.has("media/index.json"));
  assert.ok(entries.has("media/greeting.txt"));

  const metadataJson = JSON.parse(decoder.decode(entries.get("metadata.json")!.data));
  assert.equal(metadataJson.archiveBytes, data.length);
  assert.equal(metadataJson.postCount, 1);
  assert.equal(metadataJson.mediaCount, 1);

  const mediaData = decoder.decode(entries.get("media/greeting.txt")!.data);
  assert.equal(mediaData, "Hello Archive!");
});


test("assembleExportArchive respects option filters", async () => {
  const payload: ExporterRequestPayload & { filename?: string } = {
    user: { id: "u-2", username: "bob" },
    options: { includePosts: true, includeComments: false, includeMedia: false },
    selections: [
      {
        post: {
          id: "post-2",
          author: "u-2",
          type: "text",
          content: "Filtered",
          createdAt: "2024-02-01T00:00:00.000Z",
        },
        comments: [
          {
            id: "comment-ignored",
            postId: "post-2",
            author: "u-2",
            createdAt: "2024-02-02T00:00:00.000Z",
            text: "Should not export",
          },
        ],
        media: [
          {
            id: "media-ignored",
            filename: "ignored.bin",
            mimeType: "application/octet-stream",
            size: 4,
            base64Data: Buffer.from([0, 1, 2, 3]).toString("base64"),
          },
        ],
      },
    ],
  };

  const result = await assembleExportArchive(payload);
  assert.equal(result.metadata.postCount, 1);
  assert.equal(result.metadata.commentCount, 0);
  assert.equal(result.metadata.mediaCount, 0);

  const data = await collectStream(result.stream);
  const entries = parseZip(data);
  assert.ok(entries.has("posts/posts.json"));
  assert.ok(!entries.has("comments/comments.json"));
  assert.ok(!entries.has("media/index.json"));
});
