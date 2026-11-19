/**
 * Minimal in-browser ZIP (PKWARE APPNOTE) writer + reader.
 *
 * Writer: STORE entries (media is already compressed; markdown is small),
 * CRC-32, UTF-8 names (general-purpose flag bit 11), emitted chunk by chunk
 * so callers can stream into a Blob or a ReadableStream.
 *
 * Reader: walks the central directory; supports STORE and DEFLATE (the
 * latter through `DecompressionStream("deflate-raw")`) so archives re-zipped
 * by an OS file manager still import.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface ZipFileEntry {
  name: string;
  data: Uint8Array;
  lastModified?: Date;
}

export interface ZipChunk {
  type: "file" | "central" | "eocd";
  name?: string;
  data: Uint8Array;
}

export interface BuiltZip {
  chunks: ZipChunk[];
  totalSize: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

const UTF8_FLAG = 0x0800;

function encodeFile(entry: ZipFileEntry, offset: number): { fileChunk: ZipChunk; centralChunk: ZipChunk; length: number } {
  const nameBytes = textEncoder.encode(entry.name);
  const dataBytes = entry.data;
  const crc = crc32(dataBytes);
  const { date, time } = dosDateTime(entry.lastModified ?? new Date());

  const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, UTF8_FLAG, true);
  lv.setUint16(8, 0, true);
  lv.setUint16(10, time, true);
  lv.setUint16(12, date, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, dataBytes.length, true);
  lv.setUint32(22, dataBytes.length, true);
  lv.setUint16(26, nameBytes.length, true);
  lv.setUint16(28, 0, true);
  local.set(nameBytes, 30);
  local.set(dataBytes, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 0x031e, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, UTF8_FLAG, true);
  cv.setUint16(10, 0, true);
  cv.setUint16(12, time, true);
  cv.setUint16(14, date, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, dataBytes.length, true);
  cv.setUint32(24, dataBytes.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, offset, true);
  central.set(nameBytes, 46);

  return {
    fileChunk: { type: "file", name: entry.name, data: local },
    centralChunk: { type: "central", name: entry.name, data: central },
    length: local.length,
  };
}

export function buildZip(entries: ZipFileEntry[]): BuiltZip {
  if (entries.length > 0xffff) throw new Error("Too many archive entries for a ZIP without ZIP64.");
  const fileChunks: ZipChunk[] = [];
  const centralChunks: ZipChunk[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { fileChunk, centralChunk, length } = encodeFile(entry, offset);
    fileChunks.push(fileChunk);
    centralChunks.push(centralChunk);
    offset += length;
  }
  if (offset > 0xffffffff) throw new Error("Archive exceeds 4 GB; ZIP64 is not supported.");
  const centralSize = centralChunks.reduce((sum, c) => sum + c.data.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return {
    chunks: [...fileChunks, ...centralChunks, { type: "eocd", data: eocd }],
    totalSize: offset + centralSize + eocd.length,
  };
}

export function zipToBlob(entries: ZipFileEntry[]): Blob {
  const { chunks } = buildZip(entries);
  return new Blob(chunks.map((c) => c.data as BlobPart), { type: "application/zip" });
}

// ── Reader ─────────────────────────────────────────────────────────────

export interface ZipReadEntry {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack compressed archives.");
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Response(copy).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** List entries from an in-memory ZIP. Each entry decompresses lazily. */
export function readZip(bytes: Uint8Array): ZipReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries: ZipReadEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const method = view.getUint16(ptr + 10, true);
    const crc = view.getUint32(ptr + 16, true);
    const compSize = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = textDecoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    entries.push({
      name,
      size,
      async read() {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Corrupt ZIP entry ${name}.`);
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = bytes.subarray(start, start + compSize);
        let data: Uint8Array;
        if (method === 0) data = raw.slice();
        else if (method === 8) data = await inflateRaw(raw);
        else throw new Error(`Unsupported compression in ${name}.`);
        if (crc32(data) !== crc) throw new Error(`Checksum mismatch in ${name}.`);
        return data;
      },
    });
  }
  return entries;
}
