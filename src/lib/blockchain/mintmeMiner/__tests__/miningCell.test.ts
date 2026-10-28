import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MintMeMiningCell, parseMiningBridge, MINING_CELL_TTL } from "../miningCell";
import { MINTME_POOL_LOW_DIFF, sanitizeStratumProxyUrl, setStratumProxyUrl } from "../stratum";

const transport = vi.hoisted(() => ({ receive: null as null | ((from: string, payload: unknown) => void), broadcast: vi.fn(), starts: vi.fn(), stops: vi.fn() }));
vi.mock("@/lib/p2p/transports/gunAdapter", () => ({ GunAdapter: class {
  onMessage(_channel: string, callback: typeof transport.receive) { transport.receive = callback; return () => { transport.receive = null; }; }
  start = transport.starts;
  stop = transport.stops;
  broadcastToAll = transport.broadcast;
} }));
const vault = "0x1111111111111111111111111111111111111111";
const ad = (peerId = "host") => ({ version: 1, peerId, endpoint: "wss://mining.example.org/bridge", pool: MINTME_POOL_LOW_DIFF, vaultAddress: vault, timestamp: Date.now() });
let cell: MintMeMiningCell;
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); vi.clearAllMocks(); vi.stubEnv("VITE_MINTME_COMMUNITY_VAULT_ADDRESS", vault); cell = new MintMeMiningCell(); });
afterEach(() => { cell.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("community mining cell", () => {
  it("accepts only fresh ads matching configured community custody and sender", () => {
    expect(parseMiningBridge(ad(), "host", vault)?.pool).toBe("pool.webchain.network:2222");
    expect(parseMiningBridge(ad(), "imposter", vault)).toBeNull();
    expect(parseMiningBridge(ad(), "host", "0x2222222222222222222222222222222222222222")).toBeNull();
    expect(parseMiningBridge({ ...ad(), timestamp: Date.now() - MINING_CELL_TTL - 1 }, "host", vault)).toBeNull();
  });
  it("rejects credentials, private endpoints, insecure sockets and query secrets", () => {
    for (const endpoint of ["ws://mining.example.org", "wss://user:pass@mining.example.org", "wss://localhost", "wss://127.0.0.1", "wss://host.local", "wss://mining.example.org?token=secret"]) {
      expect(sanitizeStratumProxyUrl(endpoint)).toBeNull();
    }
  });
  it("does not initialize discovery while disconnected", async () => {
    await cell.start("me", []);
    expect(transport.starts).not.toHaveBeenCalled(); expect(cell.selectedEndpoint).toBeNull();
  });
  it("discovers a live connected host and expires its stale bridge", async () => {
    await cell.start("me", ["host"]);
    transport.receive?.("host", ad());
    expect(cell.selectedEndpoint).toBe("wss://mining.example.org/bridge");
    vi.advanceTimersByTime(90_000);
    expect(cell.selectedEndpoint).toBeNull();
  });
  it("ignores endpoints from users without a live mesh connection", async () => {
    await cell.start("me", ["other"]);
    transport.receive?.("host", ad());
    expect(cell.selectedEndpoint).toBeNull();
  });
  it("publishes only public configured custody and stops discovery cleanly", async () => {
    setStratumProxyUrl("wss://mining.example.org/bridge");
    await cell.start("me", ["host"]);
    expect(transport.broadcast).toHaveBeenCalledWith("mintme-mining-bridge", expect.objectContaining({ peerId: "me", vaultAddress: vault, endpoint: "wss://mining.example.org/bridge" }));
    cell.stop();
    const count = transport.broadcast.mock.calls.length;
    vi.advanceTimersByTime(90_000);
    expect(transport.broadcast).toHaveBeenCalledTimes(count); expect(cell.selectedEndpoint).toBeNull();
  });
});