/**
 * MintMe miner master switch. The MintMe miner must never start unless this
 * returns true. Defaults OFF; the user's choice persists on this device.
 *
 * The miner also needs one of the user's personal servers: its pool bridge
 * (wss) is derived from that server's address. The switch lives under
 * Settings → Storage → Personal Servers and is hidden without a server.
 */
import { listPersonalServers, type PersonalServer } from "@/lib/storage/providers/personalServerStore";
import { sanitizeStratumProxyUrl } from "@/lib/blockchain/mintmeMiner/stratum";

// v2: the switch moved to Personal Servers and starts off for everyone.
const KEY = "swarm-mintme-miner-enabled-v2";
const SERVER_KEY = "swarm-mintme-miner-server";
/** Path a personal server exposes for its WebSocket → MintMe pool bridge. */
export const MINTME_BRIDGE_PATH = "/mintme-bridge";

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();
let storageFallback: boolean | null = null;
let serverFallback: string | null = null;

export function getMintMeMinerEnabled(): boolean {
  if (storageFallback !== null) return storageFallback;
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setMintMeMinerEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
    storageFallback = null;
  } catch {
    storageFallback = enabled;
  }
  listeners.forEach((l) => l(enabled));
}

export function onMintMeMinerEnabledChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** wss bridge on the same host as the personal server, or null for local/invalid addresses. */
export function mintMeBridgeUrlForServer(server: Pick<PersonalServer, "url">): string | null {
  try {
    const url = new URL(server.url);
    if (url.protocol !== "https:") return null;
    return sanitizeStratumProxyUrl(`wss://${url.host}${MINTME_BRIDGE_PATH}`);
  } catch {
    return null;
  }
}

export function getMintMeMinerServerId(): string | null {
  if (serverFallback !== null) return serverFallback || null;
  try { return localStorage.getItem(SERVER_KEY); } catch { return null; }
}

/** The personal server the miner uses: the chosen one, else the first attached. */
export function getMintMeMinerServer(): PersonalServer | null {
  const servers = listPersonalServers();
  const id = getMintMeMinerServerId();
  return servers.find((s) => s.id === id) ?? servers[0] ?? null;
}

export function setMintMeMinerServerId(id: string): void {
  try {
    localStorage.setItem(SERVER_KEY, id);
    serverFallback = null;
  } catch {
    serverFallback = id;
  }
  // Re-run the miner against the new bridge.
  listeners.forEach((l) => l(getMintMeMinerEnabled()));
}

/** Bridge the miner connects to. Null means no usable personal server, so no mining. */
export function getMintMeBridgeUrl(): string | null {
  const server = getMintMeMinerServer();
  return server ? mintMeBridgeUrlForServer(server) : null;
}
