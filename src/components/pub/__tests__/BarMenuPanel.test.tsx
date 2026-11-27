import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => ({ id: "alice", username: "alice", displayName: "Alice" }) }));
const donate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/preview/guestAccess", () => ({ isGuestUser: () => false }));
vi.mock("@/lib/blockchain/creditWrapping", () => ({ donateToRewardPool: donate }));
vi.mock("@/lib/store", () => ({ get: async () => undefined }));
vi.mock("@/lib/blockchain/token", () => ({ getSpendableSwarmBalance: async () => 10 }));
vi.mock("@/lib/streaming/webrtcSignalingBridge.standalone", () => ({ getLocalMeshPeerId: () => "mesh-alice" }));
vi.mock("@/lib/blockchain/chain", () => ({
  getSwarmChain: () => ({
    whenReady: async () => {},
    getChain: () => [],
    getPendingTransactions: () => [{
      id: "t1", type: "pool_donate", from: "alice", to: "community-pool", amount: 2, timestamp: new Date().toISOString(),
      signature: "", publicKey: "", nonce: 0, fee: 0,
      meta: { barTab: 1, drink: "red-dragon-stout", drinkName: "Red Dragon Stout", qty: 1, marketVaultFunding: "donation" },
    }],
  }),
}));

import { BarMenuPanel } from "../BarMenuPanel";
import { orderAtBar } from "@/lib/pub/barOrders";
import { _resetPlayModeForTest, setMeshOnline } from "@/lib/world/playMode";

describe("BarMenuPanel", () => {
  beforeEach(() => { donate.mockClear(); _resetPlayModeForTest({ online: true }); });

  it("shows the menu and the patron's own record on the bar tab", async () => {
    render(<BarMenuPanel selfId="alice" username="Alice" onClose={() => {}} />);
    expect(screen.getByText(/Green Cat Ale/)).toBeTruthy();
    fireEvent.click(await screen.findByText(/Bar tab · 1/));
    await waitFor(() => expect(screen.getByText("Your usual")).toBeTruthy());
    expect(screen.getAllByText(/Red Dragon Stout/).length).toBeGreaterThan(0);
    expect(screen.getByText("2 SWARM")).toBeTruthy();
  });

  it("takes no orders offline, and opens again when the mesh is back", async () => {
    _resetPlayModeForTest({ online: false });
    render(<BarMenuPanel selfId="alice" username="Alice" onClose={() => {}} />);
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    expect(screen.queryAllByText(/^Order ·/)).toHaveLength(0);
    act(() => setMeshOnline(true));
    await waitFor(() => expect(screen.getAllByText(/^Order ·/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it("charges nothing when an order is placed offline", async () => {
    _resetPlayModeForTest({ online: false });
    await expect(orderAtBar({ drinkId: "green-cat-ale", qty: 1, bodyIds: ["alice"], fromName: "Alice" })).rejects.toThrow(/offline/);
    expect(donate).not.toHaveBeenCalled();
    _resetPlayModeForTest({ online: true });
    await orderAtBar({ drinkId: "green-cat-ale", qty: 1, bodyIds: ["alice"], fromName: "Alice" });
    expect(donate).toHaveBeenCalledTimes(1);
  });
});
