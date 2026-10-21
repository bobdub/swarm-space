import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ link: vi.fn(), deposit: vi.fn() }));
vi.mock("@/hooks/useMetaMask", () => ({ useMetaMask: () => ({ address: "0x123" }) }));
vi.mock("@/lib/blockchain/wallets/walletLink", () => ({ getLinkedWallet: () => null, linkMetaMaskWallet: mocks.link }));
vi.mock("@/lib/blockchain/wallets/mintmeBridge", () => ({ readMintMeBalance: async () => 12 }));
vi.mock("@/lib/blockchain/deposits/mintmeDeposit", () => ({ depositMintMe: vi.fn() }));
vi.mock("@/lib/blockchain/deposits/ethDeposit", () => ({ depositEth: vi.fn(), readEthBalance: async () => 12 }));
vi.mock("@/lib/blockchain/deposits/customTokens", () => ({
  readTokenBalance: async () => 12, getRecordedTokenBalance: () => 0, getPendingSyncTokenBalance: () => 0, syncPendingDeposits: async () => false, depositPrepRemainingMs: () => 0, depositCustomToken: mocks.deposit,
  getCustomTokenDepositCapacity: () => ({ deposited: 0, max: 5_000_000, remaining: 5_000_000 }), canHideToken: () => false,
}));
vi.mock("./MetaMaskConnectButton", () => ({ MetaMaskConnectButton: () => null }));
import { MintMeDepositDialog } from "./MintMeDepositDialog";
import { CustomTokenRow } from "./CustomTokenWizard";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("deposit dismissal", () => {
  it("allows closing a pending native link and aborts recording", async () => {
    let signal: AbortSignal | undefined;
    mocks.link.mockImplementation((_, supplied) => { signal = supplied; return new Promise(() => {}); });
    render(<MintMeDepositDialog userId="owner" />);
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Link wallet" }));
    await waitFor(() => expect(mocks.link).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(signal?.aborted).toBe(true);
  });
  it("allows closing a pending custom-token deposit", async () => {
    mocks.deposit.mockImplementation(() => new Promise(() => {}));
    render(<CustomTokenRow userId="owner" layer="metamask" token={{ address: "0x123", symbol: "MTCG", decimals: 12, addedAt: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Deposit to Native" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain("Link wallet");
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await waitFor(() => expect(mocks.deposit).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
