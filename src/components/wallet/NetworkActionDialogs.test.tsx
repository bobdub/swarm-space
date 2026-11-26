import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomTokenNetworkActions } from "./NetworkActionDialogs";

vi.mock("./NativeTokenDepositDialog", () => ({ NativeTokenDepositDialog: () => null }));
vi.mock("./NativeTransferDialog", () => ({ NativeTransferDialog: () => null }));
vi.mock("./MintMeWithdrawDialog", () => ({ MintMeWithdrawDialog: () => null }));
vi.mock("@/hooks/useNativeWalletAddress", () => ({ useNativeWalletAddress: () => "" }));
afterEach(cleanup);

describe("shared wallet network actions", () => {
  it("opens the existing external withdrawal only on MintMe", () => {
    const withdraw = vi.fn(() => null);
    const props = { userId: "member", symbol: "TOKEN", address: "0x123", recorded: 10, renderWithdrawForm: withdraw };
    const view = render(<CustomTokenNetworkActions {...props} network="swarm" />);
    expect(withdraw).not.toHaveBeenCalled();
    view.rerender(<CustomTokenNetworkActions {...props} network="mintme" />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(withdraw).toHaveBeenCalledTimes(1);
    view.rerender(<CustomTokenNetworkActions {...props} network="chain:other" />);
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it("withdraws Ethereum tokens on the Ethereum view and greys them out on MintMe", () => {
    const withdraw = vi.fn(() => null);
    const props = { userId: "member", symbol: "MTCG", address: "eth:0x123", recorded: 10, renderWithdrawForm: withdraw, tokenNetwork: "ethereum" as const };
    const view = render(<CustomTokenNetworkActions {...props} network="mintme" />);
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transfer" })).toBeDisabled();
    view.rerender(<CustomTokenNetworkActions {...props} network="ethereum" />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it("greys out MintMe tokens on the Ethereum view", () => {
    const withdraw = vi.fn(() => null);
    render(<CustomTokenNetworkActions userId="member" symbol="DREAMS" address="0x123" recorded={10} renderWithdrawForm={withdraw} network="ethereum" />);
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transfer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
});
