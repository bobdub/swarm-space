

## Builder Items as Real Chemical Compounds

Today the Virtual Hub Builder Bar offers generic primitives (`wall_short`, `door_single`, `roof_flat`, …) with arbitrary grey/brown colors. They're disconnected from the rest of the universe — the field has real elements (`H, Li, Be, B, He, Na, Mg, …`), but builder pieces are abstract boxes.

Make every builder item a **real chemical compound** built from the same elements `elements.ts` already pins into the field. Each piece declares a `formula` (e.g. `SiO₂`), a chemistry-derived `color`, `density`, and a tag for which UQRC shell its constituent elements belong to. No new physics — this is data + visuals + a thin compound catalog.

### Compound mapping (real-world building chemistry)

| Section | Piece | Compound | Formula | Why it fits |
|---|---|---|---|---|
| Floor | floor_2, floor_4 | Concrete (calcium silicate hydrate) | CaO·SiO₂·H₂O | Real slab material; Ca + Si + O |
| Walls | wall_short | Adobe / Clay brick | Al₂O₃·2SiO₂·2H₂O (kaolinite) | Earthen wall |
| Walls | wall_long | Limestone block | CaCO₃ | Load-bearing stone |
| Walls | wall_half | Gypsum panel | CaSO₄·2H₂O | Half-height interior |
| Doors | door_single | Cellulose (oak wood) | (C₆H₁₀O₅)ₙ | Solid timber door |
| Doors | door_double | Steel alloy | Fe + C (+ Cr trace) | Double industrial door |
| Windows | window_square | Soda-lime glass | Na₂O·CaO·6SiO₂ | Standard pane |
| Windows | window_wide | Borosilicate glass | B₂O₃·SiO₂ | Wide thermal pane |
| Roof | roof_flat | Bitumen-coated aluminium | Al + (CₙH₂ₙ₊₂) | Flat membrane roof |
| Roof | roof_gable | Clay tile (terracotta) | Fe₂O₃·Al₂O₃·SiO₂ | Pitched tile |

Every constituent element above is already in `SHELL_DEFS` / `INNER_SYMBOLS` (or in a small extension: C, N, O, F, S, Cl, Cr, Fe — second-shell + transition-row additions to round out shell n=2 and n=3).

### Files

**1. `src/lib/virtualHub/compoundCatalog.ts` (new)**
- `Compound` type: `{ id, name, formula, constituents: { symbol, count }[], color, density, shellTags: number[] }`.
- `COMPOUND_TABLE` covering the 11 entries above.
- `getCompound(kind)` mapping each `HubPieceKind` → `Compound`.
- Color is computed deterministically from constituents (weighted blend of per-element colors defined in a small `ELEMENT_COLORS` map shared with `ElementsVisual.tsx` so the universe and the builder agree on what "iron" looks like).

**2. `src/lib/brain/elements.ts`**
- Extend `SHELL_DEFS` shell n=2 with **C, N, O, F** (currently missing — required for cellulose, glass, water, etc.). Keep noble-gas closure (Ne) at the end of the ring.
- Extend shell n=3 with **S, Cl, Cr, Fe** before Ar closure.
- Re-derive ring slot count → recompute deterministic θ. **Update test expectations** in `elements.test.ts` (shell counts, deterministic positions). Conformance unchanged — still pinTemplate-only, no axes writes.

**3. `src/lib/virtualHub/builderCatalog.ts`**
- Each `BuilderItem` gains `compoundId: string` pointing into `COMPOUND_TABLE`.
- `label` becomes the compound's common name (e.g. "Limestone Wall" instead of "Long Wall"). Footprint dimensions unchanged.

**4. `src/components/virtualHub/HubBuildLayer.tsx`**
- Replace `SECTION_COLOR` lookup with `getCompound(piece.kind).color`. Pieces now visually reflect their chemistry (limestone = pale cream, steel = cool grey, terracotta = orange-red, copper = patina cyan, etc.).
- Add a small floating chip on hover showing `formula` (Drei `<Html>` or simple text sprite, mobile: tap the selection to reveal).

**5. `src/components/virtualHub/BuilderBar.tsx`**
- Item tile shows: compound name, formula in small mono font, a 12×12 swatch in the compound's color.
- Section tabs unchanged.

**6. `src/components/brain/ElementsVisual.tsx`**
- Read element colors from the new shared `ELEMENT_COLORS` map (single source of truth) instead of hard-coding the per-shell color. New shell n=2/n=3 elements (C, N, O, F, S, Cl, Cr, Fe) get distinct colors so they read correctly in `/brain`.

**7. `src/types/index.ts`**
- No new `HubPieceKind` values — existing 11 kinds map 1:1 to compounds. (We can add more compounds later without changing the type.)

**8. Tests — `src/lib/virtualHub/__tests__/compoundCatalog.test.ts` (new)**
- Every `HubPieceKind` has a compound entry.
- Every constituent symbol referenced exists in `elements.ts` (`SHELL_DEFS` ∪ `INNER_SYMBOLS`). Catches drift if the periodic table is edited.
- Color is deterministic from constituents (same input → same hex).
- Updated `elements.test.ts`: shell n=2 count = 10, shell n=3 count = 10 (matter + 1 noble closure each); deterministic positions snapshot regenerated.

**9. Memory**
- Update `mem://features/virtual-hub-builder`: append "Builder pieces are real chemical compounds. Each `BuilderItem` declares a `compoundId` resolving to `COMPOUND_TABLE` (limestone, gypsum, kaolinite, soda-lime glass, borosilicate, cellulose, steel, terracotta, bitumen-Al, calcium-silicate concrete). All constituent elements must exist in `elements.ts` — single periodic-table source of truth shared with the Brain Universe."
- Update `mem://architecture/brain-universe-elements`: note that shell n=2 and n=3 now include C, N, O, F, S, Cl, Cr, Fe so building chemistry round-trips into the field.

### Why this fits UQRC

The pieces a member places in their hub are made of the same elements pinned in the field. The Virtual Hub becomes a downstream observable of the periodic table the universe already encodes. Future passes can take this further (e.g. project a piece's compound back as a tiny pin into the local field cell, so building literally adds curvature where you build), but this pass is pure data + visuals — no physics change, no risk to the brain conformance tests.

### Acceptance

```text
1. compoundCatalog.ts exists with 11 compounds, each referencing only elements present in elements.ts.
2. Every HubPieceKind resolves to a real compound; BuilderBar tiles show name + formula + color swatch.
3. HubBuildLayer renders pieces in compound-derived colors (limestone cream, steel grey, terracotta orange, etc.); section colors removed.
4. Hover/tap on a placed piece reveals its formula via small floating label (mobile: tap-to-reveal).
5. elements.ts shell n=2 includes C, N, O, F before Ne; shell n=3 includes S, Cl, Cr, Fe before Ar. uqrcConformance.test.ts still passes (pinTemplate only, commutator < 2.0).
6. ElementsVisual.tsx reads colors from shared ELEMENT_COLORS map; /brain shows the new elements as labeled spheres on their shell rings.
7. compoundCatalog.test.ts asserts: every constituent symbol exists in elements.ts; colors are deterministic.
8. No regression to existing builder behaviour: snapping (0.4 m), members-only edit, debounced sync, mode switching all unchanged.
9. Mobile 360×560: BuilderBar tiles legible (formula on second line, font-size ≤ 11 px), pieces still tappable.
10. Memory rules updated; cross-link added between virtual-hub-builder and brain-universe-elements.
```

