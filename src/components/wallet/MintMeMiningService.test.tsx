import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MintMeMiningService } from "./MintMeMiningService";

const state = vi.hoisted(() => ({
  peers: ["host"], enabled: true, peerListener: () => {}, preferenceListener: () => {},
  start: vi.fn(), stop: vi.fn(), cellStop: vi.fn(),
  nativeSync: vi.fn(), customSync: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ isReady: true, user: { id: "member" } }) }));
vi.mock("@/lib/preview/guestAccess", () => ({ isGuestUser: () => false }));
vi.mock("@/lib/mining/mintmeMinerPreference", () => ({
  getMintMeMinerEnabled: () => state.enabled,
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
vi.mock("sonner", () => ({ toast: { success: state.notify } }));
vi.mock("@/lib/blockchain/mintmeMiner/communityPayoutService", () => ({ createMeshCommunityPayout: async () => ({ start: () => {}, stop: () => {}, tick: async () => {} }) }));
vi.mock("@/lib/blockchain/mintmeMiner/autoClaim", () => ({ createMeshAutoClaim: async () => ({ start: () => {}, stop: () => {}, tick: async () => {} }) }));
vi.mock("@/lib/blockchain/mintmeMiner/miningCell", () => ({ getMintMeMiningCell: () => ({
  selectedEndpoint: "wss://mining.example.org/bridge", start: async () => {}, stop: state.cellStop,
  subscribe: () => () => {},
}) }));

beforeEach(() => { vi.clearAllMocks(); state.peers = ["host"]; state.enabled = true; state.nativeSync.mockResolvedValue(0); state.customSync.mockResolvedValue(0); });
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
    expect(state.notify).toHaveBeenCalledWith("10 DREAMS arrived in your native wallet");
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
    expect(state.cellStop).toHaveBeenCalled();
    act(() => { state.peers = ["host"]; state.peerListener(); });
    expect(state.start).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it("stops both discovery and mining when the dashboard toggle turns off", async () => {
    const view = render(<MintMeMiningService />);
    await waitFor(() => expect(state.start).toHaveBeenCalledOnce());
    act(() => { state.enabled = false; state.preferenceListener(); });
    expect(state.stop).toHaveBeenLastCalledWith("off");
    expect(state.cellStop).toHaveBeenCalled();
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