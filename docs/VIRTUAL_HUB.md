# Virtual Hub & Builder Bar

_Last updated: 2026-04-21_

The **Virtual Hub** is a walkable 3D room owned by every project. The **Builder Bar** is the Sims-style construction layer that lets project members lay walls, doors, windows, roofs, and floor tiles inside that room. Pieces persist on the project and sync to peers through the existing project broadcast.

---

## File Map

| File | Role |
|------|------|
| `src/pages/VirtualHub.tsx` | Hosts the R3F `<Canvas>`, scene, HUD, and switches between walk and build modes. |
| `src/components/virtualHub/HubBuildLayer.tsx` | Renders all `HubPiece`s in 3D; raycasts the floor plane for click-to-select / drag. |
| `src/components/virtualHub/BuilderBar.tsx` | Bottom HUD: prefab picker, section tabs, item grid, magnetic toggle, rotate, delete, exit. |
| `src/components/virtualHub/useBuildController.ts` | State machine: `mode`, `selectedId`, `magnetic`, debounced persistence. |
| `src/lib/virtualHub/builderCatalog.ts` | Pure data — `HOUSE_PREFAB` with sections (Walls / Doors / Windows / Roof / Floor). |
| `src/lib/virtualHub/snapping.ts` | `findSnap(piece, others, threshold)` — edge-midpoint snap on the XZ plane. |

---

## Data Model

`Project.hubBuild` is an optional field on the project record:

```ts
type HubPiece = {
  id: string;            // uuid
  kind: HubPieceKind;    // wall_short | wall_long | door_single | …
  section: HubPieceSection; // walls | doors | windows | roof | floor
  position: [number, number, number]; // metres
  rotationY: number;     // radians, snapped to 0/π/2 increments
  placedBy: string;      // userId
  placedAt: number;      // epoch ms
};

type Project = {
  // …
  hubBuild?: { pieces: HubPiece[] };
};
```

---

## Permissions

Edits to `hubBuild` are members-only. The write path lives in `src/lib/projects.ts`:

```ts
const onlyHubBuild =
  Object.keys(updates).length === 1 && 'hubBuild' in updates;

if (onlyHubBuild) {
  if (!isProjectMember(project, user.id)) throw new Error('Members only');
} else if (project.owner !== user.id) {
  throw new Error('Owner only');
}
```

All other project fields remain owner-only. Non-members see the built world but cannot enter Build Mode (the **Build** button is hidden and drag handlers no-op).

---

## Persistence & Sync

- `useBuildController` mutates pieces optimistically in local state.
- After every change, a 1 s debounce calls `updateProject(project.id, { hubBuild: { pieces: next } })`.
- `updateProject` writes IndexedDB and triggers `broadcastProject` via `swarmMesh.standalone.ts`.
- Receiving peers upsert the project; `<HubBuildLayer />` re-renders on the next snapshot, typically within ~2 s of the edit.

---

## Magnetic Snapping

While dragging, `findSnap` computes the four edge midpoints of the active piece in world space and finds the closest edge midpoint of any *other* piece. If the distance is below **0.4 m** and rotations align (Δyaw within 5° of 0/90/180/270), the piece is translated so the matched edges coincide. Cheap O(n) — fine for the dozens of pieces a single hub holds.

---

## Mode Switching

- **Walk mode** uses `<PointerLockControls />` on desktop and the existing virtual joystick on mobile.
- Toggling **Build** in `useBuildController` flips `mode = 'build'`, which:
  - Skips `<PointerLockControls />` so the cursor is free.
  - Freezes the player controller's movement loop.
  - Hides the mobile joystick; the same canvas pointer handlers now drag the selected piece.
  - Shows the Builder Bar.

Exiting Build Mode reverses all four steps.

---

## Out of Scope (v1)

- Stairs, furniture, paint/material picker, multi-prefab catalogue, undo/redo, gable pitch beyond the v1 prefab. The catalogue file is structured so a `Cabin` or `Tent` prefab is one new entry.

---

## Acceptance Checklist

1. Project member sees a **Build** button in the hub HUD.
2. Build → Builder Bar slides up; walk mode pauses.
3. Click a wall thumbnail → wall spawns 2 m ahead, selected.
4. Drag → piece follows pointer/finger on the XZ plane.
5. Magnetic ON → near a neighbour edge → snaps cleanly.
6. Rotate → 90° spin; Delete → removes selection.
7. Exit Build → walk mode resumes, pieces remain.
8. Reload → pieces still present.
9. Connected peer joins the same hub → sees the pieces; new placements appear within ~2 s.
10. Non-member opens the hub → no Build button; pieces visible and uneditable.