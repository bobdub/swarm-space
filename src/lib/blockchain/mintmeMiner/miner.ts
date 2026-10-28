/**
 * MintMe miner controller. Everything runs downhill from the Node dashboard
 * switch: when getMintMeMinerEnabled() is false nothing starts, and turning it
 * off stops the pool connection and worker immediately.
 */
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";
import { StratumClient, getStratumProxyUrl, MINTME_POOL_LOW_DIFF, type StratumJob } from "./stratum";
import { ShareTracker, type MeshLike } from "./shareTracker";
import { getMintMeCommunityVaultAddress } from "./communityCustody";
import { fromHex, meetsTarget } from "./hashEngine";

export type MinerStatus = "off" | "idle" | "needs-mesh" | "needs-vault" | "needs-proxy" | "needs-hasher" | "connecting" | "mining" | "error";

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

type Listener = (s: MinerSnapshot) => void;

export class MintMeMiner {
  private snap: MinerSnapshot = { status: getMintMeMinerEnabled() ? "idle" : "off", message: "", hashrate: 0, difficulty: 0, accepted: 0, rejected: 0, peerShares: 0, acceptedWeight: 0 };
  private listeners = new Set<Listener>();
  private client: StratumClient | null = null;
  private worker: Worker | null = null;
  private tracker: ShareTracker | null = null;
  private job: StratumJob | null = null;
  private generation = 0;
  private ready = false;
  private hashWindow: { t: number; n: number }[] = [];
  private unsubscribePreference: () => void;

  constructor() {
    this.unsubscribePreference = onMintMeMinerEnabledChange((on) => { if (!on) this.stop("off"); else this.set({ status: "idle", message: "" }); });
  }

  get snapshot() { return this.snap; }
  subscribe(l: Listener) { this.listeners.add(l); l(this.snap); return () => { this.listeners.delete(l); }; }

  start(opts: { peerId: string; mesh: (MeshLike & { getConnectedPeers(): string[] }) | null; proxyUrl?: string | null }): void {
    if (!getMintMeMinerEnabled()) { this.set({ status: "off" }); return; }
    if (!opts.mesh?.getConnectedPeers().length) { this.stop("needs-mesh", "Waiting for a mesh connection."); return; }
    if (this.client || this.worker) return;
    const address = getMintMeCommunityVaultAddress();
    if (!address) { this.set({ status: "needs-vault", message: "The community MintMe receiving address has not been configured. Mining is paused." }); return; }
    const proxyUrl = opts.proxyUrl ?? getStratumProxyUrl();
    if (!proxyUrl) { this.set({ status: "needs-proxy", message: "Waiting for a community mining bridge. Connection details are in the Node dashboard." }); return; }

    this.tracker = new ShareTracker(opts.mesh, () => this.set({ peerShares: this.tracker?.fromPeers.length ?? 0 }));
    this.client = new StratumClient({
      proxyUrl, pool: MINTME_POOL_LOW_DIFF, address,
      onEvent: (ev) => {
        if (ev.type === "job") {
          this.job = ev.job;
          this.generation += 1;
          this.worker?.postMessage({ type: "job", job: ev.job, generation: this.generation });
          this.set({ difficulty: ev.job.difficulty, status: "mining", message: "" });
        } else if (ev.type === "logged-in") {
          this.worker?.postMessage({ type: "start" });
        } else if (ev.type === "share-accepted") {
          const d = ev.difficulty;
          this.tracker?.recordLocal({ minerPeerId: opts.peerId, jobId: ev.jobId, difficulty: d, acceptedAt: Date.now() });
          this.set({ accepted: this.snap.accepted + 1, acceptedWeight: this.snap.acceptedWeight + d });
        } else if (ev.type === "share-rejected") {
          this.set({ rejected: this.snap.rejected + 1 });
        } else if (ev.type === "closed") {
          this.stop("error", ev.reason);
        }
      },
    });
    this.set({ status: "connecting", message: "Checking the MintMe browser hashing engine…" });
    try {
      const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (e) => {
        if (this.worker !== worker || !getMintMeMinerEnabled()) return;
        if (!opts.mesh?.getConnectedPeers().length) { this.stop("needs-mesh", "Waiting for a mesh connection."); return; }
        if (e.data.type === "ready" && !this.ready) {
          this.ready = true;
          this.set({ message: "Hashing engine verified. Connecting to the community pool…" });
          this.client?.connect();
        }
        else this.onWorker(e.data);
      };
      worker.onerror = () => { if (this.worker === worker) this.stop("error", "MintMe hashing stopped unexpectedly."); };
      worker.postMessage({ type: "init" });
    } catch { this.stop("error", "The MintMe browser worker could not start."); }
  }

  dispose(): void { this.stop(); this.unsubscribePreference(); this.listeners.clear(); }

  stop(status: MinerStatus = "idle", message = ""): void {
    this.client?.close(); this.client = null;
    this.worker?.postMessage({ type: "stop" }); this.worker?.terminate(); this.worker = null;
    this.tracker?.dispose(); this.tracker = null;
    this.job = null; this.hashWindow = [];
    this.ready = false;
    this.set({ status: getMintMeMinerEnabled() ? status : "off", message, hashrate: 0 });
  }

  private onWorker(m: { type: string; count?: number; jobId?: string; generation?: number; nonce?: string; result?: string }) {
    if (m.type === "unavailable") this.stop("needs-hasher", "A verified Lyra2v2-Webchain browser engine is not installed. No hashes or payouts are being generated.");
    else if (m.type === "share" && this.job && m.jobId === this.job.jobId && m.generation === this.generation &&
      m.nonce && /^[0-9a-f]{16}$/i.test(m.nonce) && m.result && /^[0-9a-f]{64}$/i.test(m.result) &&
      meetsTarget(fromHex(m.result), this.job.target)) this.client?.submit(m.jobId, m.nonce, m.result, this.job.difficulty);
    else if (m.type === "hashes") {
      const now = Date.now();
      if (!Number.isSafeInteger(m.count) || (m.count ?? 0) <= 0) return;
      this.hashWindow.push({ t: now, n: m.count ?? 0 });
      this.hashWindow = this.hashWindow.filter((h) => now - h.t < 10_000);
      const span = Math.max(1, (now - (this.hashWindow[0]?.t ?? now)) / 1000);
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
