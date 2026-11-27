import { expect, it } from "vitest";
import { isNewerHolding } from "../p2pSync";

const holding = (amount: number, lastUpdated: string) => ({ userId: "u", tokenId: "t", ticker: "TOK", creatorUserId: "u", amount, lastUpdated });

it("takes a peer's newer copy of another member's holding, but not older, future-dated or malformed ones", () => {
  const ours = holding(100, "2026-01-01T00:00:00Z");
  expect(isNewerHolding(holding(80, "2026-01-02T00:00:00Z"), ours)).toBe(true);
  expect(isNewerHolding(holding(80, "2025-12-31T00:00:00Z"), ours)).toBe(false);
  expect(isNewerHolding(holding(80, "2026-01-01T00:00:00Z"), ours)).toBe(false);
  expect(isNewerHolding(holding(80, new Date(Date.now() + 3_600_000).toISOString()), ours)).toBe(false);
  expect(isNewerHolding(holding(-1, "2026-01-02T00:00:00Z"), ours)).toBe(false);
  expect(isNewerHolding(holding(80, "not a date"), ours)).toBe(false);
});
