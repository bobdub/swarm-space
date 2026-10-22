import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/blockchain/marketVault", () => ({ getCreatorMarketRate: rate }));
import { useCreatorMarketRate } from "../useCreatorMarketRate";
beforeEach(() => { rate.mockReset().mockResolvedValue(0.2); });
afterEach(cleanup);
describe("creator quote refresh", () => {
  it("keeps the 0.2 profile rate through pool ticks and unrelated creator updates", async () => {
    const { result, rerender } = renderHook(() => useCreatorMarketRate("mike-token"));
    await waitFor(() => expect(result.current).toBe(0.2));
    act(() => {
      window.dispatchEvent(new Event("reward-pool-update"));
      window.dispatchEvent(new Event("blockchain-transaction"));
      window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId: "other" } }));
      rerender();
    });
    expect(result.current).toBe(0.2);
    expect(rate).toHaveBeenCalledTimes(1);
  });
  it("retains 0.2 while a new live rate loads, then updates to 0.3", async () => {
    const { result } = renderHook(() => useCreatorMarketRate("mike-token"));
    await waitFor(() => expect(result.current).toBe(0.2));
    let resolve: ((value: number) => void) | undefined;
    rate.mockImplementation(() => new Promise<number>((done) => { resolve = done; }));
    act(() => {
      for (let i = 0; i < 10; i++) window.dispatchEvent(new CustomEvent("creator-vault-update", { detail: { tokenId: "mike-token" } }));
    });
    await waitFor(() => expect(rate).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(0.2);
    await act(async () => { resolve?.(0.3); });
    expect(result.current).toBe(0.3);
  });
  it("does not show the previous token's price when selection changes", async () => {
    const { result, rerender } = renderHook(({ id }) => useCreatorMarketRate(id), { initialProps: { id: "mike-token" } });
    await waitFor(() => expect(result.current).toBe(0.2));
    rate.mockResolvedValue(0.7);
    rerender({ id: "other-token" });
    await waitFor(() => expect(result.current).toBe(0.7));
  });
});