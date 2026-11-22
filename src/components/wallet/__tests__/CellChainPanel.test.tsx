import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const view = vi.hoisted(() => ({
  cellId: "u/garden", chainId: "c1", name: "Garden Club", ticker: "GARDEN", isOwner: true, owner: "owner-account-0001",
  height: 22, balance: 47.5, maturing: 95, supply: 210, members: ["member-account-0002", "owner-account-0001"],
  invited: ["invitee-account-0003"], pending: 1, connected: ["member-account-0002", "visitor-account-0004"], active: true,
}));
vi.mock("@/lib/blockchain/cellChain/cellWallet", () => ({
  cellWalletView: async () => view,
  inviteToCell: vi.fn(), leaveCell: vi.fn(), removeFromCell: vi.fn(), sendCellCoin: vi.fn(),
}));
vi.mock("@/lib/blockchain/cellChain/cellRuntime", () => ({ getCellSession: () => null }));

const { CellChainPanel } = await import("../CellChainPanel");

describe("CellChainPanel", () => {
  it("shows the creator the cell coin, its members, and who they can invite", async () => {
    render(<CellChainPanel cellId="u/garden" userId="owner-account-0001" onBack={() => {}} />);
    expect(await screen.findByText("Garden Club")).toBeTruthy();
    expect(screen.getByText("47.5 GARDEN")).toBeTruthy();
    expect(screen.getByText("Members (2)")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.getByText("Invited")).toBeTruthy();
    // A connected account that isn't a member or invitee gets a one-tap invite.
    expect(screen.getByRole("button", { name: /Invite visit/ })).toBeTruthy();
    expect(screen.getByText("Send GARDEN")).toBeTruthy();
    expect(screen.queryByText("Leave cell")).toBeNull();
  });
});

describe("CellChainPanel switching cells", () => {
  it("clears the old cell's view and form when it's given another cell", async () => {
    const { rerender } = render(<CellChainPanel cellId="u/garden" userId="owner-account-0001" onBack={() => {}} />);
    await screen.findAllByText("Garden Club");
    const amount = screen.getAllByLabelText("Amount to send").at(-1) as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(amount, { target: { value: "5" } });
    expect(amount.value).toBe("5");
    rerender(<CellChainPanel cellId="u/other" userId="owner-account-0001" onBack={() => {}} />);
    await screen.findAllByText("Garden Club");
    expect((screen.getAllByLabelText("Amount to send").at(-1) as HTMLInputElement).value).toBe("");
  });
});
