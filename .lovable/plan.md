

## Replace project Virtual Hubs with per-project Brain universes (members-only)

Each project gets its own private Brain universe. Same UQRC physics, same hollow-Earth street, same avatars and voice — but the room is scoped to the project, only project members can enter, and the creator owns the universe.

### 1. Membership gate at the door

**`src/components/virtualHub/VirtualHubModal.tsx`**
- Before showing avatar/devices, fetch the project and check `isProjectMember(project, currentUser.id)`.
- If not a member: replace the wizard body with a friendly "Members only" panel showing the project name, owner, and a `Request to join` button (links to `/projects/:id` where the existing join flow lives). No avatar selector, no Join button.
- If logged out: prompt sign-in via `useAuthGate("enter this project's universe")`.
- If member: existing avatar → device flow, then navigate to `/projects/:id/hub`.

**`src/pages/VirtualHub.tsx` (entry hard-gate)**
- On mount, after `getProject(projectId)`, also check membership. If not a member → `navigate('/projects/:id')` with a toast "Only members can enter this universe." This protects deep links.

### 2. Replace the legacy hub scene with the Brain scene

**Rewrite `src/pages/VirtualHub.tsx`** to mount the same world `BrainUniverse.tsx` builds:
- Hollow Earth + interior street spawn (`spawnOnStreet`, `INTERIOR_RADIUS`, `StreetMesh`).
- `PhysicsCameraRig`, `EarthPoseTicker`, `BodyLayer`, `RemoteAvatarLayer`.
- `DesktopLookOverlay` + `DesktopJoystick` + `MobileJoystick` + `TouchLookOverlay` + `BrainVideoGrid` HUD (mic/camera/leave).
- `StarField`, `GalaxyVisual`, `ElementsVisual`, `InfinityBindingTicker`, `PortalDefect`s, `BrainChatPanel`.
- **Drop**: legacy grass disc, `PostWall`, `BuildersBox`, `HubBuildLayer`, `BuilderBar`, `useBuildController`, `PointerLockControls`, the old `PlayerController`. The Brain universe replaces all of it.
- Project posts surface inside the universe via the existing portal/chat/visual layers (no flat post wall). If we want quick access, add a single non-blocking `Posts` HUD button that opens a side `PostPanel` listing project posts — but no in-world post billboards.

To avoid a 1100-line copy/paste, **extract the shared scene** from `BrainUniverse.tsx` into a new component:

**New: `src/components/brain/BrainUniverseScene.tsx`**
- Props: `{ roomId: string; universeKey: string; ownerName?: string; backHref: string; backLabel: string }`.
- Encapsulates the Canvas, all tickers, HUD, voice (`useBrainVoice(roomId)`), chat, video grid, and the camera/joystick/look overlays.
- `BrainUniverse.tsx` becomes a thin wrapper: `<BrainUniverseScene roomId={BRAIN_ROOM_ID} universeKey="global" backHref="/explore" backLabel="Leave Brain" />`.
- `VirtualHub.tsx` becomes a thin wrapper: `<BrainUniverseScene roomId={`brain-project-${projectId}`} universeKey={`project-${projectId}`} ownerName={project.owner} backHref={`/projects/${projectId}`} backLabel="Leave Universe" />`.

### 3. Per-project room isolation

- `useBrainVoice(enabled)` currently hard-codes `BRAIN_ROOM_ID = "brain-universe-shared"`. Refactor to accept a `roomId` argument; default stays `"brain-universe-shared"` for the global Brain. Project hubs pass `brain-project-${projectId}`.
- All presence broadcasts (`sendRoomPresence`) and chat (`sendRoomChatMessage`) already key on `roomId`, so members of project A never see members of project B even though they share the underlying mesh.
- `PersistentAudioLayer roomId={roomId}` already takes a room id — pass it through.

### 4. Per-project persistence buckets

Brain state is persisted via `loadPieces/savePieces`, `loadPortals/savePortals`, `loadBrainField/saveBrainField`. Today these write to a single global key. Add an optional `key: string` argument that prefixes the storage keys (`brain:${universeKey}:pieces`, etc.). The global Brain keeps the existing key for back-compat; project universes get isolated state.

### 5. Cleanup

- Mark `useBuildController.ts`, `HubBuildLayer.tsx`, `BuilderBar.tsx`, `BuildersBox.tsx`, `PostPanel.tsx` as no longer used by the active hub. Keep the files (no deletion) so memory references and tests aren't broken; just stop importing them from `VirtualHub.tsx`.
- `OpenVirtualHubButton` already labels itself "Open Virtual Hub" — keep label, but update the icon/copy to "Enter Project Universe" so users know it's the new Brain experience. Render the button only when `isProjectMember(project, currentUser.id)`; otherwise show a disabled "Members only · Request to join" variant linking to `/projects/:id`.

### Files touched

- `src/pages/VirtualHub.tsx` — rewrite as Brain scene wrapper + membership hard-gate.
- `src/pages/BrainUniverse.tsx` — slim down to a wrapper around the new shared scene component.
- `src/components/brain/BrainUniverseScene.tsx` — **new**, holds the shared Brain scene.
- `src/components/virtualHub/VirtualHubModal.tsx` — membership-aware entry wizard.
- `src/components/virtualHub/OpenVirtualHubButton.tsx` — member-only / request-to-join variants, updated label.
- `src/hooks/useBrainVoice.ts` — accept a `roomId` parameter (default unchanged).
- `src/lib/brain/brainPersistence.ts` — optional `key` namespace per universe.

### Acceptance

```text
1. Project members visiting /projects/:id/hub spawn inside the same hollow-Earth + street universe used by /brain. UQRC physics, drag-to-look, joystick, video grid, voice, and avatars all work identically.
2. Non-members hitting /projects/:id/hub directly are redirected to /projects/:id with a "Members only" toast.
3. The "Open Virtual Hub" button on /projects/:id is enabled for members and shows a disabled "Members only · Request to join" link for non-members.
4. The entry modal blocks non-members with a request-to-join screen instead of the avatar wizard.
5. Voice, chat, and presence in project A's universe are invisible to project B's universe and to the global /brain (unique roomId per project).
6. Brain pieces/portals/field placed inside project A's universe persist only for that project; global /brain state is untouched.
7. The legacy grass disc, post billboards, and builder bar no longer render in /projects/:id/hub.
8. Existing /brain behavior is unchanged (same roomId, same persistence keys).
```

