/**
 * MintMe (Webchain) Stratum client.
 *
 * Browsers cannot open raw TCP sockets, so the pool is reached through a
 * public WebSocket→TCP bridge discovered through the mining cell. Without a bridge the client
 * reports `needs-proxy` and never pretends to be connected.
 */
import { targetValue } from "./hashEngine";
export const MINTME_POOL_LOW_DIFF = "pool.webchain.network:2222";
export const MINTME_POOL_STANDARD = "pool.webchain.network:3333";
export const MINTME_LOW_DIFFICULTY = 12_500;
const PROXY_KEY = "swarm-mintme-stratum-proxy";

export interface StratumJob {
  jobId: string;
  blob: string;
  target: string;
  difficulty: number;
  algorithm?: "lyra2v2-webchain";
}

export function getStratumProxyUrl(): string | null {
  try {
    return sanitizeStratumProxyUrl(localStorage.getItem(PROXY_KEY) ?? import.meta.env.VITE_MINTME_STRATUM_WSS_URL ?? "");
  } catch {
    return null;
  }
}

/** Public endpoint only: no credentials, tokens, insecure sockets or private hosts. */
export function sanitizeStratumProxyUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash ||
        !host.includes(".") || host.includes(":") || host.endsWith(".local") || host.endsWith(".localhost") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

export function setStratumProxyUrl(url: string | null): boolean {
  const sanitized = url ? sanitizeStratumProxyUrl(url) : null;
  if (url && !sanitized) return false;
  try {
    if (sanitized) localStorage.setItem(PROXY_KEY, sanitized);
    else localStorage.removeItem(PROXY_KEY);
    window.dispatchEvent(new Event("mintme-bridge-config-change"));
    return true;
  } catch { return false; }
}

/** MintMe supports compact and full eight-byte little-endian pool targets. */
export function targetToDifficulty(targetHex: string): number {
  const target = targetValue(targetHex);
  return target > 0n ? Number(0xffffffffffffffffn / target) : 0;
}

/** Difficulty → CryptoNote compact 4-byte little-endian target. */
export function difficultyToTarget(difficulty: number): string {
  const t = Math.max(1, Math.floor(0xffffffff / Math.max(1, difficulty)));
  return (t.toString(16).padStart(8, "0").match(/../g) ?? []).reverse().join("");
}

/** Parse a pool `job` payload (from login result or a `job` notification). */
export function parseJob(raw: unknown): StratumJob | null {
  const j = raw as { job_id?: unknown; blob?: unknown; target?: unknown; algo?: unknown } | null;
  if (!j || typeof j.job_id !== "string" || typeof j.blob !== "string" || typeof j.target !== "string") return null;
  if (!j.job_id.length || j.job_id.length > 256 || j.blob.length < 152 || j.blob.length >= 131072 ||
      !/^(?:[0-9a-f]{2})+$/i.test(j.blob) ||
      (j.algo !== undefined && j.algo !== "lyra2v2-webchain" && j.algo !== "lyra2v2-webchain/1")) return null;
  const difficulty = targetToDifficulty(j.target);
  if (!difficulty) return null;
  return { jobId: j.job_id, blob: j.blob, target: j.target, difficulty, algorithm: "lyra2v2-webchain" };
}

export type StratumEvent =
  | { type: "open" }
  | { type: "logged-in"; workerId: string }
  | { type: "job"; job: StratumJob }
  | { type: "share-accepted"; jobId: string; difficulty: number }
  | { type: "share-rejected"; jobId: string; reason: string }
  | { type: "closed"; reason: string };

export class StratumClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private workerId = "";
  private pending = new Map<number, { kind: "login" | "submit"; jobId?: string; difficulty?: number }>();

  constructor(
    private readonly opts: { proxyUrl: string; pool: string; address: string; onEvent: (e: StratumEvent) => void },
  ) {}

  connect(): void {
    if (this.ws) return;
    const url = `${this.opts.proxyUrl}${this.opts.proxyUrl.includes("?") ? "&" : "?"}pool=${encodeURIComponent(this.opts.pool)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.opts.onEvent({ type: "open" });
      this.call("login", { login: this.opts.address, pass: "x", agent: "swarm-space-mintme/1" }, { kind: "login" });
    };
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onerror = () => this.opts.onEvent({ type: "closed", reason: "Proxy connection error" });
    ws.onclose = () => this.opts.onEvent({ type: "closed", reason: "Pool connection closed" });
  }

  submit(jobId: string, nonce: string, result: string, difficulty = 0): void {
    if (!this.workerId || !/^[0-9a-f]{16}$/i.test(nonce) || !/^[0-9a-f]{64}$/i.test(result)) return;
    this.call("submit", { id: this.workerId, job_id: jobId, nonce, result }, { kind: "submit", jobId, difficulty });
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.pending.clear(); this.workerId = "";
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); }
  }

  /** Exposed for tests: process one newline-delimited pool message batch. */
  handle(data: string): void {
    for (const line of data.split("\n")) {
      if (!line.trim()) continue;
      let msg: { id?: number; method?: string; params?: unknown; result?: Record<string, unknown> | null; error?: { message?: string } | null };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method === "job") {
        const job = parseJob(msg.params);
        if (job) this.opts.onEvent({ type: "job", job });
        else this.opts.onEvent({ type: "closed", reason: "Unsupported or malformed MintMe mining job." });
        continue;
      }
      const req = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
      if (!req) continue;
      if (typeof msg.id === "number") this.pending.delete(msg.id);
      if (req.kind === "login") {
        if (msg.error || !msg.result) { this.opts.onEvent({ type: "closed", reason: msg.error?.message ?? "Login refused" }); continue; }
        this.workerId = String(msg.result.id ?? "");
        const job = parseJob(msg.result.job);
        if (!this.workerId || !job) { this.opts.onEvent({ type: "closed", reason: "Unsupported or malformed MintMe mining job." }); continue; }
        this.opts.onEvent({ type: "logged-in", workerId: this.workerId });
        if (job) this.opts.onEvent({ type: "job", job });
      } else {
        const ok = !msg.error && (msg.result as { status?: string } | null)?.status === "OK";
        this.opts.onEvent(ok
          ? { type: "share-accepted", jobId: req.jobId ?? "", difficulty: req.difficulty ?? 0 }
          : { type: "share-rejected", jobId: req.jobId ?? "", reason: msg.error?.message ?? "Rejected" });
      }
    }
  }

  private call(method: string, params: unknown, meta: { kind: "login" | "submit"; jobId?: string; difficulty?: number }): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (this.pending.size >= 64) { this.opts.onEvent({ type: "closed", reason: "Pool responses stalled. Mining paused." }); return; }
    const id = this.nextId++;
    this.pending.set(id, meta);
    this.ws.send(JSON.stringify({ id, jsonrpc: "2.0", method, params }) + "\n");
  }
}
