import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  put: vi.fn(async () => undefined),
  get: vi.fn(async () => undefined),
  getAll: vi.fn(async () => []),
  remove: vi.fn(async () => undefined),
}));

import { genIdentityKeyPair, computeUserId } from "@/lib/crypto";
import type { Post } from "@/types";
import {
  reattributePost,
  signMasterAck,
  signMergeAttestation,
  verifyMasterAck,
  verifyMergeAttestation,
} from "../accountMerge";

async function identity() {
  const keys = await genIdentityKeyPair();
  return { ...keys, id: await computeUserId(keys.publicKey) };
}

const transfers = { swarm: 3.2, credits: 450, mintme: 0, txIds: ["tx-swarm", "credit-1"] };

describe("account merge attestations", () => {
  it("verifies an attestation signed by the retiring key and rejects tampering", async () => {
    const retiring = await identity();
    const master = await identity();
    const a = await signMergeAttestation({ retiringId: retiring.id, masterId: master.id, transfers, privateKey: retiring.privateKey, publicKey: retiring.publicKey });
    expect(a.type).toBe("account_merged");
    expect(await verifyMergeAttestation(a)).toBe(true);
    expect(await verifyMergeAttestation({ ...a, masterId: retiring.id })).toBe(false);
    expect(await verifyMergeAttestation({ ...a, transfers: { ...transfers, swarm: 99 } })).toBe(false);
    expect(await verifyMergeAttestation({ ...a, transfers: { ...transfers, txIds: ["other"] } })).toBe(false);
    // Signed by someone else claiming to be the retiring account.
    const forged = await signMergeAttestation({ retiringId: retiring.id, masterId: master.id, transfers, privateKey: master.privateKey, publicKey: master.publicKey });
    expect(await verifyMergeAttestation(forged)).toBe(false);
    await expect(signMergeAttestation({ retiringId: master.id, masterId: master.id, transfers, privateKey: master.privateKey, publicKey: master.publicKey })).rejects.toThrow();
  });

  it("binds the master's ack to the exact attestation", async () => {
    const retiring = await identity();
    const master = await identity();
    const a = await signMergeAttestation({ retiringId: retiring.id, masterId: master.id, transfers, privateKey: retiring.privateKey, publicKey: retiring.publicKey });
    const ack = await signMasterAck({ attestation: a, privateKey: master.privateKey, publicKey: master.publicKey });
    expect(await verifyMasterAck(ack, a)).toBe(true);
    const other = await signMergeAttestation({ retiringId: retiring.id, masterId: master.id, transfers: { ...transfers, credits: 1 }, privateKey: retiring.privateKey, publicKey: retiring.publicKey });
    expect(await verifyMasterAck(ack, other)).toBe(false);
    // An ack signed by the retiring key is not the master's.
    const selfAck = await signMasterAck({ attestation: a, privateKey: retiring.privateKey, publicKey: retiring.publicKey });
    expect(await verifyMasterAck(selfAck, a)).toBe(false);
  });

  it("re-attributes a post to the master with the attestation as its link", async () => {
    const retiring = await identity();
    const master = await identity();
    const a = await signMergeAttestation({ retiringId: retiring.id, masterId: master.id, transfers, privateKey: retiring.privateKey, publicKey: retiring.publicKey });
    const post: Post = {
      id: "p1", author: retiring.id, authorName: "DeviceB", type: "text", content: "hello", createdAt: "2026-11-18T00:00:00.000Z",
      signature: "old", signerPublicKey: "old-key", signatureAlgorithm: "ed25519", signedAt: "x", _syncedToMesh: true, _origin: "synced",
      comments: [], likes: 3,
    };
    const moved = reattributePost(post, { id: master.id, username: "DeviceA" }, a, "2026-11-19T00:00:00.000Z");
    expect(moved.id).toBe("p1");
    expect(moved.author).toBe(master.id);
    expect(moved.authorName).toBe("DeviceA");
    expect(moved.editedAt).toBe("2026-11-19T00:00:00.000Z");
    expect(moved.createdAt).toBe(post.createdAt);
    expect(moved.likes).toBe(3);
    expect(moved.mergedFrom).toBe(a);
    expect(moved.signature).toBeUndefined();
    expect(moved._syncedToMesh).toBeUndefined();
    expect(moved._origin).toBe("local");
  });
});
