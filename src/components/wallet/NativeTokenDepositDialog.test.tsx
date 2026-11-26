import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeTokenDepositDialog } from "./NativeTokenDepositDialog";

const mocks = vi.hoisted(() => ({ custom: vi.fn(), native: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
const contract = "0x634340447220bcaaa09a5505d71ca62b644a1a82";
vi.mock("@/lib/blockchain/wallets/coldKey", () => ({ getColdKeyReceivingAddress: async () => "0x34ddae73cf1dae783f043460f0ce6adebf8bb722" }));
vi.mock("@/lib/blockchain/deposits/customTokens", () => ({
  listCustomTokens: () => [{ address: contract, symbol: "DREAMS", decimals: 12 }], syncCustomTokenDeposits: mocks.custom,
  customTokenRef: (t: { address: string; network?: string }) => (t.network === "ethereum" ? `eth:${t.address}` : t.address).toLowerCase(),
  customTokenNetwork: (t: { network?: string }) => t.network ?? "mintme",
}));
vi.mock("@/lib/blockchain/wallets/nativeMintmeDirect", () => ({ syncNativeMintMeDeposits: mocks.native }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info, error: mocks.error } }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.custom.mockResolvedValue(10); mocks.native.mockResolvedValue(2); });
describe("deposit checks use the selected asset", () => {
  it("checks the imported Dreams contract rather than the native coin", async () => {
    render(<NativeTokenDepositDialog userId="member" symbol="DREAMS" tokenAddress={contract} decimals={12} />);
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for my deposit" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Check for my deposit" }));
    await waitFor(() => expect(mocks.custom).toHaveBeenCalledWith("member", contract));
    expect(mocks.native).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("10 DREAMS added to your native wallet"));
  });
  it("keeps native MINTME checks separate", async () => {
    render(<NativeTokenDepositDialog userId="member" symbol="MINTME" />);
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for my deposit" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Check for my deposit" }));
    await waitFor(() => expect(mocks.native).toHaveBeenCalledWith("member"));
    expect(mocks.custom).not.toHaveBeenCalled();
  });
});