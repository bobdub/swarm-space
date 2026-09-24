# Phase 6 — Remix Lab Stability + Project Submit

Status: DONE

## Why
Lab is the upstream of every minted asset (prefabs, tools, future
coins). Before adding more sinks we lock down the surface and let the
user route a molecule into a chosen project Brain.

## What shipped
1. `LabErrorBoundary` wraps the `VectorCanvas`. A crash inside draw no
   longer unmounts the route — the user sees an inline panel with the
   error message and a Reset button that remounts the canvas children.
2. `ProjectPicker` lists the user's projects via `getUserProjects()`
   and persists the active id in `localStorage('swarm-lab-active-project')`.
   Stale ids (project was deleted) are cleared on next load.
3. `submitMoleculeToProject({ projectId, molecule, actorId })` writes
   a `ProjectMintRecord` to IDB `swarm-lab-project-mints` v1, gossips
   it on `BroadcastChannel('swarm:lab:project-mints')` and emits a
   `lab.recipe` with `formula: submit:<projectId>:<molFormula>` so the
   shared field still feels the recipe.
4. `bootLabProjectBridge()` hydrates prior submissions on idle from
   `src/main.tsx`.

## Files
- `src/lib/remix/labProjectBridge.ts`
- `src/components/remix/LabErrorBoundary.tsx`
- `src/components/remix/ProjectPicker.tsx`
- `src/components/remix/LabTab.tsx` (boundary + picker + submit)
- `src/main.tsx` (idle hydrate)

## Invariants honored
- No `<form>`. Buttons all `type="button"`.
- IDB lifecycle non-destructive (`onversionchange` closes cleanly).
- Local-protect: peer records never overwrite local-origin records.
- Existing coin/labour/forge wiring untouched — only adds a project tag
  on the molecule envelope.

## QA
- Force a `throw` inside `VectorCanvas` → boundary panel renders, route stays
  mounted, Reset clears the error.
- Picker remembers selection across reload.
- Submitting a molecule: record visible in `listSubmissionsForProject(id)`
  on first tab AND on a second tab via `BroadcastChannel` within ~1s.
- `coin.bus` labour fill still credits actor on submit (no Phase 3 regression).

## Next phase (queued)
Phase 7 — NPCs visible in the world: spawn low-poly capsule avatars at
the npc roster positions and seed base resources (animals/water/wood)
so the live tick is observable in `BrainUniverseScene`.