# Lab — Brains Tab & Assets Tab

## Brains Tab (project-agnostic gallery)

The Brains tab no longer cares which project the user came from. It becomes a public registry of submitted Project Brains that anyone can remix, join, or like. Only the original creator can remove their submission.

### UX flow

1. **Header action: `Submit a Brain`** (replaces current `Submit Brain`).
   - Opens a popover with an info blurb:
     > "Select one of your projects to list its Brain simulation as a public, remixable Brain. Other users will be able to remix it into a new project, join the live frame, or like it."
   - Below the blurb: scrollable list of the user's projects (`getUserProjects()`), each row = radio-select.
   - Footer: `Submit` button (disabled until a project is picked) + `Cancel`.

2. **On submit** → write a `BrainSubmission` record (local-first + gossip), then close the popover and toast.

3. **Gallery grid** lists every known submission (local + peer). Each card:
   - Live-frame wrapper: embeds the project's Brain universe in a low-cost iframe-style mount (lazy `BrainUniverseScene` keyed by `projectId`, paused unless hovered/in-view to keep perf safe).
   - Title, creator avatar/handle, like count.
   - Buttons: **Remix into new project**, **Join**, **Like**.
   - If `submission.actorId === currentUser.id`: extra **Remove** button (only visible to creator).

4. **Remix** → clones the project's seed into a fresh project (Phase-1 scaffold: create a new project with `remixOf: submission.projectId` metadata and navigate to it; the actual universe-clone bridge lands in a follow-up — keep the call site stable).
   **Join** → `navigate('/project/<id>')` (or `/brain?projectId=...` if the live universe route exists).
   **Like** → increments local like count + gossip.

### Data layer

New module `src/lib/remix/brainSubmissionsStore.ts` modeled on `labProjectBridge.ts`:

- IndexedDB `swarm-brain-submissions` v1, store `submissions` keyed by `id`.
- `BroadcastChannel('swarm:brain:submissions')` cross-tab fan-out.
- Local-protect: peer never overwrites local-origin (project rule).
- Non-destructive `onversionchange`.
- Record:
  ```ts
  interface BrainSubmission {
    id: string;            // `brain:<projectId>:<actorId>`
    projectId: string;
    projectName: string;
    actorId: string;
    actorHandle?: string;
    createdAt: number;
    likes: number;
    _origin: 'local' | 'peer';
  }
  ```
- API: `hydrate()`, `submit({projectId, projectName})`, `remove(id)` (creator-only enforced at call site), `like(id)`, `list()`, `subscribe(fn)`, `attachGossip(bridge)`, `acceptPeer(rec)`.
- Hydrate from `main.tsx` next to `hydrateProjectMints()`.

### Files

- **New**: `src/lib/remix/brainSubmissionsStore.ts`, `src/components/remix/SubmitBrainPopover.tsx`, `src/components/remix/BrainSubmissionCard.tsx`.
- **Rewritten**: `src/components/remix/BrainsTab.tsx` — header + popover trigger + grid of `BrainSubmissionCard`, empty-state when zero submissions.
- **Edited**: `src/main.tsx` — call `hydrateBrainSubmissions()` alongside other hydrators.

---

## Assets Tab (project-scoped mint gallery)

The Assets tab shows every minted asset belonging to the **project the user is currently inside** (read via `getActiveProjectId()` from `labProjectBridge`, same source the Lab uses). Each asset can be imported into the user's Builder Bar, but only when the user actually owns the required chemicals.

### UX

- Header: `Assets in <projectName>` + small project picker (re-uses existing `ProjectPicker` from LabTab) so users can change scope without leaving the tab.
- Grid of asset cards (one per `MintedRecord` with matching `projectId`, sourced from `subscribeMintedPrefabs`).
- Each card shows: prefab name, formula chips, size preset, creator, and an **Import to Builder** button.
- **Gate**: compute required atoms from `prefab.formula` (via `moleculeCatalog`) vs `harvestedInventory.listHarvested()`.
  - If user has all atoms ≥ formula counts → button enabled; click registers the prefab in the Builder Bar (`registerCustomPrefab` is already triggered on hydrate, so "Import" here flips a per-user "available in builder bar" flag in localStorage `swarm-imported-assets`).
  - If missing → button disabled with tooltip `Need: 2× H, 1× O` (locked icon, same `Lock` glyph as ElementPicker).
- Empty state: `No assets minted in this project yet. Open the Lab to create one.`

### Files

- **Rewritten**: `src/components/remix/AssetsTab.tsx`.
- **New** (small): `src/lib/remix/importedAssets.ts` — tiny localStorage flag store + subscribe so Builder Bar can hide non-imported prefabs per-project.
- **No changes** to mint pipeline, harvest pipeline, or chemicals — pure read/aggregate layer.

---

## Out of scope (deferred)

- Real `BrainUniverseScene` clone-from-seed (Remix button currently creates a stub project with `remixOf` link; full universe seed copy is a follow-up).
- P2P gossip wiring of `brainSubmissionsStore` beyond BroadcastChannel — the `attachGossip` seam is provided but the Gun bridge hookup ships separately to keep this PR stability-safe.
- NPC embodiment (still bugged, tracked in `docs/KNOWN_ISSUES.md`).

## Memory

Append memory file `mem://features/brains-tab-gallery` describing the new public Brain submission model, and update `mem://features/remix-elemental-lab` to note the Assets tab is project-scoped with chemical-gated import.
