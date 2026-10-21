import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ link: vi.fn(), read: vi.fn() }));
vi.mock("@/hooks/useMetaMask", () => ({ useMetaMask: () => ({ address: "0x123" }) }));
vi.mock("@/lib/blockchain/wallets/walletLink", () => ({ getLinkedWallet: () => null, linkMetaMaskWallet: mocks.link }));
vi.mock("@/lib/blockchain/wallets/mintmeBridge", () => ({ readMintMeBalance: async () => 12 }));
vi.mock("@/lib/blockchain/deposits/mintmeDeposit", () => ({ depositMintMe: vi.fn() }));
vi.mock("@/lib/blockchain/deposits/ethDeposit", () => ({ depositEth: vi.fn(), readEthBalance: async () => 12 }));
vi.mock("@/lib/blockchain/deposits/customTokens", () => ({
  readTokenBalance: async () => 12, getRecordedTokenBalance: () => 0,
  getCustomTokenDepositCapacity: () => ({ remaining: 5_000_000 }), canHideToken: () => false,
}));
vi.mock("./MetaMaskConnectButton", () => ({ MetaMaskConnectButton: () => null }));
import { MintMeDepositDialog } from "./MintMeDepositDialog";
import { CustomTokenRow } from "./CustomTokenWizard";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("deposit dismissal", () => {
  for (const kind of ["native", "custom"] as const) {
    it(`allows closing a pending ${kind} link and aborts recording`, async () => {
      let signal: AbortSignal | undefined;
      mocks.link.mockImplementation((_, supplied) => { signal = supplied; return new Promise(() => {}); });
      if (kind === "native") render(<MintMeDepositDialog userId="owner" />);
      else render(<CustomTokenRow userId="owner" layer="metamask" token={{ address: "0x123", symbol: "MTCG", decimals: 12, addedAt: 0 }} />);
      fireEvent.click(screen.getByRole("button", { name: kind === "native" ? "Deposit" : "Deposit to Native" }));
      fireEvent.click(await screen.findByRole("button", { name: "Link wallet" }));
      await waitFor(() => expect(mocks.link).toHaveBeenCalled());
      fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(signal?.aborted).toBe(true);
    });
  }
});