import { describe, it, expect, vi, beforeEach } from "vitest";

const stores = new Map<string, Map<string, unknown>>();
const s = (n: string) => {
  if (!stores.has(n)) stores.set(n, new Map());
  return stores.get(n)!;
};

vi.mock("@/lib/store", () => ({
  put: async (n: string, v: { peerId?: string }) => { s(n).set(v.peerId as string, v); },
  get: async (n: string, k: string) => s(n).get(k),
  getAll: async (n: string) => Array.from(s(n).values()),
  remove: async (n: string, k: string) => { s(n).delete(k); },
  getChunk: async (ref: string) => (s("rawChunks").get(ref) as Uint8Array | undefined) ?? null,
}));

vi.mock("@/lib/fileEncryption", () => ({
  importFileKey: async () => ({}) as CryptoKey,
  decryptAndReassembleFile: async (m: { chunks: string[] }) =>
    new Blob(m.chunks.map((c) => s("plain").get(c) as string)),
}));

import { recordVaultEntry, ensureVault } from "../syncVault";
import { resolveFromVaults } from "../vaultLookup";

beforeEach(() => stores.clear());

async function seed(ref: string) {
  const v = await ensureVault("peer-a");
  v.coins.push({ coinId: "coin-1", role: "media", fillBytes: 0, capacityBytes: 100, createdAt: "", sealed: true, wrapped: true });
  s("syncVaults").set("peer-a", v);
  await recordVaultEntry("peer-a", "hash-1", { coinId: "coin-1", offset: 0, length: 6, ref });
}

describe("resolveFromVaults", () => {
  it("reassembles a multi-chunk file through its manifest", async () => {
    s("manifests").set("file-1", { fileId: "file-1", chunks: ["c1", "c2"] });
    s("plain").set("c1", "abc");
    s("plain").set("c2", "def");
    await seed("file-1");

    const hit = await resolveFromVaults("hash-1");
    expect(hit && new TextDecoder().decode(hit.bytes)).toBe("abcdef");
  });

  it("falls back to a direct chunk read for legacy refs", async () => {
    s("rawChunks").set("chunk-ref", new Uint8Array([1, 2, 3]));
    await seed("chunk-ref");

    const hit = await resolveFromVaults("hash-1");
    expect(Array.from(hit!.bytes)).toEqual([1, 2, 3]);
  });
});
