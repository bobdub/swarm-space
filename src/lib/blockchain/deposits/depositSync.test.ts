import { beforeEach, describe, expect, it } from "vitest";
import { isDepositSynced, markDepositsSynced } from "./depositSync";
beforeEach(() => localStorage.clear());
describe("hold & sync", () => {
  it("keeps deposits locked while no peer is connected", () => {
    expect(markDepositsSynced(["d1"], 0)).toBe(false);
    expect(isDepositSynced("d1")).toBe(false);
  });
  it("unlocks deposits once a peer is connected", () => {
    expect(markDepositsSynced(["d1"], 1)).toBe(true);
    expect(isDepositSynced("d1")).toBe(true);
  });
});
