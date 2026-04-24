

## Portal management from the drop menu

Add a delete affordance inside the existing "Drop a portal" modal so the same place you create a portal is also where you remove it. No in-world clicks needed.

### Behavior

- Each project row in `DropPortalModal` shows whether a portal already exists for that project (in the current `universeKey`).
- Rows with an existing portal display:
  - A small "● placed" chip on the right.
  - A trash icon button next to the row.
- Clicking the row when a portal exists → "Move portal here" (replace in place).
- Clicking the trash icon → confirms, then removes the portal from the world and persistence.

### Steps

1. **Pass portal state into the modal** (`BrainUniverseScene.tsx`)
   - Pass `existingPortalsByProject: Map<projectId, portalId>` into `<DropPortalModal>`.
   - Add `onDeletePortal(projectId)` handler that:
     - Looks up the portal by `projectId`.
     - Calls `physics.removeBody('portal-' + id)`.
     - Updates `portals` state and `savePortals(universeKey, ...)`.
     - Toasts "Portal removed."

2. **Update `DropPortalModal.tsx`**
   - Accept `existingPortalsByProject` and `onDeletePortal` props.
   - Render each project row as a flex container: `[Button: name + chip][Trash IconButton]`.
   - Button label flips to "Move portal here" when a portal exists for that project.
   - Trash button opens an inline `AlertDialog` confirm ("Remove your portal to *Project X*?").

3. **One-per-project enforcement** (`handleDropPortal` in `BrainUniverseScene.tsx`)
   - Before insert: if a portal with the same `projectId` already exists, remove the old body + entry first, then drop the new one. Toast: "Portal moved."

### Files

- Edit `src/components/brain/DropPortalModal.tsx` — add chip, trash button, confirm dialog, new props.
- Edit `src/components/brain/BrainUniverseScene.tsx` — build `existingPortalsByProject`, add `handleDeletePortal`, replace-in-place in `handleDropPortal`.

### Notes

- No changes to `PortalDefect.tsx` or `brainPersistence.ts` — purely a modal-level management surface.
- Only the portal owner sees their portals in their own modal (modal lists *your* projects, and portals are scoped per `universeKey`), so the delete affordance is naturally owner-gated.

