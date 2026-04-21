

## Builder Mode → On-Demand "User Cells"

Today every user boots Builder Mode at startup (`main.tsx` `bm.autoStart()`), the Node Dashboard always shows the SWARM↔Builder toggle, and `BuilderModePanel` is a 500-line panel mounted full-time. That's wasted CPU, wasted UI, and confuses the model: Builder is presented as an *equal alternative* to SWARM when in reality 95% of users only need SWARM.

Goal: **Builder Mode becomes opt-in only, surfaced as a "User Cell"** the user explicitly creates when they want a private mesh.

### Naming

- "Public Cell" / "Global Cell" already exist (Gun.js discovery registry). Keep those names untouched.
- New concept = **User Cell**: a user-owned private mesh built on the existing Builder Mode standalone. Each cell has a 12-char `cellId` derived from the owner's peerId + a short suffix.
- "Builder Mode" is preserved as the *engine* under the hood (no rewrite), but the user-facing label everywhere becomes **"User Cell"**.

### 1. Archive current Builder Mode (preserve, don't delete)

- Rename file: `src/lib/p2p/builderMode.standalone.ts` → `src/lib/p2p/builderMode.standalone-archived.ts`. Keep the export `getStandaloneBuilderMode` working — only the filename and module header comment changes.
- Rename panel: `src/components/p2p/dashboard/BuilderModePanel.tsx` → `BuilderModePanel-archived.tsx`. Keep its default export name.
- Update every importer (17 files identified by search) to the `-archived` paths. No behavioural change — this is a marker rename so future contributors know it's the legacy engine, now wrapped by User Cell.
- Add a one-line header to both archived files: `// ARCHIVED: legacy Builder Mode engine. Now powers on-demand User Cells. Do not extend — extend userCell.ts instead.`

### 2. New `userCell` layer (thin wrapper, not a rewrite)

**`src/lib/p2p/userCell.ts` (new, ~120 lines)**
- `createUserCell(name?: string): UserCell` — generates `cellId = peerId.slice(-8) + '-' + hex(2)`, persists to `localStorage['user-cells']` as `Record<cellId, { name, ownerPeerId, createdAt, lastEnteredAt }>`.
- `enterUserCell(cellId)` — flips connection-state mode to `'builder'`, calls `getStandaloneBuilderMode().start()` (the archived engine), persists `active-user-cell` in localStorage.
- `exitUserCell()` — stops builder standalone, flips mode back to `'swarm'`, clears `active-user-cell`.
- `listUserCells()`, `getActiveUserCell()`, `deleteUserCell(cellId)`, `joinUserCellById(cellId)` (resolves cellId → owner peerId via the existing peer ID resolver, dials in).
- Subscribers: `onCellsChange`, `onActiveCellChange`.
- All persistence is local — no server, no schema change.

**`src/lib/p2p/connectionState.ts`** — extend `NetworkMode` union to `'swarm' | 'builder' | 'cell'` (alias for `'builder'` when entered via a cell). Keep backwards compat by treating `'cell'` as `'builder'` in the standalone routing layer; the only difference is UI labelling.

### 3. Remove auto-start of Builder Mode

**`src/main.tsx`** — drop the `import("./lib/p2p/builderMode.standalone")…autoStart()` branch entirely. Boot only starts SWARM (or nothing if `mode !== 'swarm'`). User Cells start lazily on `enterUserCell()`.

### 4. Node Dashboard — replace mode toggle with "Create Cell" button

**`src/pages/NodeDashboard.tsx`**
- Delete the always-mounted `<BuilderModePanel />` branch.
- Always render `<SwarmMeshModePanel />` for the primary network experience.
- Below the SWARM panel, add a new **`<UserCellsPanel />`** containing:
  - Header "User Cells" + "Create Cell" button (primary).
  - A list of the user's existing cells with their `cellId`, name, last entered, and an **Enter / Exit** button per row.
  - "Join Cell by ID" input (paste a friend's `cellId` and enter their cell).
  - When a cell is **active**, render a compact `<UserCellControls />` (the trimmed-down Builder controls — toggles for `buildMesh`, `approveOnly`, `mining`, plus the approval queue).
- Replace the always-on `<NetworkModeToggle variant="full" />` with a contextual mode badge: "SWARM" by default, "CELL: <cellId>" while inside a cell. The toggle component stays in the codebase but is no longer mounted on the dashboard.

**`src/components/p2p/dashboard/UserCellsPanel.tsx` (new, ~180 lines)**
- Uses `userCell.ts` API.
- "Create Cell" → modal with optional name input → calls `createUserCell(name)` → toast with the new `cellId` + copy button.
- "Enter" buttons call `enterUserCell(cellId)` (handles SWARM disable → mode flip → builder start via existing `switchNetworkMode`).
- Empty-state copy: *"No cells yet. Create one to host a private mesh — invite friends with the cell ID."*

**`src/components/p2p/dashboard/UserCellControls.tsx` (new, ~140 lines)**
- A trimmed clone of `BuilderModePanel` showing only the controls that make sense inside a user-owned cell:
  - `Build a Mesh`, `Approve Only`, `Auto-Connect`, `Mining` toggles
  - Approval queue (pending peers)
  - Manual "Invite by Peer ID" input
  - Connected peers list
- Drops: blockchain-sync toggle (always on inside a cell), torrent-serving toggle (inherits from SWARM defaults), shy-node + show-network-content (these are global preferences, surfaced elsewhere in Settings).
- Reads/writes through `getStandaloneBuilderMode()` — the engine is unchanged, only the surface area shrinks.

### 5. NetworkModeToggle — keep but demote

- `NetworkModeToggle` stays in the codebase for back-compat (used by the wifi popover and the archived BuilderModePanel header). Its primary mounting point — the Node Dashboard — is removed.
- Add a third variant `'cell-badge'` that renders a read-only chip showing `SWARM` or `CELL:abc12345` based on `loadConnectionState().mode` + `getActiveUserCell()`. This is what shows in the dashboard header.

### 6. Memory + docs

- New memory file `mem://features/user-cells`: *"User Cells are user-created private meshes built on the archived Builder Mode engine. Created on-demand from the Node Dashboard ('Create Cell'). Each cell has a 12-char cellId. Entering a cell flips connection-state mode → 'builder' and starts the Builder standalone; exiting returns to SWARM. Boot no longer auto-starts Builder Mode — User Cells are lazy by design to reduce front-end work."*
- Update `mem://architecture/network-mode-persistence`: note new `'cell'` value (alias of `'builder'`) and `active-user-cell` localStorage key.
- Update `mem://p2p/builder-mode-standalone`: prepend "ARCHIVED — now the engine for User Cells. Do not extend; extend `userCell.ts` instead."
- Update `docs/USER_GUIDE.md` and `README.md` to replace Builder-Mode-as-equal-mode language with "Create a User Cell" instructions.

### Why this is the cheapest cut

- Zero physics changes, zero UQRC changes, zero memory-garden changes.
- Builder Mode engine is **kept verbatim** — same standalone, same toggles, same approval queue, same persistence keys. Only the *entry path* changes (lazy-on-create instead of auto-on-boot).
- Front-end work shrinks: dashboard renders one panel by default instead of two; ~360 lines of Builder controls only mount when a cell is active.
- Future work to actually fork the engine into a true cell-aware module can happen later without touching the Builder archive.

### Acceptance

```text
1. main.tsx no longer imports builderMode.standalone at boot. SWARM-only users never load the Builder code path.
2. Node Dashboard renders SwarmMeshModePanel by default. Below it: UserCellsPanel with "Create Cell" button.
3. Clicking "Create Cell" opens a modal, accepts an optional name, returns a 12-char cellId, and persists it to localStorage['user-cells'].
4. Each user cell has Enter / Exit buttons. Entering flips connection-state mode → 'builder', starts Builder standalone, and shows UserCellControls below the cell list. Exiting restores SWARM cleanly via the existing networkModeSwitcher.
5. "Join Cell by ID" accepts a foreign cellId, resolves to the owner's peerId, and dials in via the Builder standalone's connectToPeer.
6. The dashboard header badge reads "SWARM" or "CELL: abcd1234" — no more equal-weight mode toggle on the dashboard.
7. builderMode.standalone.ts is renamed to builderMode.standalone-archived.ts (and the panel to BuilderModePanel-archived.tsx). All 17 importers updated. No behavioural regression — connect, disconnect, manual peer dial, mining, approval queue all work identically when a cell is active.
8. NetworkModeToggle still exists with new 'cell-badge' variant; not mounted on the dashboard.
9. Memory rules added (user-cells) and updated (network-mode-persistence, builder-mode-standalone). USER_GUIDE.md and README.md updated.
10. Mobile 360×560: UserCellsPanel readable, "Create Cell" button full-width, cell list rows tappable, controls drawer collapsible.
```

