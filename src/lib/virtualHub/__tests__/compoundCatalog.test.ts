import { describe, it, expect } from "vitest";
import { COMPOUND_TABLE, ELEMENT_COLORS, blendColor, getCompound } from "../compoundCatalog";
import { HOUSE_PREFAB } from "../builderCatalog";
import { SHELL_DEFS, INNER_SYMBOLS } from "@/lib/brain/elements";

const KNOWN_SYMBOLS = new Set<string>([
  ...SHELL_DEFS.flatMap((s) => s.symbols),
  ...INNER_SYMBOLS,
]);

describe("compoundCatalog", () => {
  it("every HubPieceKind has a compound entry", () => {
    for (const section of HOUSE_PREFAB.sections) {
      for (const item of section.items) {
        const c = getCompound(item.kind);
        expect(c).toBeDefined();
        expect(c.formula.length).toBeGreaterThan(0);
        expect(c.constituents.length).toBeGreaterThan(0);
      }
    }
  });

  it("every constituent symbol exists in the periodic table", () => {
    for (const c of Object.values(COMPOUND_TABLE)) {
      for (const { symbol } of c.constituents) {
        expect(KNOWN_SYMBOLS.has(symbol)).toBe(true);
      }
    }
  });

  it("color is deterministic from constituents", () => {
    const a = blendColor([{ symbol: "Fe", count: 2 }, { symbol: "O", count: 3 }]);
    const b = blendColor([{ symbol: "Fe", count: 2 }, { symbol: "O", count: 3 }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("all constituent symbols have an ELEMENT_COLORS entry", () => {
    for (const c of Object.values(COMPOUND_TABLE)) {
      for (const { symbol } of c.constituents) {
        expect(ELEMENT_COLORS[symbol]).toBeDefined();
      }
    }
  });
});
