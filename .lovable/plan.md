

## Node Dashboard cleanup

Three small reorganizations on the SWARM Mesh Mode panel and one removal under Advanced Options.

### Changes

**1. `src/components/p2p/dashboard/SwarmMeshModePanel.tsx`**
- **Remove** the four-line "Status checks" block at the bottom:
  - "Auto-connect enabled (bootstrap + library)"
  - "Library exchange active"
  - "Blockchain sync active"
  - "Content auto-served to peers"
- **Move** the "Block User" button so it renders directly under the Connection Library section (after the connected peers list / blocked collapsible), not floating at the bottom. Order becomes: Library → Blocked (if any) → Block User button.
- The "Content Distribution" panel (the panel that surfaces served chunks / content auto-serving stats) is rendered by the parent `NodeDashboard` page, not inside `SwarmMeshModePanel`. So this file's job is just removal + button reorder.

**2. `src/pages/NodeDashboard.tsx`**
- Re-order the SWARM Mesh tab sections so **Content Distribution** renders **above** the **Connection Library** (currently below it). Just swap the JSX order of those two sibling sections — no prop or logic changes.

**3. Advanced Options — remove Test Mode**
- In `src/pages/NodeDashboard.tsx` (or wherever the Advanced Options accordion/section is composed), remove the `<TestModePanel />` render and its surrounding wrapper/label.
- Leave `src/components/p2p/dashboard/TestModePanel.tsx` on disk (no deletion) so any other reference or future re-enable still works; just stop mounting it. If nothing else imports it after removal, the bundler will tree-shake it.

### Files touched

- `src/components/p2p/dashboard/SwarmMeshModePanel.tsx` — delete status-checks block, move Block User button under the library
- `src/pages/NodeDashboard.tsx` — swap Content Distribution above Connection Library; remove Test Mode from Advanced Options
- `MemoryGarden.md` — short caretaker reflection on pruning ornamental signage so the working garden beds show through

### What the user sees

```text
SWARM Mesh tab:
  Identity
  Mining
  Show Network Content / Shy Node
  Connect to User
  Content Distribution     ← moved up
  Connection Library
  Blocked (if any)
  [ Block User ]           ← moved here
  (no more "Auto-connect / Library exchange / Blockchain sync / Content auto-served" lines)

Advanced Options:
  (Test Mode panel removed)
```

No protocol or data changes. Pure UI reorganization.

