import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TorrentSwarm, type MeshTransportAdapter, type TorrentManifest } from "../torrentSwarm.standalone";

const CHANNEL_MSGS: Array<{ to: string; payload: unknown }> = [];

/** Two in-memory nodes wired directly to each other. */
function makePair() {
  const handlers = new Map<string, (peerId: string, payload: unknown) => void>();
  const mk = (self: string, other: string): MeshTransportAdapter => ({
    localPeerId: self,
    async send(_channel, peerId, payload) {
      CHANNEL_MSGS.push({ to: peerId, payload });
      const h = handlers.get(peerId);
      // deliver asynchronously like a real data channel
      if (h) queueMicrotask(() => h(self, JSON.parse(JSON.stringify(payload))));
      return true;
    },
    broadcast(_channel, payload) {
      const h = handlers.get(other);
      if (h) queueMicrotask(() => h(self, JSON.parse(JSON.stringify(payload))));
    },
    onMessage(_channel, handler) {
      handlers.set(self, handler);
      return () => handlers.delete(self);
    },
    getConnectedPeerIds: () => [other],
  });
  return { a: new TorrentSwarm(mk("A", "B")), b: new TorrentSwarm(mk("B", "A")) };
}

function bytes(n: number, seed: number) {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = (i * 31 + seed) & 0xff;
  return d;
}

function fakeManifest(id: string): TorrentManifest {
  return {
    id, name: id, totalSize: 10, chunkSize: 10, totalChunks: 1,
    chunkHashes: ["x"], contentHash: "y", creatorId: "Z", createdAt: Date.now(),
  };
}

/** Let microtasks and WebCrypto callbacks settle (setImmediate is not faked). */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

/** Yield to the event loop for `ms` of real time (performance is not faked). */
async function settleFor(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) await new Promise((r) => setImmediate(r));
}

describe("TorrentSwarm download queue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    CHANNEL_MSGS.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the first queued manifest and parks the rest in order", () => {
    const { b } = makePair();
    b.enqueueDownload(fakeManifest("m1"));
    b.enqueueDownload(fakeManifest("m2"));
    b.enqueueDownload(fakeManifest("m3"));
    b.enqueueDownload(fakeManifest("m2")); // duplicate ignored

    expect(b.getProgress("m1")?.state).toBe("downloading");
    expect(b.getProgress("m2")?.state).toBe("queued");
    expect(b.getProgress("m3")?.state).toBe("queued");
    expect(b.getDownloadQueue()).toEqual(["m2", "m3"]);
  });

  it("advances when the active download pauses or is removed", () => {
    const { b } = makePair();
    b.enqueueDownload(fakeManifest("m1"));
    b.enqueueDownload(fakeManifest("m2"));
    b.enqueueDownload(fakeManifest("m3"));

    b.pause("m1");
    expect(b.getProgress("m2")?.state).toBe("downloading");
    expect(b.getProgress("m3")?.state).toBe("queued");

    b.remove("m3"); // removing a waiting item just drops it
    expect(b.getDownloadQueue()).toEqual([]);

    b.remove("m2");
    expect(b.getProgress("m2")).toBeNull();
  });

  it("advances when a stalled download auto-pauses", () => {
    const { b } = makePair();
    b.enqueueDownload(fakeManifest("m1"));
    b.enqueueDownload(fakeManifest("m2"));
    vi.advanceTimersByTime(65_000);
    expect(b.getProgress("m1")?.state).toBe("paused");
    expect(b.getProgress("m2")?.state).toBe("downloading");
  });

  it("downloads announced files one at a time, next starting after the first verifies", async () => {
    const { a, b } = makePair();
    b.start();
    a.start();
    await flush();

    const order: string[] = [];
    window.addEventListener("torrent-complete", ((e: CustomEvent) => order.push(e.detail.name)) as EventListener);

    const m1 = await a.seed("first", bytes(3 * 1024, 1), "A", "image/png", 1024);
    const m2 = await a.seed("second", bytes(2 * 1024, 2), "A", "image/png", 1024);
    await flush();

    // second announce is parked while the first is in flight
    expect(b.getProgress(m1.id)?.state).toBe("downloading");
    expect(b.getProgress(m2.id)?.state).toBe("queued");

    for (let i = 0; i < 20 && order.length < 2; i++) {
      if (order.length === 0) {
        // the second file must not start before the first is verified
        expect(b.getProgress(m2.id)?.state).toBe("queued");
      }
      vi.advanceTimersByTime(2_000);
      // Give WebCrypto hashing real time to finish; under a loaded test run a
      // fixed number of ticks was not always enough.
      await settleFor(100);
    }

    expect(order).toEqual(["first", "second"]);
    expect(b.getProgress(m1.id)?.state).toBe("seeding");
    expect(b.getProgress(m2.id)?.state).toBe("seeding");
  });
});
