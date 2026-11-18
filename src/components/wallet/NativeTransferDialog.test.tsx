import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ modal: vi.fn(), p2p: { getActivePeerConnections: () => [], subscribeToStats: () => () => {} } }));
vi.mock("@/contexts/P2PContext", () => ({ useP2PContext: () => state.p2p }));
vi.mock("@/components/SendCreditsModal", () => ({
  SendCreditsModal: (props: Record<string, unknown>) => { state.modal(props); return <div data-testid="send-modal" />; },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/blockchain/wallets/nativeAddress", () => ({
  nativeWalletAddress: async (id: string) => `0xalias-${id}`,
  resolveNativeWalletRecipient: async (id: string) => ({ id, username: "sam", displayName: "Sam Rivers" }),
}));
vi.mock("@/lib/blockchain/wallets/recipientSearch", () => ({
  looksLikeWalletAddress: (v: string) => v.startsWith("0x"),
  normalizeRecipientQuery: (v: string) => v.trim().replace(/^@+/, ""),
  searchWalletRecipients: async () => [{ userId: "u-sam", username: "sam", displayName: "Sam Rivers" }],
  resolveWalletRecipientInput: async (input: string) => ({ id: `raw:${input}`, username: "", displayName: "" }),
}));
const { NativeTransferDialog } = await import("./NativeTransferDialog");
afterEach(() => { cleanup(); state.modal.mockClear(); });

test("search by @username, confirm who it is, then open the send modal for the resolved wallet", async () => {
  render(<NativeTransferDialog userId="me" assetId="credits" assetLabel="Labor" amount={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "@sa" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sam Rivers/ }));
  const confirm = await screen.findByRole("group", { name: "Confirm recipient" });
  expect(confirm.textContent).toContain("Sam Rivers");
  expect(confirm.textContent).toContain("@sam");
  expect(confirm.textContent).toContain("0xalias-u-sam");
  expect(state.modal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue to @sam" }));
  await waitFor(() => expect(state.modal).toHaveBeenCalled());
  expect(state.modal.mock.calls.at(-1)?.[0]).toMatchObject({ toUserId: "u-sam", toUsername: "sam", toDisplayName: "Sam Rivers", initialAssetId: "credits" });
});

test("a raw wallet id still works through the fallback resolver", async () => {
  render(<NativeTransferDialog userId="me" assetId="credits" assetLabel="Labor" amount={5} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "0xabc" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  await screen.findByRole("group", { name: "Confirm recipient" });
  fireEvent.click(screen.getByRole("button", { name: /Continue to/ }));
  await waitFor(() => expect(state.modal.mock.calls.at(-1)?.[0]).toMatchObject({ toUserId: "raw:0xabc" }));
});
