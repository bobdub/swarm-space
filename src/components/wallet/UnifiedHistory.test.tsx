import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildUnifiedHistory, CREDITS_ASSET } from "@/lib/history/unifiedHistory";
import { UnifiedHistory } from "./UnifiedHistory";

const entries = buildUnifiedHistory({
  userId: "member",
  credits: [{ id: "c", fromUserId: "friend", toUserId: "member", amount: 5, type: "tip", createdAt: "2026-11-17T10:00:00Z" }],
  chain: [{ id: "t", type: "wallet_tip", from: "member", to: "friend", amount: 2, timestamp: "2026-11-17T11:00:00Z",
    signature: "", publicKey: "", nonce: 1, fee: 0, meta: { ticker: "SWARM", intent: "tip" } }],
});
const load = vi.fn(async () => entries);
vi.mock("@/lib/history/loadUnifiedHistory", () => ({ loadUnifiedHistory: () => load() }));
afterEach(cleanup);

describe("unified wallet history", () => {
  it("lists Credits and SWARM in one ledger: Asset | Action | Direction | Weight-type | Amount", async () => {
    render(<UnifiedHistory userId="member" />);
    await screen.findByText("Credits");
    const cells = (row: HTMLElement) => [...row.querySelectorAll("td")].map(td => td.firstChild?.textContent);
    const [, swarm, credits] = screen.getAllByRole("row");
    expect(screen.getAllByRole("columnheader").map(h => h.textContent))
      .toEqual(["Asset", "Action", "Direction", "Weight-type", "Amount"]);
    expect(cells(swarm)).toEqual(["SWARM", "Tip", "Outgoing", "Hollow", "2"]);
    expect(cells(credits)).toEqual(["Credits", "Tip", "Incoming", "Minted", "5"]);
  });

  it("stays on one asset when locked", async () => {
    render(<UnifiedHistory userId="member" asset={CREDITS_ASSET} lockAsset />);
    expect(await screen.findByText("Credits")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("SWARM")).toBeNull());
    expect(screen.queryByLabelText("Filter by asset")).toBeNull();
  });

  it("reloads when either ledger announces a new transaction", async () => {
    render(<UnifiedHistory userId="member" />);
    await screen.findByText("Credits");
    const before = load.mock.calls.length;
    window.dispatchEvent(new Event("credit-transaction"));
    window.dispatchEvent(new Event("wallet-tip-updated"));
    await waitFor(() => expect(load.mock.calls.length).toBe(before + 2));
  });
});
