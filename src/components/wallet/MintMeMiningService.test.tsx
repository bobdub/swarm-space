import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MintMeMiningService } from "./MintMeMiningService";

const state = vi.hoisted(() => ({
  peers: ["host"], enabled: true, bridge: "wss://files.example.org/mintme-bridge" as string | null,
  peerListener: () => {}, preferenceListener: () => {}, serverListener: () => {},
  start: vi.fn(), stop: vi.fn(),
  nativeSync: vi.fn(), customSync: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ isReady: true, user: { id: "member" } }) }));
vi.mock("@/lib/preview/guestAccess", () => ({ isGuestUser: () => false }));
vi.mock("@/lib/mining/mintmeMinerPreference", () => ({
  getMintMeMinerEnabled: () => state.enabled,
  getMintMeBridgeUrl: () => state.bridge,
  onMintMeMinerEnabledChange: (listener: () => void) => { state.preferenceListener = listener; return () => {}; },
}));
vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => ({
  getConnectedPeers: () => state.peers, getPhase: () => "online", getPeerId: () => "member",
  onPeersChange: (listener: () => void) => { state.peerListener = listener; listener(); return () => {}; },
  onPhaseChange: () => () => {},
}) }));
vi.mock("@/lib/blockchain/mintmeMiner/miner", () => ({ getMintMeMiner: () => ({ start: state.start, stop: state.stop }) }));
vi.mock("@/lib/blockchain/wallets/nativeMintmeDirect", () => ({ syncNativeMintMeDeposits: state.nativeSync }));
vi.mock("@/lib/blockchain/deposits/customTokens", () => ({
  hydrateCustomTokens: async () => [],
  listCustomTokens: () => [{ address: "dreams", symbol: "DREAMS", decimals: 12 }, { address: "other", symbol: "OTHER", decimals: 18 }],
  syncCustomTokenDeposits: state.customSync,
}));
vi.mock("@/lib/notifications", () => ({ notifySystem: state.notify }));
vi.mock("@/lib/blockchain/mintmeMiner/communityPayoutService", () => ({ createMeshCommunityPayout: async () => ({ start: () => {}, stop: () => {}, tick: async () => {} }) }));
vi.mock("@/lib/blockchain/mintmeMiner/autoClaim", () => ({ createMeshAutoClaim: async () => ({ start: () => {}, stop: () => {}, tick: async () => {} }) }));
vi.mock("@/lib/storage/providers/personalServerStore", () => ({
  subscribePersonalServers: (listener: () => void) => { state.serverListener = listener; return () => {}; },
}));

beforeEach(() => { vi.clearAllMocks(); state.peers = ["host"]; state.enabled = true; state.bridge = "wss://files.example.org/mintme-bridge"; state.nativeSync.mockResolvedValue(0); state.customSync.mockResolvedValue(0); });
afterEach(() => vi.useRealTimers());
describe("app-wide MintMe lifecycle", () => {
  it("checks every imported contract every two minutes, even when native sync fails", async () => {
    vi.useFakeTimers();
    state.nativeSync.mockRejectedValue(new Error("unreachable"));
    state.customSync.mockImplementation(async (_owner: string, token: string) => {
      if (token === "other") throw new Error("token unavailable");
      return 10;
    });
    const view = render(<MintMeMiningService />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(state.customSync).toHaveBeenCalledWith("member", "dreams");
    expect(state.customSync).toHaveBeenCalledWith("member", "other");
    expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "wallet_deposit", title: "10 DREAMS arrived.", link: "/wallet" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(115_000); });
    expect(state.customSync).toHaveBeenCalledTimes(4);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(state.customSync).toHaveBeenCalledTimes(4);
  });
  it("stops immediately when the last mesh connection leaves and restarts on reconnection", async () => {
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    act(() => { state.peers = []; state.peerListener(); });
    expect(state.stop).toHaveBeenLastCalledWith("needs-mesh", "Waiting for a mesh connection.");
    act(() => { state.peers = ["host"]; state.peerListener(); });
    expect(state.start).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it("stops mining when the switch turns off", async () => {
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    act(() => { state.enabled = false; state.preferenceListener(); });
    expect(state.stop).toHaveBeenLastCalledWith("off");
    view.unmount();
  });
  it("mines through the personal server bridge and stops when the server is removed", async () => {
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    expect(state.start).toHaveBeenCalledWith(expect.objectContaining({ proxyUrl: "wss://files.example.org/mintme-bridge" }));
    act(() => { state.bridge = null; state.serverListener(); });
    expect(state.stop).toHaveBeenLastCalledWith("needs-proxy", expect.stringContaining("personal server"));
    view.unmount();
  });
  it("never starts without a personal server", async () => {
    state.bridge = null;
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.stop).toHaveBeenCalledWith("needs-proxy", expect.any(String)));
    expect(state.start).not.toHaveBeenCalled();
    view.unmount();
  });
  it("does not recreate an unavailable worker on unrelated peer updates", async () => {
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    act(() => { state.peerListener(); state.peerListener(); });
    expect(state.start).toHaveBeenCalledOnce();
    view.unmount();
  });
});