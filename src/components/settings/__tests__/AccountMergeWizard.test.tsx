import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => {
  const handlers = new Map<string, (peerId: string, payload: unknown) => void>();
  const sent: Array<{ peerId: string; payload: { kind: string } }> = [];
  const mesh = {
    peers: ["peer-b"] as string[],
    getPeerId: () => "peer-a",
    getConnectedPeerIds: () => mesh.peers,
    getLibrary: () => [{ peerId: "peer-b", userId: "bbbbbbbbbbbbbbbb", username: "DeviceB", discriminator: "4c8a", nodeId: "b", alias: "B", addedAt: 0, lastSeenAt: 0, autoConnect: true, source: "manual" }],
    onPeersChange: () => () => {},
    onLibraryChange: () => () => {},
    send: (_c: string, peerId: string, payload: { kind: string }) => { sent.push({ peerId, payload }); return true; },
    onMessage: (c: string, fn: (peerId: string, payload: unknown) => void) => { handlers.set(c, fn); return () => handlers.delete(c); },
  };
  return { handlers, sent, mesh, guest: false };
});

vi.mock("@/lib/p2p/swarmMesh.standalone", () => ({ getSwarmMeshStandalone: () => h.mesh }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => ({ id: "aaaaaaaaaaaaaaaa", username: "DeviceA", publicKey: "pk-a", wrappedKeyRef: "w", createdAt: "2026-11-12T00:00:00.000Z", ...(h.guest ? { _guest: true } : {}) }),
}));
vi.mock("@/lib/crypto", () => ({ computeUserId: async (pk: string) => (pk === "pk-c" ? "cccccccccccccccc" : "x") }));
vi.mock("@/lib/blockchain/accountMerge", () => ({
  buildAccountSummary: async () => ({ userId: "aaaaaaaaaaaaaaaa", username: "DeviceA", discriminator: "9a3f", createdAt: "", swarm: 0, credits: 0, mintme: 0, posts: 0, contacts: 0, coldAddress: null }),
}));

import { AccountMergeWizard } from "../AccountMergeWizard";
import { getMergeController } from "@/lib/p2p/mergeProtocol";

beforeEach(() => {
  h.sent.length = 0;
  h.mesh.peers = ["peer-b"];
  h.guest = false;
  getMergeController().clear();
});

describe("AccountMergeWizard", () => {
  it("lists connected devices and shows a 6-digit code after Initiate Merge, without sending the code", async () => {
    render(<AccountMergeWizard open onOpenChange={() => {}} />);
    const button = await screen.findByRole("button", { name: "Initiate Merge" });
    expect(screen.getByText("@DeviceB #4c8a")).toBeInTheDocument();
    fireEvent.click(button);
    const code = await screen.findByLabelText("Verification code");
    expect(code.textContent).toMatch(/^\d{3} \d{3}$/);
    const offer = h.sent.find((m) => m.payload.kind === "merge:offer");
    expect(offer?.peerId).toBe("peer-b");
    expect(JSON.stringify(h.sent)).not.toContain(code.textContent!.replace(" ", ""));
    act(() => getMergeController().cancel());
  });

  it("shows a pending offer only inside the open panel, with Accept and Decline", async () => {
    h.mesh.peers = ["peer-c"];
    render(<AccountMergeWizard open onOpenChange={() => {}} />);
    await waitFor(() => expect(h.handlers.has("account-merge")).toBe(true));
    expect(h.sent.some((m) => m.payload.kind === "merge:probe")).toBe(true);
    await act(async () => {
      h.handlers.get("account-merge")!("peer-c", { kind: "merge:offer", sessionId: "s1", from: { userId: "cccccccccccccccc", username: "DeviceC", publicKey: "pk-c" }, expiresAt: Date.now() + 60_000 });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText("Pending Merge Available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Enter Verification Code")).toBeInTheDocument();
  });

  it("offers an invite link and QR code when no device is connected", async () => {
    h.mesh.peers = [];
    render(<AccountMergeWizard open onOpenChange={() => {}} />);
    const input = await screen.findByLabelText("Device invite link");
    expect((input as HTMLInputElement).value).toContain("/connect#peer-a");
    expect(screen.getByLabelText("Device invite QR code")).toBeInTheDocument();
  });

  it("asks a guest to create an account instead of offering a merge", async () => {
    h.guest = true;
    render(<AccountMergeWizard open onOpenChange={() => {}} />);
    expect(await screen.findByText("Create an account to merge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toContain("/auth?signup=1");
    expect(screen.queryByRole("button", { name: "Initiate Merge" })).toBeNull();
  });
});
