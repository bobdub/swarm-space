import { describe, expect, it } from "vitest";
import { beatIsFree, epochAfter, tickAt } from "../blockHeader";

const at = (iso: string) => Date.parse(iso);

describe("block header cadence", () => {
  it("numbers beats every 30 s of mesh time", () => {
    expect(tickAt(0)).toBe(0);
    expect(tickAt(29_999)).toBe(0);
    expect(tickAt(30_000)).toBe(1);
  });

  it("allows one block per beat", () => {
    const parent = { timestamp: "2026-12-01T00:00:10.000Z" };
    expect(beatIsFree(parent, at("2026-12-01T00:00:29.000Z"))).toBe(false);
    expect(beatIsFree(parent, at("2026-12-01T00:00:30.000Z"))).toBe(true);
  });

  it("starts a new epoch only after a gap longer than 10 minutes", () => {
    const parent = { timestamp: "2026-12-01T00:00:00.000Z", version: 2, epoch: 3 };
    expect(epochAfter(parent, at("2026-12-01T00:10:00.000Z"))).toBe(3);
    expect(epochAfter(parent, at("2026-12-01T00:10:00.001Z"))).toBe(4);
    expect(epochAfter({ timestamp: parent.timestamp }, at("2026-12-01T00:00:30.000Z"))).toBe(0);
  });
});
