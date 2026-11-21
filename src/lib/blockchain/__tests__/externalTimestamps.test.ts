import { describe, expect, it, vi } from "vitest";
import {
  getTimestampReceipts, receiptToOtsFile, runExternalTimestamps, setExternalTimestampsEnabled, STAMP_INTERVAL_MS,
} from "../externalTimestamps";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const hash = (c: string) => c.repeat(64);
const chainWith = (blocks: { hash: string; index: number; epoch?: number }[], checkpoint: number) =>
  ({ getLatestCheckpoint: () => checkpoint, getChain: () => blocks });
const ok = (bytes: number[]) => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as Response;

describe("optional outside timestamps", () => {
  it("does nothing while off, or without a checkpoint", async () => {
    const store = memory();
    const fetchFn = vi.fn();
    expect(await runExternalTimestamps(chainWith([{ hash: hash("a"), index: 0 }], 0), { store, fetchFn })).toBeNull();
    setExternalTimestampsEnabled(true, store);
    expect(await runExternalTimestamps(chainWith([{ hash: hash("a"), index: 0 }], -1), { store, fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends only the checkpoint hash, keeps the proofs, and stamps once per epoch or hour", async () => {
    const store = memory();
    setExternalTimestampsEnabled(true, store);
    const fetchFn = vi.fn(async () => ok([0xf0, 0x01]));
    const blocks = [{ hash: hash("0"), index: 0 }, { hash: hash("a"), index: 1, epoch: 2 }, { hash: hash("b"), index: 2, epoch: 2 }];
    const receipt = await runExternalTimestamps(chainWith(blocks, 1), { store, fetchFn, now: 1_000 });
    expect(receipt).toMatchObject({ blockHash: hash("a"), height: 1, status: "pending" });
    expect(receipt!.proofs).toHaveLength(3);
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as Uint8Array;
    expect(Array.from(body)).toEqual(new Array(32).fill(0xaa));
    // Same checkpoint, then a newer one in the same epoch within the hour: no new stamp.
    expect(await runExternalTimestamps(chainWith(blocks, 1), { store, fetchFn, now: 2_000 })).toBeNull();
    expect(await runExternalTimestamps(chainWith(blocks, 2), { store, fetchFn, now: 2_000 })).toBeNull();
    expect(await runExternalTimestamps(chainWith(blocks, 2), { store, fetchFn, now: 1_000 + STAMP_INTERVAL_MS })).not.toBeNull();
    expect(getTimestampReceipts(store)).toHaveLength(2);
  });

  it("marks the checkpoint unreachable when no calendar answers, and retries", async () => {
    const store = memory();
    setExternalTimestampsEnabled(true, store);
    const blocks = [{ hash: hash("c"), index: 0 }];
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await runExternalTimestamps(chainWith(blocks, 0), { store, fetchFn: down })).toMatchObject({ status: "unreachable", proofs: [] });
    const up = vi.fn(async () => ok([1]));
    expect(await runExternalTimestamps(chainWith(blocks, 0), { store, fetchFn: up })).toMatchObject({ status: "pending" });
    expect(getTimestampReceipts(store)).toHaveLength(1);
  });

  it("writes a standard .ots file with one branch per calendar", () => {
    const file = receiptToOtsFile({
      blockHash: hash("1"), height: 1, epoch: 0, at: 0, status: "pending",
      proofs: [{ calendar: "a", proof: btoa("\x01") }, { calendar: "b", proof: btoa("\x02") }],
    })!;
    expect(new TextDecoder().decode(file.slice(1, 15))).toBe("OpenTimestamps");
    expect(Array.from(file.slice(31, 33))).toEqual([0x01, 0x08]);
    expect(Array.from(file.slice(33, 65))).toEqual(new Array(32).fill(0x11));
    expect(Array.from(file.slice(65))).toEqual([0xff, 0x01, 0x02]);
  });
});

describe("the background check", () => {
  it("retries a failed stamp on the timer, not straight after the failure", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
    const fetchFn = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetchFn);
    vi.doMock("../chain", () => ({
      getSwarmChain: () => ({ whenReady: async () => {}, getLatestCheckpoint: () => 0, getChain: () => [{ hash: hash("d"), index: 0 }] }),
    }));
    const m = await import("../externalTimestamps");
    const stop = m.startExternalTimestamps();
    m.setExternalTimestampsEnabled(true);
    await vi.waitFor(() => expect(m.getTimestampReceipts()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
