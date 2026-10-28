import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHashEngine, fromHex, HASH_TEST_INPUT, HASH_TEST_V1, HASH_TEST_V2, meetsTarget, targetValue, toHex, writeNonce } from "../hashEngine";
import { MintMeHashLoop } from "../hashLoop";
import { difficultyToTarget, parseJob, StratumClient } from "../stratum";

afterEach(() => vi.useRealTimers());
const engineBytes = readFileSync("public/wasm/lyra2v2.wasm");
describe("bundled MintMe engine", () => {
  it("matches the upstream v1 vector and independently GCC-generated v2 reference", async () => {
    const engine = await createHashEngine(engineBytes);
    expect(toHex(engine.hash(fromHex(HASH_TEST_INPUT), 4))).toBe(HASH_TEST_V1);
    expect(toHex(engine.hash(fromHex(HASH_TEST_INPUT)))).toBe(HASH_TEST_V2);
  });
  it("writes an eight-byte big-endian nonce only at the blob tail", () => {
    const blob = fromHex(HASH_TEST_INPUT);
    const prefix = toHex(blob.subarray(0, blob.length - 8));
    expect(writeNonce(blob, 0x0102030405060708n)).toBe("0102030405060708");
    expect(toHex(blob.subarray(0, blob.length - 8))).toBe(prefix);
    expect(toHex(blob.subarray(-8))).toBe("0102030405060708");
  });
  it("checks the first digest word and rejects the exact target boundary", () => {
    expect(targetValue("0000000000000080")).toBe(0x8000000000000000n);
    expect(meetsTarget(fromHex("7f" + "ff".repeat(7) + "ff".repeat(24)), "0000000000000080")).toBe(true);
    expect(meetsTarget(fromHex("80" + "00".repeat(31)), "0000000000000080")).toBe(false);
    expect(meetsTarget(fromHex("ff".repeat(8) + "00".repeat(24)), "0000000000000080")).toBe(false);
  });
  it("parses full MintMe targets at difficulty 12,500 and rejects incompatible jobs", () => {
    const raw = { job_id: "real", blob: HASH_TEST_INPUT, target: "39b4c876be3e0500", algo: "lyra2v2-webchain" };
    const target = (0xffffffffffffffffn / 12500n).toString(16).padStart(16, "0").match(/../g)?.reverse().join("") ?? "";
    expect(parseJob({ ...raw, target })?.difficulty).toBe(12500);
    expect(parseJob({ ...raw, algo: "cryptonight" })).toBeNull();
    expect(parseJob({ ...raw, blob: HASH_TEST_INPUT + "f" })).toBeNull();
    expect(parseJob({ ...raw, blob: "00" })).toBeNull();
    expect(parseJob({ ...raw, target: "0000000000000000" })).toBeNull();
    expect(parseJob({ ...raw, target: difficultyToTarget(12500) })?.difficulty).toBe(12500);
  });
  it("runs pool login → real WASM hash → share submit → accepted response with original difficulty", async () => {
    const engine = await createHashEngine(engineBytes);
    vi.useFakeTimers();
    const sent: string[] = [];
    let socket: { onopen?: () => void } = {};
    class Socket {
      readyState = 1;
      onopen?: () => void;
      constructor() { socket = this; }
      send(data: string) { sent.push(data); }
    }
    vi.stubGlobal("WebSocket", Socket);
    const events: unknown[] = [];
    const job = { jobId: "j", blob: HASH_TEST_INPUT, target: "ffffffffffffffff", difficulty: 1 };
    const client = new StratumClient({ proxyUrl: "wss://pool.example/", pool: "pool.webchain.network:2222", address: "0x1111111111111111111111111111111111111111", onEvent: event => {
      events.push(event);
      if (event.type === "logged-in") loop.start();
      if (event.type === "job") loop.setJob(event.job, 1);
    } });
    const loop = new MintMeHashLoop(engine.hash, message => {
      if (message.type === "share") client.submit(message.jobId, message.nonce, message.result, job.difficulty);
    });
    try {
      client.connect(); socket.onopen?.();
      client.handle(JSON.stringify({ id: 1, result: { id: "worker", job: { job_id: "j", blob: job.blob, target: job.target, algo: "lyra2v2-webchain" } } }));
      vi.advanceTimersToNextTimer();
      expect(sent).toHaveLength(2);
      const submission = JSON.parse(sent[1]);
      const blob = fromHex(HASH_TEST_INPUT);
      blob.set(fromHex(submission.params.nonce), blob.length - 8);
      expect(submission.params.result).toBe(toHex(engine.hash(blob)));
      expect(submission.params.nonce).toHaveLength(16);
      client.handle(JSON.stringify({ id: submission.id, result: { status: "OK" } }));
      expect(events).toContainEqual({ type: "share-accepted", jobId: "j", difficulty: 1 });
    } finally { loop.stop(); vi.unstubAllGlobals(); }
  });
  it("replaces queued work and immediately cancels further hashes on stop", () => {
    vi.useFakeTimers();
    const hash = vi.fn(() => new Uint8Array(32));
    const emit = vi.fn();
    const loop = new MintMeHashLoop(hash, emit);
    loop.start();
    expect(hash).not.toHaveBeenCalled();
    loop.setJob({ jobId: "old", blob: HASH_TEST_INPUT, target: "ffffffffffffffff", difficulty: 1 }, 1);
    loop.setJob({ jobId: "new", blob: HASH_TEST_INPUT, target: "ffffffffffffffff", difficulty: 1 }, 2);
    vi.advanceTimersToNextTimer();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "share", jobId: "new", generation: 2 }));
    expect(hash).toHaveBeenCalledOnce();
    loop.stop(); vi.advanceTimersByTime(10000);
    expect(hash).toHaveBeenCalledOnce();
  });
});