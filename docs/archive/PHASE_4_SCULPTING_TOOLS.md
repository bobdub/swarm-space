# Phase 4 — Sculpting → Tools (Forge from Lab)

Lab molecules can now be **forged** into custom Tools that feed
`toolCatalog`, so `sculpting.applyImpact()` (used by both Users and
NPCs) can swing them against earth shells and builder blocks. This
closes the second half of the Lab → World bridge: Phase 1 minted
placeable Prefabs, Phase 4 mints swingable Tools.

## UQRC chain

1. `Molecule` (Lab) → `deriveForgedTool()` picks parts:
   - **head**    = highest atomic-mass non-organic element
   - **handle**  = best organic candidate (C → H → fallback)
   - **binding** = smallest-count remaining constituent
2. `actionKind` derived from total mass (whittle / chop / dig).
3. `baseSharpness = 0.32 + aspectTerm·0.55 + mineralBonus − organicPenalty`
4. `registerCustomTool()` exposes the result via `getToolAny()` /
   `listAllTools()` — the same path the existing predicate consumes.
5. `sculpting.applyImpact()` runs unchanged: same energy-vs-resistance
   gate, same `'cell-carved'` event, same scaffold-bus emission.

## Files

- `src/lib/brain/toolForge.ts` — pure derivation (Molecule → Tool).
- `src/lib/brain/toolMintStore.ts` — IndexedDB `swarm-tool-mints` v1,
  BroadcastChannel `swarm:tool:mints`, `attachToolGossip` plug-point.
- `src/lib/brain/tool.bus.ts` — `forgeMoleculeAsTool()` orchestrator
  (derive → register → persist → gossip → field recipe event).
- `src/lib/brain/toolCatalog.ts` — added `registerCustomTool`,
  `getToolAny`, `listAllTools`, `listCustomTools`.
- `src/components/remix/LabTab.tsx` — **Forge as Tool** button.
- `src/main.tsx` — `bootToolBusBridges()` hydrates prior forges on idle.

## Invariants preserved

- Local-protection: peer records cannot overwrite local-origin records.
- Non-destructive cross-tab IDB upgrade (`onversionchange` only closes).
- No new placement system — tools surface through the same catalog the
  predicate already reads. Built-in `getTool()` still returns just the
  three base specs; consumers that should see forges import
  `getToolAny` / `listAllTools`.
- Decision branches still go through `selectByMinCurvature` upstream;
  this module only adds catalog entries.

## QA checklist

- Forge a wood-heavy molecule → expect `whittle` (Knife), low sharpness.
- Forge a flint/stone molecule → expect `chop` or `dig` with mineral bonus.
- Reload page → forged tools rehydrate from IndexedDB.
- Open a second tab, forge → first tab receives via BroadcastChannel.