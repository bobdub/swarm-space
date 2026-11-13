import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoinEngravingService } from "./CoinEngravingService";

const state = vi.hoisted(() => ({ guest: false, pack: vi.fn(), seal: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "member", _guest: state.guest } }) }));
vi.mock("@/lib/preview/guestAccess", () => ({ isGuestUser: (u: { _guest?: boolean }) => !!u._guest }));
vi.mock("@/lib/blockchain/contentPayload", () => ({ ensureEngravingCoin: async () => null, packLocalContent: state.pack, sealLocalContent: state.seal }));

beforeEach(() => { vi.clearAllMocks(); state.guest = false; state.pack.mockResolvedValue(0); state.seal.mockResolvedValue(0); });
describe("app-wide engraving settling", () => {
  it("packs before checking idle seals and stops after unmount", async () => {
    vi.useFakeTimers();
    const view = render(<CoinEngravingService />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(state.seal).toHaveBeenCalledWith("member", "idle");
    expect(state.pack.mock.invocationCallOrder[0]).toBeLessThan(state.seal.mock.invocationCallOrder[0]);
    const before = state.seal.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    view.unmount();
    const after = state.seal.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state.seal.mock.calls.length).toBe(after);
    expect(after).toBe(before + 1);
    vi.useRealTimers();
  });
  it("never loads or seals guest-owned data", async () => {
    state.guest = true;
    const guest = render(<CoinEngravingService />);
    await act(async () => { await Promise.resolve(); });
    expect(state.pack).not.toHaveBeenCalled();
    expect(state.seal).not.toHaveBeenCalled();
    guest.unmount();
  });
});