import { describe, it, expect } from "vitest";
import { COSMO_COMPOUNDS } from "../cosmoChemistry";
import { SHELL_DEFS, INNER_SYMBOLS } from "../elements";
import { COMPOUND_TABLE, ELEMENT_COLORS } from "@/lib/virtualHub/compoundCatalog";
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from "../volcanoOrgan";

const KNOWN = new Set<string>([
  ...SHELL_DEFS.flatMap((s) => s.symbols),
  ...INNER_SYMBOLS,
]);

describe("chemistry coverage", () => {
  it("every cosmo body has at least one constituent and a blended colour", () => {
    for (const [kind, c] of Object.entries(COSMO_COMPOUNDS)) {
      expect(c.constituents.length, kind).toBeGreaterThan(0);
      expect(c.color, kind).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.formula.length, kind).toBeGreaterThan(0);
    }
  });

  it("every cosmo constituent symbol exists in the field's periodic table", () => {
    for (const [kind, c] of Object.entries(COSMO_COMPOUNDS)) {
      for (const { symbol } of c.constituents) {
        expect(KNOWN.has(symbol), `${kind}:${symbol}`).toBe(true);
      }
    }
  });

  it("every cosmo constituent has an ELEMENT_COLORS entry (so blendColor is non-grey)", () => {
    for (const [kind, c] of Object.entries(COSMO_COMPOUNDS)) {
      for (const { symbol } of c.constituents) {
        // n=4+ inner manifold is allowed to fall back to grey; everyone else must be coloured.
        if (KNOWN.has(symbol) && !INNER_SYMBOLS.includes(symbol)) {
          expect(ELEMENT_COLORS[symbol], `${kind}:${symbol}`).toBeDefined();
        }
      }
    }
  });

  it("builder catalog still binds every piece (regression with new registry)", () => {
    expect(Object.keys(COMPOUND_TABLE).length).toBeGreaterThan(0);
    for (const [kind, c] of Object.entries(COMPOUND_TABLE)) {
      expect(c.constituents.length, kind).toBeGreaterThan(0);
    }
  });

  it("volcano organ carries a vent compound matching cosmoChemistry.vent_gas", () => {
    const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
    expect(organ.ventCompound).toBeDefined();
    expect(organ.ventCompound.id).toBe(COSMO_COMPOUNDS.vent_gas.id);
    expect(organ.ventCompound.constituents.length).toBeGreaterThan(0);
  });

  it("required cosmic+geological bodies are all bound", () => {
    const required = ["sun", "moon", "galactic_core", "star_main_sequence", "atmosphere", "water", "vent_gas"] as const;
    for (const k of required) {
      expect(COSMO_COMPOUNDS[k], k).toBeDefined();
    }
  });
});
