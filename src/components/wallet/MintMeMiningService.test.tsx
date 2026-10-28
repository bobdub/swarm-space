import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MintMeMiningService } from "./MintMeMiningService";

const state = vi.hoisted(() => ({
  peers: ["host"], enabled: true, peerListener: () => {}, preferenceListener: () => {},
  start: vi.fn(), stop: vi.fn(), cellStop: vi.fn(),
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
vi.mock("@/lib/blockchain/mintmeMiner/miningCell", () => ({ getMintMeMiningCell: () => ({
  selectedEndpoint: "wss://mining.example.org/bridge", start: async () => {}, stop: state.cellStop,
  subscribe: () => () => {},
}) }));

beforeEach(() => { vi.clearAllMocks(); state.peers = ["host"]; state.enabled = true; });
describe("app-wide MintMe lifecycle", () => {
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