import { getMintMeCommunityVaultAddress } from "./communityCustody";
import { getStratumProxyUrl, sanitizeStratumProxyUrl, MINTME_POOL_LOW_DIFF } from "./stratum";
import type { GunAdapter } from "@/lib/p2p/transports/gunAdapter";

export const MINING_CELL_GRAPH = "swarm-space/mintme-mining-bridges/v1";
export const MINING_CELL_CHANNEL = "mintme-mining-bridge";
export const MINING_CELL_TTL = 75_000;
const BEACON_INTERVAL = 30_000;

export interface MiningBridgeAdvertisement {
  version: 1;
  peerId: string;
  endpoint: string;
  pool: string;
  vaultAddress: string;
  timestamp: number;
}

/** Discovery is untrusted. Custody must match the app's configured public vault. */
export function parseMiningBridge(value: unknown, from: string, vault: string | null, now = Date.now()): MiningBridgeAdvertisement | null {
  if (!value || typeof value !== "object" || !vault) return null;
  const ad = value as Partial<MiningBridgeAdvertisement>;
  const endpoint = typeof ad.endpoint === "string" ? sanitizeStratumProxyUrl(ad.endpoint) : null;
  if (ad.version !== 1 || ad.peerId !== from || !from || from.length > 256 || !endpoint ||
      ad.pool !== MINTME_POOL_LOW_DIFF || typeof ad.vaultAddress !== "string" ||
      ad.vaultAddress.toLowerCase() !== vault.toLowerCase() || typeof ad.timestamp !== "number" ||
      !Number.isFinite(ad.timestamp) || now - ad.timestamp > MINING_CELL_TTL || ad.timestamp > now + 5_000) return null;
  return { version: 1, peerId: from, endpoint, pool: MINTME_POOL_LOW_DIFF, vaultAddress: vault, timestamp: ad.timestamp };
}

export class MintMeMiningCell {
  private adapter: GunAdapter | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private advertisements = new Map<string, MiningBridgeAdvertisement>();
  private listeners = new Set<() => void>();
  private peerId = "";
  private connected = new Set<string>();
  private endpoint: string | null = null;
  private unsub: (() => void) | null = null;
  private configListener = () => this.refresh();

  get selectedEndpoint(): string | null { return this.endpoint; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener); listener();
    return () => { this.listeners.delete(listener); };
  }

  async start(peerId: string, connectedPeers: string[]): Promise<void> {
    if (!peerId || !connectedPeers.length) return;
    this.connected = new Set(connectedPeers);
    if (this.peerId === peerId) { this.refresh(); return; }
    this.stop();
    this.peerId = peerId;
    this.connected = new Set(connectedPeers);
    const generation = this.generation;
    window.addEventListener("mintme-bridge-config-change", this.configListener);
    this.refresh();
    const { GunAdapter } = await import("@/lib/p2p/transports/gunAdapter");
    if (generation !== this.generation) return;
    const adapter = new GunAdapter({
      peers: ["https://gun.eco/gun", "https://e2e.we-share.io/gun", "https://relay.peer.ooo/gun"],
      graphKey: MINING_CELL_GRAPH, channelName: "mintme-mining-cell", registryMode: true,
    });
    this.adapter = adapter;
    this.unsub = adapter.onMessage(MINING_CELL_CHANNEL, (from, payload) => {
      if (generation !== this.generation) return;
      const ad = parseMiningBridge(payload, from, getMintMeCommunityVaultAddress());
      if (!ad) return;
      // Fixed bound prevents an untrusted public registry consuming unlimited memory.
      if (!this.advertisements.has(from) && this.advertisements.size >= 128) return;
      this.advertisements.set(from, ad);
      this.select();
    });
    await adapter.start({ peerId });
    if (generation !== this.generation) { adapter.stop(); return; }
    this.refresh();
    this.timer = setInterval(() => this.refresh(), BEACON_INTERVAL);
  }

  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsub?.(); this.unsub = null;
    this.adapter?.stop(); this.adapter = null;
    window.removeEventListener("mintme-bridge-config-change", this.configListener);
    this.peerId = ""; this.connected.clear(); this.advertisements.clear();
    this.updateEndpoint(null);
  }

  private refresh(): void {
    const endpoint = getStratumProxyUrl();
    const vaultAddress = getMintMeCommunityVaultAddress();
    if (endpoint && vaultAddress && this.peerId && this.connected.size) {
      this.adapter?.broadcastToAll(MINING_CELL_CHANNEL, {
        version: 1, peerId: this.peerId, endpoint, pool: MINTME_POOL_LOW_DIFF, vaultAddress, timestamp: Date.now(),
      } satisfies MiningBridgeAdvertisement);
    }
    this.select();
  }

  private select(): void {
    const now = Date.now();
    for (const [id, ad] of this.advertisements) {
      if (now - ad.timestamp > MINING_CELL_TTL) this.advertisements.delete(id);
    }
    // A user-supplied public bridge wins; otherwise stable selection among live mesh neighbours.
    const candidates = [...this.advertisements.values()].filter(ad => this.connected.has(ad.peerId)).sort((a, b) => a.peerId.localeCompare(b.peerId));
    this.updateEndpoint(this.peerId && this.connected.size ? getStratumProxyUrl() ?? candidates[0]?.endpoint ?? null : null);
  }

  private updateEndpoint(endpoint: string | null): void {
    if (this.endpoint === endpoint) return;
    this.endpoint = endpoint;
    this.listeners.forEach(listener => listener());
  }
}

let cell: MintMeMiningCell | null = null;
export function getMintMeMiningCell(): MintMeMiningCell { return cell ??= new MintMeMiningCell(); }