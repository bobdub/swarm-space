/**
 * Media-as-Coin Engine — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MediaCoinEngine,
  buildMerkleRoot,
  buildMerkleProof,
  verifyMerkleProof,
  type MeshTransportAdapter,
  type MediaCoinManifest,
} from "./mediaCoin.standalone";

// ── Mock Transport ────────────────────────────────────────────────────

function createMockTransport(): MeshTransportAdapter & {
  handlers: Map<string, ((peerId: string, payload: unknown) => void)[]>;
  sentMessages: { channel: string; peerId: string; payload: unknown }[];
  broadcasts: { channel: string; payload: unknown }[];
} {
  const handlers = new Map<
    string,
    ((peerId: string, payload: unknown) => void)[]
  >();
  const sentMessages: { channel: string; peerId: string; payload: unknown }[] =
    [];
  const broadcasts: { channel: string; payload: unknown }[] = [];

  return {
    handlers,
    sentMessages,
    broadcasts,
    localPeerId: "peer-local-test",

    async send(channel, peerId, payload) {
      sentMessages.push({ channel, peerId, payload });
      return true;
    },

    broadcast(channel, payload) {
      broadcasts.push({ channel, payload });
    },

    onMessage(channel, handler) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel)!.push(handler);
      return () => {
        const arr = handlers.get(channel);
        if (arr) {
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },

    getConnectedPeerIds() {
      return ["peer-a", "peer-b"];
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function createTestData(sizeBytes: number): Uint8Array {
  const data = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) data[i] = i % 256;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════

describe("MediaCoinEngine", () => {
  let transport: ReturnType<typeof createMockTransport>;
  let engine: MediaCoinEngine;

  beforeEach(() => {
    transport = createMockTransport();
    engine = new MediaCoinEngine(transport);
    engine.start();
  });

  describe("mint", () => {
    it("should split a file into chunks with Merkle root", async () => {
      const data = createTestData(2_500_000); // ~2.5MB → 3 chunks
      const manifest = await engine.mint(
        { name: "test.mp4", type: "video/mp4", data },
        "creator-1",
        { duration: 10 }
      );

      expect(manifest.totalChunks).toBe(3);
      expect(manifest.chunkHashes.length).toBe(3);
      expect(manifest.merkleRoot).toBeTruthy();
      expect(manifest.merkleRoot.length).toBe(64); // SHA-256 hex
      expect(manifest.priorityChunks).toBeGreaterThanOrEqual(1);
      expect(manifest.mimeType).toBe("video/mp4");
      expect(manifest.totalSize).toBe(2_500_000);
    });

    it("should support encrypted minting", async () => {
      const data = createTestData(500_000);
      const manifest = await engine.mint(
        { name: "secret.mp4", type: "video/mp4", data },
        "creator-1",
        { encrypt: true }
      );

      expect(manifest.encryptionKey).toBeTruthy();
      expect(manifest.encryptionIvPrefix).toBeTruthy();
    });

    it("should fire progress callbacks during mint", async () => {
      const data = createTestData(3_000_000);
      const progress: number[] = [];

      await engine.mint(
        { name: "prog.mp4", type: "video/mp4", data },
        "creator-1",
        {
          onProgress: (p) => progress.push(p.percent),
        }
      );

      expect(progress.length).toBeGreaterThan(0);
      expect(progress[progress.length - 1]).toBe(100);
    });
  });

  describe("relay", () => {
    it("should broadcast announce and priority-push chunks", async () => {
      const data = createTestData(2_000_000);
      const manifest = await engine.mint(
        { name: "relay.mp4", type: "video/mp4", data },
        "creator-1",
        { duration: 10 }
      );

      engine.relay(manifest);

      // Should have broadcast an announce
      const announces = transport.broadcasts.filter(
        (b) => (b.payload as any).type === "coin-announce"
      );
      expect(announces.length).toBe(1);

      // Should have sent priority chunks to peers
      const pieces = transport.sentMessages.filter(
        (m) => (m.payload as any).type === "coin-piece"
      );
      expect(pieces.length).toBeGreaterThan(0);
    });
  });

  describe("assembleBlob", () => {
    it("should assemble all chunks into a blob URL", async () => {
      const data = createTestData(1_500_000);
      const manifest = await engine.mint(
        { name: "assemble.mp4", type: "video/mp4", data },
        "creator-1"
      );

      const url = engine.assembleBlob(manifest.coinId);
      expect(url).toBeTruthy();
      expect(url).toContain("blob:");
    });

    it("should return null for unknown coinId", () => {
      expect(engine.assembleBlob("nonexistent")).toBeNull();
    });
  });

  describe("query API", () => {
    it("should track manifests and chunk counts", async () => {
      const data = createTestData(1_000_000);
      const manifest = await engine.mint(
        { name: "query.mp4", type: "video/mp4", data },
        "creator-1"
      );

      expect(engine.getManifest(manifest.coinId)).toBeDefined();
      expect(engine.getAllManifests().length).toBe(1);
      expect(engine.getChunkCount(manifest.coinId)).toBe(1);
      expect(engine.hasAllChunks(manifest.coinId)).toBe(true);
    });
  });
});

describe("Merkle Tree", () => {
  it("should build a root from multiple hashes", async () => {
    const hashes = ["aaa", "bbb", "ccc", "ddd"];
    const root = await buildMerkleRoot(hashes);
    expect(root).toBeTruthy();
    expect(root.length).toBe(64);
  });

  it("should return single hash for one item", async () => {
    const root = await buildMerkleRoot(["onlyhash"]);
    expect(root).toBe("onlyhash");
  });

  it("should return empty string for no hashes", async () => {
    const root = await buildMerkleRoot([]);
    expect(root).toBe("");
  });

  it("should verify a Merkle proof", async () => {
    // Use actual SHA-256 hex strings as leaf hashes
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`leaf-${i}`)
      );
      hashes.push(
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      );
    }

    const root = await buildMerkleRoot(hashes);
    const proof = await buildMerkleProof(hashes, 2);
    const valid = await verifyMerkleProof(hashes[2], proof, root);
    expect(valid).toBe(true);
  });
});
