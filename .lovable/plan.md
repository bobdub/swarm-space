

## Virtual Hub — 3D project environment (avatar + builders box)

A new "Virtual Hub" feature scoped to a single Project page. Click "Open Virtual Hub" → pick avatar → test mic/speakers → enter a 3D space whose round wall is built from the project's posts, with a central placeholder Builders Box. Designed so avatars and builder tools can be added later without touching the entry flow.

### New dependencies (exact versions, per workspace rules)

- `three@0.160.0`
- `@react-three/fiber@^8.18`
- `@react-three/drei@^9.122.0`

### New files

**1. `src/lib/virtualHub/avatars.ts` — dynamic avatar registry**

```ts
export interface AvatarDefinition {
  id: string;                       // 'rabbit'
  name: string;                     // 'Rabbit'
  description: string;              // short flavor text
  unlocked: boolean;                // future-gating
  render: (props: AvatarRenderProps) => JSX.Element; // R3F mesh
  preview: (props: AvatarRenderProps) => JSX.Element; // small preview mesh
}
export const AVATAR_REGISTRY: AvatarDefinition[] = [rabbitAvatar];
export const DEFAULT_AVATAR_ID = 'rabbit';
```
Adding a new avatar later = push another entry. The selector reads from the registry only.

**2. `src/lib/virtualHub/avatars/rabbit.tsx`** — starter rabbit built from primitive `<mesh>` geometries (sphere body, sphere head, two elongated boxes for ears, small tail). No external assets.

**3. `src/components/virtualHub/AvatarSelector.tsx`** — grid of `AvatarDefinition`s rendered with a tiny `<Canvas>` preview each. Locked avatars show a "Coming soon" badge. Selecting one + "Continue" advances the wizard.

**4. `src/components/virtualHub/DeviceCheckStep.tsx`** — mic + speaker test, reusing the patterns already in `src/components/streaming/PreJoinModal.tsx`:
- Request `getUserMedia({ audio: true })`, show live mic level meter (AudioContext + analyser).
- Speaker test: play a short tone via `OscillatorNode`, "Did you hear it? ✓ / ✗".
- Device selectors (mic input, audio output via `setSinkId` when supported).
- "Join Virtual Hub" button enables only after mic permission granted.

**5. `src/components/virtualHub/VirtualHubModal.tsx`** — three-step wizard inside one `<Dialog>`: `select-avatar` → `device-check` → handoff. Persists the chosen avatar id + device prefs to `localStorage` (`swarm-virtual-hub-prefs`).

**6. `src/components/virtualHub/OpenVirtualHubButton.tsx`** — button styled to sit beside `StartLiveRoomButton`. Opens `VirtualHubModal`. On completion, navigates to `/projects/:projectId/hub`.

**7. `src/pages/VirtualHub.tsx`** — full-screen 3D scene route.
- Loads project via `getProject(projectId)` and its posts (same filter as `ProjectDetail`).
- Renders a `<Canvas>` with:
  - Sky/ambient + directional lighting, ground disc.
  - **Round Post Wall**: arranges N posts evenly around a circle (radius scales with count, ~3 m base + 0.4 m per post, capped). Each post = a `<PostPanel>` billboard with the author name + truncated content rendered via drei `<Html>` so it stays readable. Wall faces inward.
  - **Builders Box** (center): a labelled rectangular plinth with placeholder geometry — the dynamic add-on slot. Wrapped in `<BuildersBox>` component that accepts a `tools` prop (empty array for now) so future tools just register themselves.
  - User avatar: spawns at the center facing outward, controlled with WASD + mouse-look via drei `<PointerLockControls>`. Avatar mesh comes from the chosen `AvatarDefinition`.
- Top-left HUD: project name, "Leave Hub" button (returns to `/projects/:projectId`), small mic-mute toggle (live mic state via WebRTC manager — actual peer audio wiring is out of scope for this pass; the toggle just controls the local track placeholder so the audio plumbing slot exists).

**8. `src/components/virtualHub/BuildersBox.tsx`** — central R3F group exposing `tools: BuilderTool[]` so future tools can be slotted without editing the scene.

**9. `src/components/virtualHub/PostPanel.tsx`** — single billboard panel used by the round wall.

### Edits

- `src/pages/ProjectDetail.tsx` — add `<OpenVirtualHubButton projectId={project.id} projectName={project.name} />` immediately to the **left** of the existing `<StartLiveRoomButton>` (line ~382 area, inside the same flex row). Member-gated identically to Start Live Room.
- `src/App.tsx` — register lazy route `/projects/:projectId/hub` → `VirtualHub` (lazy-loaded so three.js doesn't bloat the main bundle, per the project's lazy-load performance rule).
- `package.json` — add the three dependencies above.
- `MemoryGarden.md` — caretaker reflection on opening a small round meadow inside each project where a paper rabbit can wander.

### Architecture notes

- **Dynamic avatars**: only `AVATAR_REGISTRY` knows what exists. Selector, scene, and prefs all key off `id`. Future avatars (fox, owl, etc.) just append.
- **Dynamic builders**: `BuildersBox` is a registry-driven group; today's tool list is `[]`. Future tools register a `{ id, render }` and appear inside the box.
- **Round post wall** is regenerated whenever `project.feedIndex` changes (post added/removed) so the world breathes with the project.
- **Performance**: route is lazy, three.js + R3F are only fetched when the user actually opens the hub. The 3D scene uses primitives only — no model files, no network fetches beyond what `ProjectDetail` already loads.
- **WebRTC**: this pass wires the mic permission + device selection only. Voice between hub avatars will reuse the existing `useWebRTC` / streaming layer in a follow-up — the mute toggle and audio context plumbing slots are stubbed in so that work drops in cleanly.
- **Stability rules respected**: no `<form>` elements, explicit `type="button"`, lazy-loaded route, avatar registry uses pure functions.

### What the user sees

```text
Project page → Feed tab → header buttons:
  [ Open Virtual Hub ]  [ Start Live Room ]  [ Create Post ]
                ↑ new

Click Open Virtual Hub → modal:
  Step 1  Choose your avatar
          ┌─────────┐  ┌─────────┐  ┌─────────┐
          │ 🐇      │  │ 🔒      │  │ 🔒      │
          │ Rabbit  │  │ Soon    │  │ Soon    │
          └─────────┘  └─────────┘  └─────────┘
          [ Continue ]

  Step 2  Test your audio
          Mic ▮▮▮▮▯▯▯▯  [ Test mic ]
          Speakers       [ Play test tone ]  Heard it? ✓ / ✗
          [ Mic ▼ ] [ Speaker ▼ ]
          [ Join Virtual Hub ]   ← enabled after permission

→ Navigates to /projects/:id/hub:
          Round wall of project posts surrounds you.
          A small Builders Box sits in the center.
          WASD + mouse-look. [ Leave Hub ] top-left.
```

