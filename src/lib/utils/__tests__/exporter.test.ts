import { describe, expect, test } from "bun:test";
import { createAccountExportStream, type ExporterDependencies } from "@/lib/utils/exporter";
import type { Post } from "@/types";
import type { Manifest } from "@/lib/fileEncryption";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
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

interface ParsedEntry {
  name: string;
  data: Uint8Array;
}

function parseZipArchive(buffer: Uint8Array): ParsedEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  // Find EOCD signature by scanning backwards
  let eocdOffset = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("EOCD not found");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ParsedEntry[] = [];
  let pointer = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    const signature = view.getUint32(pointer, true);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at ${pointer}`);
    }
    const fileNameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const localOffset = view.getUint32(pointer + 42, true);

    const nameStart = pointer + 46;
    const nameBytes = buffer.slice(nameStart, nameStart + fileNameLength);
    const name = textDecoder.decode(nameBytes);

    const localSignature = view.getUint32(localOffset, true);
    if (localSignature !== 0x04034b50) {
      throw new Error(`Invalid local file header at ${localOffset}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.slice(dataStart, dataStart + compressedSize);

    entries.push({ name, data });

    pointer = nameStart + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

describe("createAccountExportStream", () => {
  const basePost: Post = {
    id: "post-1",
    author: "user-1",
    type: "text",
    content: "Hello world",
    createdAt: new Date().toISOString(),
    manifestIds: ["manifest-1"],
  };

  const manifest: Manifest = {
    fileId: "manifest-1",
    chunks: [],
    mime: "text/plain",
    size: 5,
    originalName: "note.txt",
    fileKey: "",
    createdAt: new Date().toISOString(),
  };

  test("packages posts and media into a zip archive", async () => {
    const dependencies: ExporterDependencies = {
      async loadPosts() {
        return [basePost];
      },
      async resolveAttachment() {
        return {
          manifest,
          data: textEncoder.encode("hello").buffer,
        };
      },
    };

    const { stream, summary } = await createAccountExportStream(
      { includePosts: true, includeMedia: true },
      { dependencies },
    );

    const zipBytes = await streamToUint8Array(stream);
    const entries = parseZipArchive(zipBytes);

    const files = Object.fromEntries(entries.map((entry) => [entry.name, entry.data]));

    expect(summary.counts.posts).toBe(1);
    expect(summary.counts.attachments).toBe(1);
    expect(files["posts/posts.json"]).toBeDefined();
    expect(files[`media/${manifest.fileId}/note.txt`]).toBeDefined();
    expect(files[`media/${manifest.fileId}/manifest.json`]).toBeDefined();

    const postsJson = textDecoder.decode(files["posts/posts.json"]);
    const parsedPosts = JSON.parse(postsJson) as Post[];
    expect(parsedPosts).toHaveLength(1);
    expect(parsedPosts[0].id).toBe("post-1");

    const attachmentText = textDecoder.decode(files[`media/${manifest.fileId}/note.txt`]);
    expect(attachmentText).toBe("hello");
  });

  test("emits progress updates while streaming", async () => {
    const updates: number[] = [];
    const dependencies: ExporterDependencies = {
      async loadPosts() {
        return [basePost];
      },
      async resolveAttachment() {
        return {
          manifest,
          data: textEncoder.encode("world").buffer,
        };
      },
    };

    const { stream } = await createAccountExportStream(
      { includePosts: true, includeMedia: true },
      {
        dependencies,
        onProgress: (update) => {
          updates.push(update.percent);
        },
      },
    );

    await streamToUint8Array(stream);

    expect(updates.length).toBeGreaterThan(1);
    expect(updates[updates.length - 1]).toBeGreaterThanOrEqual(100);
    expect(updates[0]).toBeLessThanOrEqual(0);
  });

  test("records warnings when media cannot be resolved", async () => {
    const dependencies: ExporterDependencies = {
      async loadPosts() {
        return [basePost];
      },
      async resolveAttachment() {
        return null;
      },
    };

    const { summary } = await createAccountExportStream(
      { includePosts: false, includeMedia: true },
      { dependencies },
    );

    expect(summary.counts.attachments).toBe(0);
    expect(summary.warnings.length).toBeGreaterThan(0);
  });
});

