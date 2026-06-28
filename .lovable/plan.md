## Logic Chain (canonical)

`join group/project → enter project brain (always available) → go live → end live`

Each step is independent and reversible. Entering the project brain never requires a live room. Going live is an optional layer on top, gated by a per-project permission toggle.

---

## Part A — Always-On Project Brain + Public Auto-Join

### Behavior
- **Public projects**: any signed-in user can join with one click (auto-adds them as a member, then routes to the hub). No approval, no toast errors.
- **Private projects**: existing membership rules stand; non-members keep "Members only".
- Any member can **Enter Project Universe** at any time — no live room required.
- "Live" is an optional feature toggled from inside the hub (and still from the launcher dropdown), gated by the project's new `liveFeedPolicy`.

### Files to change
- `src/lib/projects.ts`: add `joinPublicProject(projectId, userId)` that no-ops if already a member and rejects on private projects.
- `src/components/virtualHub/ProjectUniverseButton.tsx`:
  - When `isMember === false` AND project is public → show **"Join & Enter"** instead of "Members only".
  - State A (no live room): primary **Enter Project Universe**; dropdown item renamed **"Start live feature"** and hidden if local user lacks live-start permission.
  - State B (live exists, not host): keep red **LIVE · Join** but show **Enter Project Universe** alongside it (no longer hidden).
- `src/components/brain/ProjectUniversePreSpawnModal.tsx`: `enter` mode never creates a `StreamRoom`; primary CTA reads "Enter Universe".

### Acceptance
- Public project, non-member: clicks "Join & Enter" → becomes member → lands in `/projects/:id/hub`.
- Member, no live room: clicks Enter → lands in hub, no live forced.
- Live room exists: both "Join LIVE" and "Enter Universe" visible.

---

## Part B — Project Setting: Live Feed Policy

### Schema
Extend `Project` (`src/types/index.ts` + `src/lib/projects.ts`):
```ts
liveFeedPolicy: 'owner-only' | 'members-allowed'  // default: 'owner-only'
```
Backfill missing field as `'owner-only'` on read (non-destructive, per Core memory).

### UI
- `src/pages/ProjectSettings.tsx` (owner-only section): add a radio group:
  - **Owner only** — only project owners can start a live feed.
  - **Members allowed** — any project member can start a live feed.
- Helper text explains "End live" is always available to the host of an active feed.

### Enforcement
- `src/lib/projects.ts`: export `canStartLive(project, userId)` returning a boolean.
- `ProjectUniverseButton.tsx`: hide "Start live feature" dropdown item when `canStartLive === false`.
- `BrainUniverseScene.tsx` HUD toggle (see Part C): hide the **Start live** button when `canStartLive === false`. Non-permitted members can still **Join** a live feed an owner started.

---

## Part C — In-Hub Live Toggle (Start / End)

### HUD chip (project variant only)
Add to `src/components/brain/BrainUniverseScene.tsx`:
- **Start live** (visible only when `canStartLive` and no active project room) → creates a project `StreamRoom` and binds voice.
- **End live** (visible only to the host while a room is active) → ends the room; non-hosts who joined see **Leave live** which only drops their voice/preview.
- `src/lib/brain/variants.ts`: add `capabilities.liveToggleable: boolean` (true for `projectVariant`, false elsewhere).

### Acceptance
- Owner enters hub, hits **Start live** → red ring + voice up; **End live** appears.
- Member with `members-allowed` policy sees the same. With `owner-only`, the Start button is absent but they can Join an existing live.
- End live properly terminates the room (host) or drops voice (non-host) without leaving the hub.

---

## Part D — Scope Walls / Placements to Each Universe

### Root cause
`universeKey` (`global`, `project-<id>`, `liveroom-<id>`) is already used for pieces / portals / field snapshot, but **not** for:
- `src/lib/world/worldPlacementsStore.ts` (wall billboards, decorations)
- `src/lib/world/wallDecorations.ts`
- `src/lib/world/landPlots.ts`
- `src/lib/world/p2pPlacementBridge.ts`
- Consumers: `UserPlacementsLayer.tsx`, `WallPostBillboard.tsx`, builder bar, plot overlay

So main-Brain walls bleed into project hubs.

### Changes
1. Add required `universeKey: string` to every persisted placement / decoration / plot record. Read APIs accept and filter by it; write APIs require it.
2. IndexedDB upgrade: non-destructive `onupgradeneeded` adds a `universeKey` index; legacy rows backfilled with `'global'` on first read.
3. P2P bridge stamps `universeKey` on every gossip frame; receivers ignore frames whose key ≠ local key.
4. Consumers receive `universeKey` from `BrainUniverseScene` (already destructured) and pass it through.
5. Builder bar: add `capabilities.starterAssetsOnly` (true for project variant, false for lobby). When true, expose only the starter palette (main bar tools/walls/floor/door); hide lobby-only landmark catalog entries.

### Acceptance
- Wall placed in `/brain` appears in `/brain` only.
- Wall placed in a project hub appears only to members of that hub.
- Builder bar in project hub shows starter assets only; lobby unchanged.
- Pre-migration walls remain in `/brain`, invisible in project hubs.

---

## Out of scope
- No backend schema (everything stays IndexedDB + mesh gossip).
- No WebRTC/voice-binding changes beyond wiring Start/End live to the existing room lifecycle.
- No changes to the lobby's existing live UX.

## Technical notes
- All forms remain `<div role="form">`; buttons `type="button"` (Core memory).
- IndexedDB upgrades non-destructive (Core memory).
- `BrainVariant.universeKey` is the single scope identifier — reuse everywhere instead of inventing a parallel projectId check.
- New capability flags are additive; existing variants and callers stay green.
