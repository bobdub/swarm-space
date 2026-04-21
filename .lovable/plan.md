

## Builder Bar — place walls, doors & roofs inside the Virtual Hub

A "Sims-style" build mode for the 3D project environment. Members of the project can pop open a Builder Bar, pick a piece from a prefab house, click to spawn it in front of them, drag it across the floor to position, and optionally snap it to neighbouring pieces.

### What the user sees

```text
[Build] button (top-right HUD, members only)
   └─ click → Builder Bar slides up from the bottom

Builder Bar
┌─────────────────────────────────────────────────────────────┐
│  Prefab: [House ▾]                                          │
│  ─────────────────────────────────────────────────────────  │
│  Sections:  [ Walls ] [ Doors ] [ Windows ] [ Roof ] [ Floor ]│
│  ─────────────────────────────────────────────────────────  │
│  Items (for selected section):                              │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐                                    │
│  │ ▭ │ │ ▭ │ │ ⊟ │ │ ⌂ │   ← click to place                │
│  └───┘ └───┘ └───┘ └───┘                                    │
│                                                             │
│  Magnetic snap [●○]   Rotate ⟲ ⟳   Delete 🗑                │
└─────────────────────────────────────────────────────────────┘
```

- Click a thumbnail → piece spawns 2 m in front of the avatar at floor level.
- While "Build mode" is on, **clicking a placed piece** selects it; **dragging** moves it on the XZ plane (mouse on desktop, finger on mobile). Pointer-lock is paused during build mode.
- "Magnetic" toggle: when on, dragging snaps the active edge to the closest neighbour edge within 0.4 m (left/right/top/bottom). Off = free placement.
- Rotate buttons spin the selection 90°. Delete removes it.
- "Exit build" returns to walk mode.

### Prefab catalogue (v1: a small house)

One prefab — `House` — exposed in the bar. Five sections, each with 3–4 items. All built from primitive geometries so no asset downloads are needed.

| Section | Items | Geometry |
|---|---|---|
| Walls   | Short (2×2.5), Long (4×2.5), Half-height (4×1.25) | `boxGeometry` 0.15 thick |
| Doors   | Single, Double | wall with cut-out (two stacked boxes + frame) |
| Windows | Square, Wide   | wall with translucent pane (`meshStandardMaterial transparent opacity 0.3`) |
| Roof    | Flat 4×4, Gable 4×4 | flat = thin box; gable = two angled boxes |
| Floor   | Tile 2×2, Tile 4×4 | thin box at y = 0.02 |

Materials use the existing teal/dark palette; each item gets a slight tint when selected (emissive 0.3).

### Magnetic snap rule

For every placed piece, compute its 4 edge midpoints in world space. While dragging, find the closest edge midpoint of any *other* piece. If the distance < 0.4 m and rotations align (Δyaw within 5° of 0/90/180/270), translate the piece so the matched edges coincide. Cheap O(n) check — fine for the dozens of pieces a single hub will hold.

### Persistence & sync

- Build state lives on the project: `project.hubBuild = { pieces: HubPiece[] }` where
  ```ts
  type HubPiece = {
    id: string;          // uuid
    kind: "wall_short" | "wall_long" | "door_single" | ... ;
    section: "walls" | "doors" | "windows" | "roof" | "floor";
    position: [number, number, number];
    rotationY: number;
    placedBy: string;    // userId
    placedAt: number;
  };
  ```
- Reuse `updateProject()` (already broadcasts via the standalone mesh `broadcastProject`) to save changes — debounced 1 s after the last edit so dragging doesn't spam the network. Other connected peers visiting the same hub see pieces appear/move when the project upsert arrives.
- Non-members see the built world but cannot enter build mode (Build button hidden; drag handlers no-op).

### Files

**New**
- `src/lib/virtualHub/builderCatalog.ts` — pure data: prefab → sections → items, with geometry args + default size.
- `src/lib/virtualHub/snapping.ts` — `findSnap(piece, others, threshold)` returning a delta vector.
- `src/components/virtualHub/BuilderBar.tsx` — bottom HUD: prefab picker, section tabs, item grid, snap toggle, rotate/delete, exit. Uses existing `Tabs`, `Switch`, `Button` UI.
- `src/components/virtualHub/HubBuildLayer.tsx` — renders all `HubPiece`s as `<mesh>`es inside the Canvas; handles selection ring, hover highlight, and exposes a `dragPiece(id, deltaXZ)` API via context.
- `src/components/virtualHub/useBuildController.ts` — manages `pieces`, `selectedId`, `magnetic`, `mode: "walk" | "build"`; debounced `updateProject` calls; raycaster for click-to-select / drag on the floor plane.

**Edited**
- `src/types/index.ts` — add optional `hubBuild?: { pieces: HubPiece[] }` to `Project`.
- `src/pages/VirtualHub.tsx` —
  - Mount `<HubBuildLayer />` inside `<HubScene />`.
  - Add Build/Exit-build button to HUD (visible only when `isProjectMember(project, currentUser.id)`).
  - When `mode === "build"`: skip `<PointerLockControls />`, freeze `PlayerController` movement, disable touch-look, show `<BuilderBar />` and the on-canvas drag handlers instead.
  - Re-use the existing mobile virtual joystick — hidden in build mode; finger drag now moves the selected piece.
- `src/components/virtualHub/BuildersBox.tsx` — keep as the central plinth ornament, unchanged.

**Memory**
- `MemoryGarden.md` — caretaker note: handing the dreamers their first bricks so the meadow can grow walls.

### Mobile parity

- Build button sits in the top HUD stack (already responsive).
- Item grid in the bar scrolls horizontally on `< sm` (`overflow-x-auto`, snap items).
- Drag uses pointer events on the canvas wrapper — already wired the way the touch-look is, so it works on both desktop and mobile with the same code.
- Smaller hit targets (40 px) on placed pieces use a `<mesh>` with a slightly enlarged invisible bounding box for easier finger taps.

### Out of scope for v1 (future bar tabs)

Roof pitching beyond gable, stairs, furniture, paint/material picker, multi-prefab catalogue, undo/redo. The catalogue file is structured so adding a `Cabin` or `Tent` prefab later is one new entry.

### Acceptance

```text
1. Project member opens a hub → "Build" button visible top-right.
2. Click Build → bar slides up, walk mode pauses.
3. Click a wall thumbnail → wall appears 2 m ahead at floor level, selected.
4. Drag the wall → it follows the cursor/finger on the XZ plane.
5. Toggle Magnetic → drag near another wall's edge → snaps cleanly.
6. Click Rotate → wall spins 90°.
7. Click Exit Build → walk mode resumes, pieces remain.
8. Reload the page → pieces are still there (saved on project).
9. Connected peer joins the same hub → sees the same pieces; new placements appear within ~2 s.
10. Non-member opening the hub → no Build button; pieces are visible and solid-looking but uneditable.
```

