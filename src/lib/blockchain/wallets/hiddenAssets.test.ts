import { describe, it, expect, beforeEach } from "vitest";
import { canHideAsset, isAssetHidden, listHiddenAssets, setAssetHidden } from "./hiddenAssets";

describe("hidden wallet assets", () => {
  beforeEach(() => localStorage.clear());

  it("never hides SWARM, even at zero balance", () => {
    expect(canHideAsset("SWARM", 0)).toBe(false);
    setAssetHidden("u", "SWARM", true);
    expect(isAssetHidden("u", "SWARM")).toBe(false);
  });

  it("allows hiding only zero-balance assets", () => {
    expect(canHideAsset("custom:0xabc", 0)).toBe(true);
    expect(canHideAsset("custom:0xabc", 5)).toBe(false);
    expect(canHideAsset("CREDIT", 0)).toBe(true);
  });

  it("round-trips hide and unhide per user", () => {
    setAssetHidden("u", "custom:0xabc", true);
    setAssetHidden("u", "creator:t1", true);
    expect(listHiddenAssets("u")).toEqual(["custom:0xabc", "creator:t1"]);
    expect(listHiddenAssets("other")).toEqual([]);
    setAssetHidden("u", "custom:0xabc", false);
    expect(listHiddenAssets("u")).toEqual(["creator:t1"]);
  });
});
