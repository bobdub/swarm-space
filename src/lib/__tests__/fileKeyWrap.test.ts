import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "public-user-id-1234" };
vi.mock("../auth", () => ({ getCurrentUser: () => user }));
vi.mock("../p2p/replication", () => ({
  signManifest: vi.fn(async (m: Record<string, unknown>) => ({ ...m, signature: "resigned" })),
}));
vi.mock("../storage/providers/personalServerSync", () => ({
  enqueueManifestForPersonalServers: vi.fn(),
  fetchChunkFromPersonalServers: vi.fn(),
}));

import {
  __resetFileKeyWrapCacheForTests,
  backfillManifestRawKeys,
  exportKeyRaw,
  genFileKey,
  importFileKey,
  unwrapFileKeyFromOwner,
  wrapFileKeyForOwner,
} from "../fileEncryption";
import { get, put } from "../store";

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

/** Recreates the pre-fix (v1) wrap: PBKDF2 over the public userId. */
async function legacyWrap(rawKeyB64: string, userId: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(userId), "PBKDF2", false, ["deriveKey"]);
  const k = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const raw = Uint8Array.from(atob(rawKeyB64), (c) => c.charCodeAt(0));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, raw));
  return { wrapped: b64(ct), iv: b64(iv), salt: b64(salt) };
}

describe("file key wrapping (SEC-002 v2)", () => {
  beforeEach(() => __resetFileKeyWrapCacheForTests());

  it("wraps with a device key that the public userId cannot re-derive", async () => {
    const raw = await exportKeyRaw(await genFileKey());
    const wrapped = await wrapFileKeyForOwner(raw);
    expect(wrapped.version).toBe(2);
    expect(wrapped.salt).toBeUndefined();
    expect(await unwrapFileKeyFromOwner(wrapped)).toBe(raw);

    // An attacker who knows the userId and runs the old derivation gets nowhere.
    await expect(unwrapFileKeyFromOwner({ ...wrapped, version: 1, salt: b64(new Uint8Array(16)) }))
      .rejects.toThrow();

    const stored = await get<{ k: string; v: CryptoKey }>("meta", `file-key-wrap:${user.id}`);
    expect(stored?.v.extractable).toBe(false);
  });

  it("still opens legacy v1 manifests and migrates the owner's ones to v2", async () => {
    const raw = await exportKeyRaw(await genFileKey());
    const legacy = await legacyWrap(raw, user.id);
    const manifest = {
      fileId: "file-legacy-1", chunks: [], mime: "image/png", size: 1, createdAt: "2026-01-01T00:00:00Z",
      fileKey: legacy.wrapped, fileKeyIv: legacy.iv, fileKeySalt: legacy.salt, fileKeyWrapped: true,
      fileKeyRaw: raw,
    };
    // Reads keep working without the raw key too.
    const { fileKeyRaw: _omit, ...ownerOnly } = manifest;
    expect(await exportKeyRaw(await importFileKey(ownerOnly))).toBe(raw);

    await put("manifests", manifest);
    expect(await backfillManifestRawKeys()).toBe(1);
    const migrated = await get<Record<string, unknown>>("manifests", "file-legacy-1");
    expect(migrated?.fileKeyWrapVersion).toBe(2);
    expect(migrated?.fileKeySalt).toBeUndefined();
    expect(migrated?.fileKey).not.toBe(legacy.wrapped);
    expect(migrated?.signature).toBe("resigned");
    expect(migrated?.fileKeyRaw).toBe(raw);
    expect(await exportKeyRaw(await importFileKey({ ...(migrated as object), fileKeyRaw: undefined }))).toBe(raw);

    // Second pass is a no-op.
    expect(await backfillManifestRawKeys()).toBe(0);
  });

  it("replaces a device key that a JSON backup restore turned into {}", async () => {
    await put("meta", { k: `file-key-wrap:${user.id}`, v: {} });
    __resetFileKeyWrapCacheForTests();
    const raw = await exportKeyRaw(await genFileKey());
    const wrapped = await wrapFileKeyForOwner(raw);
    expect(await unwrapFileKeyFromOwner(wrapped)).toBe(raw);
    const stored = await get<{ v: CryptoKey }>("meta", `file-key-wrap:${user.id}`);
    expect(stored?.v).toBeInstanceOf(CryptoKey);
  });

  it("leaves other users' legacy manifests alone", async () => {
    const raw = await exportKeyRaw(await genFileKey());
    const legacy = await legacyWrap(raw, "someone-else");
    await put("manifests", {
      fileId: "file-foreign-1", chunks: [], mime: "x", size: 1, createdAt: "2026-01-01T00:00:00Z",
      fileKey: legacy.wrapped, fileKeyIv: legacy.iv, fileKeySalt: legacy.salt, fileKeyWrapped: true, fileKeyRaw: raw,
    });
    await backfillManifestRawKeys();
    const after = await get<Record<string, unknown>>("manifests", "file-foreign-1");
    expect(after?.fileKey).toBe(legacy.wrapped);
  });
});
