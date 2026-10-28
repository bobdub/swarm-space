import { describe, it, expect, beforeEach, vi } from "vitest";
import { getMintMeMinerEnabled, setMintMeMinerEnabled, onMintMeMinerEnabledChange } from "../mintmeMinerPreference";

describe("MintMe miner switch", () => {
  beforeEach(() => localStorage.clear());

  it("is on by default", () => {
    expect(getMintMeMinerEnabled()).toBe(true);
  });

  it("remembers being turned off and back on", () => {
    setMintMeMinerEnabled(false);
    expect(getMintMeMinerEnabled()).toBe(false);
    setMintMeMinerEnabled(true);
    expect(getMintMeMinerEnabled()).toBe(true);
  });

  it("notifies listeners", () => {
    const seen: boolean[] = [];
    const off = onMintMeMinerEnabledChange((v) => seen.push(v));
    setMintMeMinerEnabled(false);
    off();
    setMintMeMinerEnabled(true);
    expect(seen).toEqual([false]);
  });
  it("remains off if storage refuses to save the switch", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    setMintMeMinerEnabled(false);
    expect(getMintMeMinerEnabled()).toBe(false);
    write.mockRestore();
    setMintMeMinerEnabled(true);
  });
});
