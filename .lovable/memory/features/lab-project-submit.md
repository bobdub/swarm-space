---
name: Lab → Project submission
description: Phase 6 Remix Lab project picker, error boundary, and submitMoleculeToProject IDB+BroadcastChannel pipeline
type: feature
---
`submitMoleculeToProject({projectId, molecule, actorId})` writes a
`ProjectMintRecord` to IDB `swarm-lab-project-mints` v1, gossips on
`BroadcastChannel('swarm:lab:project-mints')`, and emits a `lab.recipe`
with `formula: submit:<projectId>:<molFormula>` so the shared scaffold
field still feels it. Local-protect: peer records cannot overwrite
local-origin (`_origin: 'local'`).

Active project id persists in `localStorage('swarm-lab-active-project')`.
`ProjectPicker` reads `getUserProjects()` and clears the saved id if
the project was deleted.

`LabErrorBoundary` wraps `VectorCanvas` so draw crashes never unmount
the route — Reset increments a `nonce` that remounts children.

Hydrate on idle from `src/main.tsx` via `hydrateProjectMints()`.

Files:
- `src/lib/remix/labProjectBridge.ts`
- `src/components/remix/LabErrorBoundary.tsx`
- `src/components/remix/ProjectPicker.tsx`
- `src/components/remix/LabTab.tsx`
- `docs/PHASE_6_LAB_STABILITY.md`