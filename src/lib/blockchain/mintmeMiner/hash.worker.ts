/// <reference lib="webworker" />
/**
 * Throttled MintMe hashing loop. The CryptoNight-Webchain hasher is a WASM
 * module loaded from a configured URL; without it the worker reports
 * `unavailable` and never fabricates hashes or shares.
 *
 * Module contract: default export / `hash(blobHex: string): string` (64 hex).
 */
type Hasher = (blobHex: string) => string;
let hasher: Hasher | null = null;
let job: { jobId: string; blob: string; target: string } | null = null;
let running = false;
let duty = 0.25;
let nonce = Math.floor(Math.random() * 0xffffffff) >>> 0;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function hex32le(n: number): string {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare last 4 bytes of the hash (LE uint32) with the compact target. */
function meetsTarget(hashHex: string, targetHex: string): boolean {
  const tail = parseInt(hashHex.slice(56, 64).match(/../g)!.reverse().join(""), 16);
  const target = parseInt(targetHex.match(/../g)!.reverse().join(""), 16);
  return tail < target;
}

function loop() {
  if (!running || !hasher || !job) return;
  const sliceMs = 50 * duty * 4; // duty 0.25 → 50ms work per 200ms
  const start = performance.now();
  let hashes = 0;
  while (performance.now() - start < sliceMs) {
    nonce = (nonce + 1) >>> 0;
    const n = hex32le(nonce);
    // CryptoNote nonce sits at byte offset 39.
    const blob = job.blob.slice(0, 78) + n + job.blob.slice(86);
    const result = hasher(blob);
    hashes++;
    if (meetsTarget(result, job.target)) ctx.postMessage({ type: "share", jobId: job.jobId, nonce: n, result });
  }
  ctx.postMessage({ type: "hashes", count: hashes });
  setTimeout(loop, Math.max(10, 200 - sliceMs));
}

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; [k: string]: unknown };
  if (m.type === "init") {
    try {
      const mod = await import(/* @vite-ignore */ String(m.hasherUrl));
      const fn = (mod.hash ?? mod.default) as Hasher | undefined;
      if (typeof fn !== "function") throw new Error("No hash export");
      hasher = fn;
      ctx.postMessage({ type: "ready" });
    } catch {
      ctx.postMessage({ type: "unavailable" });
    }
  } else if (m.type === "job") {
    job = m.job as typeof job;
  } else if (m.type === "duty") {
    duty = Math.min(1, Math.max(0.05, Number(m.duty) || 0.25));
  } else if (m.type === "start") {
    if (!running) { running = true; loop(); }
  } else if (m.type === "stop") {
    running = false;
  }
};
