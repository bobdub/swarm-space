import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendCreditsModal } from "./SendCreditsModal";

const state = vi.hoisted(() => ({ key: "cached-key" as string | null }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => ({ id: "member" }), getCachedPrivateKey: async () => state.key, loginUser: vi.fn(),
}));
vi.mock("@/lib/blockchain/wallets/walletTips", () => ({
  getWalletTipAssets: async () => [{ id: "custom:0xabc", ticker: "DREAMS", name: "Custom MintMe token", kind: "external", balance: 5, decimals: 12 }],
  sendWalletTip: vi.fn(),
}));
vi.mock("@/lib/blockchain/wallets/nativeAddress", () => ({ nativeWalletAddress: async () => "SWARM-addr" }));
vi.mock("@/hooks/useNativeWalletAddress", () => ({ useNativeWalletAddress: () => "SWARM-addr" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(cleanup);
beforeEach(() => { state.key = "cached-key"; });

const open = () => render(<SendCreditsModal toUserId="peer" toUsername="peer" isOpen onClose={() => {}} initialAssetId="custom:0xabc" />);

describe("tip passphrase field", () => {
  it("is hidden when the signing key is already unlocked", async () => {
    open();
    await waitFor(() => expect(screen.getByText(/Your balance: 5 DREAMS/)).toBeInTheDocument());
    expect(screen.queryByLabelText("Account passphrase")).not.toBeInTheDocument();
  });
  it("appears only when the signing key is locked", async () => {
    state.key = null;
    open();
    await waitFor(() => expect(screen.getByLabelText("Account passphrase")).toBeInTheDocument());
  });
});
