/**
 * MintMe miner controller. Everything runs downhill from the Node dashboard
 * switch: when getMintMeMinerEnabled() is false nothing starts, and turning it
 * off stops the pool connection and worker immediately.
 */
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";
import { StratumClient, getStratumProxyUrl, MINTME_POOL_LOW_DIFF, type StratumJob } from "./stratum";
import { ShareTracker, type MeshLike } from "./shareTracker";

const HASHER_KEY = "swarm-mintme-hasher-url";

export type MinerStatus = "off" | "idle" | "needs-proxy" | "needs-hasher" | "connecting" | "mining" | "error";

export interface MinerSnapshot {
  status: MinerStatus;
  message: string;
  hashrate: number;
  difficulty: number;
  accepted: number;
  rejected: number;
  peerShares: number;
  acceptedWeight: number;
}

export function getHasherUrl(): string | null {
  try { return localStorage.getItem(HASHER_KEY)?.trim() || null; } catch { return null; }
}
export function setHasherUrl(url: string | null): void {
  try { url ? localStorage.setItem(HASHER_KEY, url.trim()) : localStorage.removeItem(HASHER_KEY); } catch { /* ignore */ }
}

type Listener = (s: MinerSnapshot) => void;

class MintMeMiner {
  private snap: MinerSnapshot = { status: getMintMeMinerEnabled() ? "idle" : "off", message: "", hashrate: 0, difficulty: 0, accepted: 0, rejected: 0, peerShares: 0, acceptedWeight: 0 };
  private listeners = new Set<Listener>();
  private client: StratumClient | null = null;
  private worker: Worker | null = null;
  private tracker: ShareTracker | null = null;
  private job: StratumJob | null = null;
  private hashWindow: { t: number; n: number }[] = [];

  constructor() {
    onMintMeMinerEnabledChange((on) => { if (!on) this.stop("off"); else this.set({ status: "idle", message: "" }); });
  }

  get snapshot() { return this.snap; }
  subscribe(l: Listener) { this.listeners.add(l); l(this.snap); return () => { this.listeners.delete(l); }; }

  start(opts: { address: string; peerId: string; mesh: MeshLike | null }): void {
    if (!getMintMeMinerEnabled()) { this.set({ status: "off" }); return; }
    if (this.client) return;
    const proxyUrl = getStratumProxyUrl();
    if (!proxyUrl) { this.set({ status: "needs-proxy", message: "Add a pool bridge address to reach the MintMe pool." }); return; }
    const hasherUrl = getHasherUrl();
    if (!hasherUrl) { this.set({ status: "needs-hasher", message: "Add a MintMe hashing module to start hashing." }); return; }

    this.tracker = new ShareTracker(opts.mesh, () => this.set({ peerShares: this.tracker?.fromPeers.length ?? 0 }));
    this.worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.postMessage({ type: "init", hasherUrl });

    this.set({ status: "connecting", message: `Connecting to ${MINTME_POOL_LOW_DIFF}…` });
    this.client = new StratumClient({
      proxyUrl, pool: MINTME_POOL_LOW_DIFF, address: opts.address,
      onEvent: (ev) => {
        if (ev.type === "job") {
          this.job = ev.job;
          this.worker?.postMessage({ type: "job", job: ev.job });
          this.set({ difficulty: ev.job.difficulty });
        } else if (ev.type === "logged-in") {
          this.worker?.postMessage({ type: "start" });
          this.set({ status: "mining", message: "" });
        } else if (ev.type === "share-accepted") {
          const d = this.job?.difficulty ?? 0;
          this.tracker?.recordLocal({ minerPeerId: opts.peerId, jobId: ev.jobId, difficulty: d, acceptedAt: Date.now() });
          this.set({ accepted: this.snap.accepted + 1, acceptedWeight: this.snap.acceptedWeight + d });
        } else if (ev.type === "share-rejected") {
          this.set({ rejected: this.snap.rejected + 1 });
        } else if (ev.type === "closed") {
          this.stop("error", ev.reason);
        }
      },
    });
    this.client.connect();
  }

  stop(status: MinerStatus = "idle", message = ""): void {
    this.client?.close(); this.client = null;
    this.worker?.postMessage({ type: "stop" }); this.worker?.terminate(); this.worker = null;
    this.tracker?.dispose(); this.tracker = null;
    this.job = null; this.hashWindow = [];
    this.set({ status: getMintMeMinerEnabled() ? status : "off", message, hashrate: 0 });
  }

  private onWorker(m: { type: string; count?: number; jobId?: string; nonce?: string; result?: string }) {
    if (m.type === "unavailable") this.stop("needs-hasher", "The MintMe hashing module could not be loaded.");
    else if (m.type === "share" && m.jobId && m.nonce && m.result) this.client?.submit(m.jobId, m.nonce, m.result);
    else if (m.type === "hashes") {
      const now = Date.now();
      this.hashWindow.push({ t: now, n: m.count ?? 0 });
      this.hashWindow = this.hashWindow.filter((h) => now - h.t < 10_000);
      const span = Math.max(1, (now - this.hashWindow[0].t) / 1000);
      this.set({ hashrate: this.hashWindow.reduce((a, h) => a + h.n, 0) / span });
    }
  }

  private set(p: Partial<MinerSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l(this.snap));
  }
}

let instance: MintMeMiner | null = null;
export function getMintMeMiner(): MintMeMiner {
  return (instance ??= new MintMeMiner());
}
