import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MintMeMiner } from "../miner";
import { getMintMeCommunityVaultAddress } from "../communityCustody";
import { setStratumProxyUrl } from "../stratum";
import { setMintMeMinerEnabled } from "@/lib/mining/mintmeMinerPreference";

const vault = "0x1111111111111111111111111111111111111111";
const workers: WorkerStub[] = [];
const sockets: SocketStub[] = [];
class WorkerStub {
  onmessage: ((event: { data: { type: string } }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { workers.push(this); }
  emit(type: string) { this.onmessage?.({ data: { type } }); }
}
class SocketStub {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  send = vi.fn();
  close = vi.fn();
  constructor() { sockets.push(this); }
}
let miner: MintMeMiner;
const mesh = { getConnectedPeers: () => ["peer"], broadcast: vi.fn(), onMessage: () => () => {} };
beforeEach(() => {
  localStorage.clear(); workers.length = 0; sockets.length = 0;
  vi.stubEnv("VITE_MINTME_COMMUNITY_VAULT_ADDRESS", vault);
  vi.stubGlobal("Worker", WorkerStub); vi.stubGlobal("WebSocket", SocketStub);
  setMintMeMinerEnabled(true); setStratumProxyUrl("wss://pool.example");
  miner = new MintMeMiner();
});
afterEach(() => { miner.dispose(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("MintMe custody and master control", () => {
  it("starts no worker or pool connection while the dashboard toggle is off", () => {
    setMintMeMinerEnabled(false);
    miner.start({ peerId: "member", mesh });
    expect(workers).toHaveLength(0); expect(sockets).toHaveLength(0);
    expect(miner.snapshot.status).toBe("off");
  });
  it("requires the community receiving address rather than falling back to a user", () => {
    vi.stubEnv("VITE_MINTME_COMMUNITY_VAULT_ADDRESS", "");
    miner.start({ peerId: "member", mesh });
    expect(miner.snapshot.status).toBe("needs-vault");
    expect(workers).toHaveLength(0); expect(sockets).toHaveLength(0);
  });
  it("logs in only as the community vault, without any wallet key or user receiving address", () => {
    miner.start({ peerId: "member", mesh });
    expect(sockets).toHaveLength(0);
    workers[0].emit("ready"); sockets[0].onopen?.();
    const login = JSON.parse(sockets[0].send.mock.calls[0][0]);
    expect(login.params.login).toBe(vault); expect(login.params.pass).toBe("x");
  });
  it("turning the dashboard toggle off terminates the worker and closes the pool immediately", () => {
    miner.start({ peerId: "member", mesh }); workers[0].emit("ready");
    setMintMeMinerEnabled(false);
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(sockets[0].close).toHaveBeenCalledOnce();
    workers[0].emit("ready");
    expect(sockets).toHaveLength(1); expect(miner.snapshot.hashrate).toBe(0);
    expect(miner.snapshot.status).toBe("off");
  });
  it("never connects to the pool if the current MintMe hashing engine is unavailable", () => {
    miner.start({ peerId: "member", mesh }); workers[0].emit("unavailable");
    expect(sockets).toHaveLength(0); expect(miner.snapshot.status).toBe("needs-hasher");
    expect(miner.snapshot.accepted).toBe(0);
  });
  it("rejects invalid and zero community addresses", () => {
    vi.stubEnv("VITE_MINTME_COMMUNITY_VAULT_ADDRESS", "swarm:member");
    expect(getMintMeCommunityVaultAddress()).toBeNull();
    vi.stubEnv("VITE_MINTME_COMMUNITY_VAULT_ADDRESS", `0x${"0".repeat(40)}`);
    expect(getMintMeCommunityVaultAddress()).toBeNull();
  });
  it("never starts hashing or a socket with zero mesh connections", () => {
    miner.start({ peerId: "member", mesh: { ...mesh, getConnectedPeers: () => [] } });
    expect(miner.snapshot.status).toBe("needs-mesh");
    expect(workers).toHaveLength(0); expect(sockets).toHaveLength(0);
  });
  it("rechecks the connection before a delayed worker becomes ready", () => {
    let peers = ["peer"];
    miner.start({ peerId: "member", mesh: { ...mesh, getConnectedPeers: () => peers } });
    peers = []; workers[0].emit("ready");
    expect(sockets).toHaveLength(0); expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(miner.snapshot.status).toBe("needs-mesh");
  });
});