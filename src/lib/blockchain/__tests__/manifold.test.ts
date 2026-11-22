import { describe, expect, it } from "vitest";
import { CADENCE_SPACING_MS } from "../chainCatchup";
import { MAX_CELL_MEMBERS } from "../cellChain/roster";
import { msUntilSpot, SPOT_WINDOW_MS, spotIndex, spotOffset } from "../manifold";

const BEAT = 60_000_000; // an arbitrary beat number

describe("manifold mining spots", () => {
  it("gives every account on the chain its own place, the same on every peer", () => {
    const accounts = ["carol", "alice", "bob"];
    expect(spotIndex("alice", accounts)).toBe(0);
    expect(spotIndex("bob", ["bob", "carol", "alice"])).toBe(1);
    expect(spotIndex("dave", accounts)).toBe(spotIndex("dave", ["bob"]));
    expect(spotIndex("dave", accounts)).toBeGreaterThanOrEqual(1 << 16);
  });

  it("keeps a full cell's spots apart within the window", () => {
    for (const tick of [BEAT, BEAT + 1, BEAT + 17]) {
      const spots = Array.from({ length: MAX_CELL_MEMBERS }, (_, i) => spotOffset(i, tick)).sort((a, b) => a - b);
      expect(spots[0]).toBeGreaterThanOrEqual(0);
      expect(spots[spots.length - 1]).toBeLessThan(SPOT_WINDOW_MS);
      for (let i = 1; i < spots.length; i++) expect(spots[i] - spots[i - 1]).toBeGreaterThan(100);
    }
  });

  it("moves the first spot from miner to miner across beats", () => {
    const wins = [0, 0, 0];
    for (let t = BEAT; t < BEAT + 300; t++) {
      const offsets = wins.map((_, i) => spotOffset(i, t));
      wins[offsets.indexOf(Math.min(...offsets))]++;
    }
    for (const w of wins) expect(w).toBeGreaterThan(60);
  });

  it("counts down to the spot, then stays open for the rest of the beat", () => {
    const start = BEAT * CADENCE_SPACING_MS;
    const offset = spotOffset(2, BEAT);
    expect(msUntilSpot(2, start)).toBe(offset);
    expect(msUntilSpot(2, start + offset)).toBe(0);
    expect(msUntilSpot(2, start + CADENCE_SPACING_MS - 1)).toBe(0);
  });
});
