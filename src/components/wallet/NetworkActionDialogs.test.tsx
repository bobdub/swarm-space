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
});