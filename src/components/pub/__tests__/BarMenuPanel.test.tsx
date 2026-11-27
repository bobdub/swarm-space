import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ getCurrentUser: () => ({ id: "alice", username: "alice", displayName: "Alice" }) }));
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

describe("BarMenuPanel", () => {
  it("shows the menu and the patron's own record on the bar tab", async () => {
    render(<BarMenuPanel selfId="alice" username="Alice" onClose={() => {}} />);
    expect(screen.getByText(/Green Cat Ale/)).toBeTruthy();
    fireEvent.click(await screen.findByText(/Bar tab · 1/));
    await waitFor(() => expect(screen.getByText("Your usual")).toBeTruthy());
    expect(screen.getAllByText(/Red Dragon Stout/).length).toBeGreaterThan(0);
    expect(screen.getByText("2 SWARM")).toBeTruthy();
  });
});
