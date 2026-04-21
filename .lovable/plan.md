

## Documentation refresh — user-facing + code-level

Sweep the docs and in-app text to match what the codebase actually does today. Two recent shifts have left the documentation drifting:

1. **Virtual Hub now has a 3D Builder Bar** (Sims-style walls/doors/roofs) plus a polished walk mode (green floor, joystick, full post panels). Nothing in user docs or in-app help mentions it.
2. **Dead-code cleanup removed the legacy "Hybrid" mesh and the "Encrypted Sync Orchestrator"** — yet `HYBRID_P2P_ARCHITECTURE.md`, `HYBRID_SYSTEM_SUMMARY.md`, `MIGRATION_TO_HYBRID.md`, and several README/USER_GUIDE paragraphs still describe those layers as live.

Plus a few smaller drifts: Settings still says "Flux walkthrough" (project rebranded to Imagination Network / Swarm Space), and the "Keys" tab text talks only about a passphrase even though Three-Factor Recovery (Recovery Key + Phrase + Password) is the current model.

### Scope

Documentation only. No behavioural changes, no refactors. Two surfaces:

- **User-displayed copy** — Settings page, Whitepaper, About the Network, Privacy, USER_GUIDE.
- **Codebase-level docs** — README, PROJECT_OVERVIEW, HYBRID_P2P_ARCHITECTURE (retire/replace), and stale cross-links.

### Changes by file

**User-facing (in-app)**

- `src/pages/Settings.tsx`
  - Replace the "Flux walkthrough" card title + status copy with "Imagination walkthrough" / "Swarm Space walkthrough" wording (matches the rest of the app).
  - Rewrite the "Keys" tab intro alert + "Recovery Passphrase" card to describe the current **Three-Factor Recovery** (Recovery Key `SWRM-XXXX`, Recovery Phrase, Account Password). Keep the existing `<AccountRecoveryPanel />` mount.
  - Add a new "Virtual Hub" entry to the bottom "Legal & Documentation" link list pointing to a short in-app help anchor on the User Guide / About-Network page describing build mode.
  - Encryption Status card: keep the algorithm line, add a row for "Three-Factor Recovery: Enabled".

- `src/pages/Whitepaper.tsx`
  - Remove paragraphs that describe the WebTorrent-DHT/Gun-mesh "integrated adapter" as a live primary layer.
  - Replace with the actual runtime: PeerJS WebRTC + Gun.js secondary signaling + WebTorrent file swarming, all driven by `swarmMesh.standalone.ts` + `P2PManager`.
  - Add a short "Virtual Hub" subsection: 3D project rooms, member-only Builder Bar, persisted per-project pieces synced through the existing project broadcast.

- `src/pages/AboutNetwork.tsx`
  - Update the friendly story to mention build mode ("members can lay walls, doors and roofs together inside their project hub").
  - Drop the "hybrid integrated adapter" name; describe the mesh in plain terms.

- `src/pages/Privacy.tsx`
  - Verify the encryption section still mentions ECDH P-256 + AES-256-GCM + PBKDF2 250k. Update the recovery paragraph to the three-factor wording.
  - No behavioural claims about removed encrypted-sync orchestrator.

**Codebase docs (markdown)**

- `README.md`
  - Strike the "Hybrid multi-transport" framing in the Transport Stack table; keep PeerJS / Gun.js / WebTorrent / Rendezvous bullets which are accurate.
  - Add a short "Virtual Hub & Builder Bar" capability bullet under Core Capabilities.
  - Update the docs index links: remove `HYBRID_P2P_ARCHITECTURE.md` and `MIGRATION_TO_HYBRID.md`; add a new `VIRTUAL_HUB.md`.

- `docs/PROJECT_OVERVIEW.md`
  - Add a "Virtual Hub" section beside "Media-as-Coin Engine".
  - Mark "Goal 4: Hybrid P2P refactor" (and similar) as **retired — superseded by `swarmMesh.standalone.ts`** if present.
  - Add a "Cleanup 2026-04" note: legacy hybrid mesh, swarmMeshAdapter, encryptedSync* removed.

- `docs/USER_GUIDE.md`
  - Add a new "🏗️ Virtual Hub" section: how to open a project's hub, walk mode controls (desktop W/A/S/D + pointer-lock; mobile drag + joystick), how to enter Build mode, prefab catalogue (Walls/Doors/Windows/Roof/Floor), Magnetic snap toggle, Rotate, Delete, Exit Build. Note that pieces persist on the project and sync to peers.
  - Update "How Connections Work" to describe PeerJS + Gun.js + WebTorrent without claiming a separate "WebTorrent DHT auto-discovery" layer.

- `docs/HYBRID_P2P_ARCHITECTURE.md` and `docs/HYBRID_SYSTEM_SUMMARY.md` and `docs/MIGRATION_TO_HYBRID.md`
  - Replace the body of each with a short notice: *"Retired 2026-04. The hybrid integrated adapter, contentBridge, connectionResilience, and encryptedSync orchestrator were never wired into the runtime and have been removed from the codebase. See `docs/CONTENT_SERVING_ARCHITECTURE.md` and `swarmMesh.standalone.ts` for the active design."* — keep the file as a tombstone so external links don't 404.

- New: `docs/VIRTUAL_HUB.md`
  - Architecture of `VirtualHub.tsx`, `HubBuildLayer.tsx`, `BuilderBar.tsx`, `useBuildController.ts`, `builderCatalog.ts`, `snapping.ts`.
  - Data model (`Project.hubBuild.pieces: HubPiece[]`).
  - Permissions (members-only edits, members-only `hubBuild` write path in `projects.ts`).
  - Sync (debounced `updateProject` → `broadcastProject` via standalone mesh).
  - Mobile parity notes (joystick, build-mode drag).

- `MemoryGarden.md`
  - Append caretaker reflection: tending the orchard's signposts so visitors find the living paths and pass quietly by the tombstones.

### Memory updates

- `mem://documentation/project-overview` — refresh to mention Virtual Hub and the retirement of hybrid/encrypted-sync layers.
- New `mem://features/virtual-hub-builder` — short rule: build mode is members-only; pieces persist via `Project.hubBuild`; sync uses standalone mesh `broadcastProject`; magnetic snap threshold 0.4 m; primitives only (no external assets).

### Out of scope

- No copy changes to commit messages, PR templates, or `.github/` workflows.
- No re-architecture of the docs folder structure beyond the retired-file notices.
- No changes to the Whitepaper's blockchain math/economics sections — those are still accurate.

### Acceptance

```text
1. Settings → Account: walkthrough card reads "Imagination walkthrough" (not "Flux").
2. Settings → Keys: intro mentions Recovery Key + Phrase + Password (three factors).
3. Settings → Legal & Documentation: a "Virtual Hub" entry routes to the relevant page section.
4. Whitepaper page no longer references the "integrated adapter / WebTorrent DHT discovery" stack as a live layer.
5. About the Network page mentions building inside project hubs.
6. README docs index has no broken links — HYBRID_* files exist but read as retirement notices.
7. USER_GUIDE has a "Virtual Hub" section covering walk + build modes for both desktop and mobile.
8. docs/VIRTUAL_HUB.md exists and is linked from README + PROJECT_OVERVIEW.
9. grep for "Flux walkthrough" returns zero hits in src/.
10. grep for "integrated adapter" / "encryptedSyncOrchestrator" in docs/ only matches the retirement notices.
```

