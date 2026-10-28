import { describe, it, expect, beforeEach } from "vitest";
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
});
