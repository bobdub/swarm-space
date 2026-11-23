import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { ref?: string; fileId?: string }) => { s(n).set((v.ref ?? v.fileId) as string, v); },
  get: async (n: string, k: string) => s(n).get(k),
}));

let signatureValid = true;
vi.mock("@/lib/p2p/replication", () => ({
  verifyManifestSignature: async () => signatureValid,
}));

vi.mock("@/lib/fileEncryption", async () => ({
  importFileKey: async (m: { fileKeyRaw?: string }) => {
    if (!m.fileKeyRaw) throw new Error("no key");
    const raw = Uint8Array.from(atob(m.fileKeyRaw), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  },
}));

import { buildTorrentBinding, fillTorrentFromCoin, TORRENT_FILLED_EVENT } from "../mediaCoinTorrentFill";

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

/** Chunk a file the way fileEncryption.chunkAndEncryptFile does (random IVs). */
async function seedFile(fileId: string, data: Uint8Array, chunkSize: number) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const chunks: Array<Record<string, unknown>> = [];
  for (let seq = 0, off = 0; off < data.byteLength; seq++, off += chunkSize) {
    const slice = data.subarray(off, Math.min(off + chunkSize, data.byteLength));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, slice));
    const ref = `chunk-${hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cipher + seq)))}`;
    chunks.push({ ref, seq, total: 0, size: slice.byteLength, iv: b64(iv), cipher, meta: {} });
  }
  const manifest = {
    fileId,
    chunks: chunks.map((c) => c.ref as string),
    mime: "audio/mp4",
    originalName: "song.m4a",
    size: data.byteLength,
    fileKeyRaw: b64(await crypto.subtle.exportKey("raw", key)),
    signature: "sig",
  };
  return { manifest, chunks };
}

const data = Uint8Array.from({ length: 10 }, (_, i) => i * 7);

beforeEach(() => {
  stores.clear();
  localStorage.clear();
  signatureValid = true;
});

describe("mediaCoinTorrentFill", () => {
  it("fills only the missing chunks of a partial torrent, byte-identical", async () => {
    const { manifest, chunks } = await seedFile("file-p", data, 4);
    // Sender has the whole file and builds the binding.
    s("manifests").set("file-p", manifest);
    for (const c of chunks) s("chunks").set(c.ref as string, c);
    const binding = await buildTorrentBinding("file-p");
    expect(binding?.chunkSizes).toEqual([4, 4, 2]);

    // Receiver has the manifest and only the middle chunk.
    stores.clear();
    s("manifests").set("file-p", manifest);
    s("chunks").set(chunks[1].ref as string, chunks[1]);
    const events: unknown[] = [];
    const onFill = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener(TORRENT_FILLED_EVENT, onFill);

    const result = await fillTorrentFromCoin(binding!, data);
    window.removeEventListener(TORRENT_FILLED_EVENT, onFill);

    expect(result).toMatchObject({ status: "complete", had: 1, filled: 2, mismatched: 0, total: 3 });
    for (const c of chunks) expect(s("chunks").get(c.ref as string)).toMatchObject({ cipher: c.cipher, iv: c.iv });
    expect(events).toEqual([expect.objectContaining({ fileId: "file-p", status: "complete" })]);
  });

  it("saves the carried manifest when this device has none of the media", async () => {
    const { manifest, chunks } = await seedFile("file-n", data, 4);
    const binding = {
      fileId: "file-n",
      manifest,
      chunkIvs: chunks.map((c) => c.iv as string),
      chunkSizes: chunks.map((c) => c.size as number),
    };
    const result = await fillTorrentFromCoin(binding, data);
    expect(result).toMatchObject({ status: "complete", had: 0, filled: 3 });
    expect(s("manifests").get("file-n")).toMatchObject({ fileId: "file-n" });
  });

  it("rejects an unsigned carried manifest", async () => {
    signatureValid = false;
    const { manifest, chunks } = await seedFile("file-u", data, 4);
    const binding = { fileId: "file-u", manifest, chunkIvs: chunks.map((c) => c.iv as string), chunkSizes: [4, 4, 2] };
    expect((await fillTorrentFromCoin(binding, data)).status).toBe("invalid");
    expect(s("manifests").has("file-u")).toBe(false);
  });

  it("never stores a chunk whose bytes do not match the manifest", async () => {
    const { manifest, chunks } = await seedFile("file-x", data, 4);
    s("manifests").set("file-x", manifest);
    const binding = { fileId: "file-x", manifest, chunkIvs: chunks.map((c) => c.iv as string), chunkSizes: [4, 4, 2] };
    const tampered = data.slice();
    tampered[5] ^= 0xff; // corrupt the middle chunk
    const result = await fillTorrentFromCoin(binding, tampered);
    expect(result).toMatchObject({ status: "partial", filled: 2, mismatched: 1 });
    expect(s("chunks").has(chunks[1].ref as string)).toBe(false);
  });

  it("leaves a flushed file flushed", async () => {
    const { manifest, chunks } = await seedFile("file-f", data, 4);
    localStorage.setItem("swarm-flushed-assets", JSON.stringify(["file-f"]));
    const binding = { fileId: "file-f", manifest, chunkIvs: chunks.map((c) => c.iv as string), chunkSizes: [4, 4, 2] };
    expect((await fillTorrentFromCoin(binding, data)).status).toBe("flushed");
    expect(stores.get("chunks")?.size ?? 0).toBe(0);
  });
});
