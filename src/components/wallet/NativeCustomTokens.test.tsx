import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomTokenRow } from "./NativeCustomTokens";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
const token = { address: "0x634340447220bcaaa09a5505d71ca62b644a1a82", symbol: "DREAMS", decimals: 12, addedAt: 0 };
vi.mock("@/lib/blockchain/deposits/customTokens", () => ({
  syncCustomTokenDeposits: mocks.sync, getRecordedTokenBalance: () => 0, getPendingSyncTokenBalance: () => 0,
  syncPendingDeposits: vi.fn(), removeCustomToken: vi.fn(), isContractAddress: () => true, listCustomTokens: () => [],
  CUSTOM_TOKENS_EVENT: "custom-tokens", hydrateCustomTokens: async () => [], withdrawCustomToken: vi.fn(),
}));
vi.mock("@/lib/blockchain/deposits/depositSync", () => ({ DEPOSIT_SYNC_EVENT: "deposit-sync" }));
vi.mock("@/lib/blockchain/wallets/coldKey", () => ({ COLD_KEY_ENGRAVING_SWARM: 1, engraveColdKey: vi.fn(), getColdKeyAuthority: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCachedPrivateKey: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock("./NetworkActionDialogs", () => ({ CustomTokenNetworkActions: () => null }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("token row deposit check", () => {
  it("re-checks an earlier deposit without reopening the deposit window", async () => {
    mocks.sync.mockResolvedValue(25);
    render(<CustomTokenRow userId="member" token={token} layer="native" />);
    fireEvent.click(screen.getByRole("button", { name: /Check deposit/ }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith("member", token.address));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("25 DREAMS added to your native wallet"));
  });
  it("shows why a check failed instead of staying silent", async () => {
    mocks.sync.mockRejectedValue(new Error("MintMe token metadata could not be verified. Re-import this token and try again."));
    render(<CustomTokenRow userId="member" token={token} layer="native" />);
    fireEvent.click(screen.getByRole("button", { name: /Check deposit/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("MintMe token metadata could not be verified. Re-import this token and try again."));
  });
});
