# A boat at the village island — plan

Status: **plan, awaiting go-ahead.** Captured 2026-11-18.

Goal: a boat, built natively in code (no imported model), moored at the edge of
the shared village island. A player presses and holds to board it, sails across
the sea to other islands, and steers with the joystick, which becomes a ship's
wheel while aboard. Everyone in the room sees the boat sail and sees who is on it.

## What the code gives us today

| Need | Already in the repo |
| --- | --- |
| Island + sea | `src/lib/brain/surfaceProfile.ts` (`setIslandProvider`, `seaDepthFromContinents`: beach → 4 m shelf → 30 m floor). `earth.ts` registers the village island: centre = `getEarthLocalSiteFrame('swarm-shared-village').normal`, waterline radius `VILLAGE_ISLAND_RADIUS_M = 200`, outline wobbles ±18 %. |
| Height of ground / sea floor | `groundElevationAt(localN)` in `src/lib/brain/groundHeight.ts` (negative = sea floor depth). `supportElevationAt` / `isSwimmingAt` / `SWIM_FEET_DEPTH` (≈1.35 m) for swimmers. Sea level is `EARTH_RADIUS` (1700 m); the water sphere is drawn in `EarthBody.tsx`. |
| Planet spin | Everything lives in **Earth-local** coordinates and is mapped to world each frame with `earthLocalToWorld` / `worldDisplacementToEarthLocal` and `getEarthPose()`. Shared clock: `getEarthPoseTime()` (UTC epoch, identical on every peer). |
| Press and hold | `usePressAndHold` + `HoldProgressRing` (PR 303), used by bar seating (`PubGameLayer.tsx`) and `PubLeaveHold.tsx`. Proximity poll at 5 Hz: `useNearbyInteractable` → `findNearbyAnchor` in `src/lib/world/pubAnchors.ts`. |
| Pinning a body to a moving spot | `src/lib/pub/seating.ts`: `teleportBody` + `enforcePin` subscribed to the physics clock (`getBrainPhysics().subscribe`), so the pin runs after every integration step. |
| Remote players pinned to furniture | `seatLock.ts` → `seatedTransform(peerId)`; `RemoteAvatarLayer` / `SelfAvatarBody` in `BrainUniverseScene.tsx` render a seat-locked peer exactly there (`pinned`), ignoring the 1.5 s presence position. |
| Joystick | `MobileJoystick` and `DesktopJoystick` in `BrainUniverseScene.tsx` write the `moveInput` globals; `PhysicsCameraRig` adds WASD and calls `physics.setIntent`. |
| Presence sync | `useBrainVoice.broadcastSelfPosition` → `sendRoomPresence` (`webrtcSignalingBridge.standalone.ts`), every 1.5 s, 2-hop room relay. `RoomPresence` already has optional fields (`position`, `pv`). |
| Native meshes | `SurfaceBar.tsx` builds the bar from code; `BuilderBlockView` for collidable blocks. |

## Design

### 1. Where the boat moors (`src/lib/brain/sea/dockSite.ts`, new)

Deterministic, computed once from terrain every peer already shares:

1. Take the village frame (`getEarthLocalSiteFrame(SHARED_VILLAGE_ISLAND_ANCHOR)`)
   and the volcano centre (`getVolcanoOrgan(...).centerNormal`).
2. Choose the bearing pointing **away from the volcano** (so the dock is on the
   calm, open side), then try bearings fanning out ±15°, ±30°… if that one is
   blocked by land plots or a steep coast.
3. March outward along the bearing from 120 m in 1 m steps:
   - `shoreN` = last point with `groundElevationAt ≥ 0` (the beach).
   - `mooringN` = first point with `groundElevationAt ≤ −BOAT_MOOR_DEPTH` (1.8 m).
4. Mooring heading = the bearing (bow out to sea), so a player who boards and
   pushes the sail lever sails straight off the island.

A short plank jetty is drawn from `shoreN` to the mooring. It is visual only; the
shallows under it are wadeable (≤ 1.35 m), so walking out works with existing
physics. The board prompt has a 5 m radius, so it reaches from the jetty end and
from the water beside the boat.

### 2. The boat mesh (`src/components/brain/sea/BoatMesh.tsx`, new)

Built from Three.js primitives in code, about 7 m long, 2.6 m beam:

- **Hull:** a lofted `BufferGeometry` from ~8 cross-sections (a U shape that
  narrows to a pointed bow and a flat transom), wood-plank tint from
  `COMPOUND_TABLE` like the bar. Draft 0.6 m below the waterline.
- **Deck** plane at +0.5 m, a low gunwale rail, a **mast** (cylinder, 6 m),
  boom, and a **sail** (a subdivided plane whose vertices billow with speed),
  furled into a thin roll when the sail is down.
- **Ship's wheel** at the stern: a torus + 8 spokes, rotated by the live rudder,
  so other players see the captain turning it.
- **Bob and roll:** a visual sine from the shared clock + boat id
  (≈ ±0.08 m heave, ±2° roll), so every viewer sees the same motion. Physics
  never reads it.
- Optional faint wake (a fading ribbon behind the stern) in Phase 5.

The mesh is placed each frame from the boat's Earth-local state
(`earthLocalToWorld`), oriented with up = local normal, forward = heading.

### 3. Boat state and movement on the planet (`src/lib/brain/sea/vessel.ts`, new)

A boat is kinematic, not a physics body. Its state is Earth-local, so the
planet's spin and orbit are already handled by the pose transform:

```ts
interface VesselState {
  id: string;            // 'dock' for the moored boat, else `boat-<peerId>`
  captain: string | null;
  n: Vec3;               // Earth-local unit normal (position on the sphere)
  heading: Vec3;         // unit tangent at n (bow direction)
  speed: number;         // m/s along heading
  rudder: number;        // −1..1 from the wheel
  sail: 0 | 1 | 2;       // furled, half, full
  t: number;             // getEarthPoseTime() when sampled
}
```

Step (fixed dt, run in the physics subscription so it shares the sim clock):

- Target speed: 0 / 5 / 9 m/s by sail; ease toward it (≈ 2 s accel, slower decel).
- Turn rate = `rudder × 28°/s × min(1, speed / 3)` (no turning on the spot),
  rotate `heading` about `n`.
- Advance along the great circle: rotate `n` and `heading` together about the
  axis `n × heading` by `speed·dt / EARTH_RADIUS`. Re-orthonormalise.
- **Water check:** sample `groundElevationAt` at the bow point (3.5 m ahead).
  If it is above `−BOAT_DRAFT − 0.2` (−0.8 m), the boat **beaches**: speed → 0,
  a small bump, and only turning away or reversing (sail furled + drag back)
  frees it. The boat can never climb onto land.
- Ride height: the boat always sits on sea level (radius `EARTH_RADIUS`), never
  on the floor, so it floats however deep the water is.

At 9 m/s, the nearest neighbouring island (~425 m off the village shore) is
under a minute away; sailing right around the 1700 m planet takes ~20 minutes.

### 4. Boarding and leaving (`src/lib/brain/sea/boatStore.ts` + `BoatLayer.tsx`, new)

- `useNearbyBoat(selfId)`: same 5 Hz poll as `useNearbyInteractable`, measuring
  from the body to the boat's deck point; 5 m radius.
- When near and not aboard, show a **"Hold to board"** pill
  (`usePressAndHold`, 900 ms, `HoldProgressRing`) — the same look as the bar.
- On complete: `boardBoat(id, selfId)` sets `aboard`, teleports the body to the
  helm position with `teleportBody`, and subscribes a deck pin to the physics
  clock, like `seating.ts`. Unlike the stool pin, movement intent does **not**
  release it, because the joystick now drives the wheel. The pin also zeroes
  the walking intent each tick.
- The camera rig gets a boat mode: third-person boom further back and up
  (≈ 9 m back, 4 m up), and yaw eases to follow the heading unless the player is
  dragging to look.
- **Leaving:** a **"Hold to go ashore"** pill beside the wheel. It drops the
  player at the nearest point within 12 m ahead or to the sides where the
  ground is wadeable (`groundElevationAt ≥ −1.0`); if there is none (open sea)
  the pill reads **"Hold to dive in"** and drops them swimming next to the boat.
  Unpins, restores the walking joystick and normal camera.
- The boat stays where it was left, anchored (sail furled, speed 0), so the
  player can wade back and hold to board it again.

### 5. Joystick → ship's wheel (`src/components/brain/sea/ShipWheel.tsx`, new)

While aboard, `BrainUniverseScene` renders `ShipWheel` in place of
`MobileJoystick` / `DesktopJoystick`, in the same spot and size, and hides the
run bolt.

- **Wheel:** an SVG wheel (rim, 8 spokes with handles). Drag around it; the
  pointer's angle change around the centre turns the wheel. It turns up to
  1.5 turns each way (±540°), mapped to `rudder` −1..1. It stays where you leave
  it, as a real helm does, so you can hold a gentle turn without keeping a
  finger down. Double-tap (or the small centre mark) centres it.
- **Sail lever:** a small three-notch lever beside the wheel (Furl, Half, Full).
  Tap a notch or drag.
- **Desktop:** the same widgets with the mouse. Keyboard: A/D (or arrows) turn
  the wheel while held and ease it back to centre on release; W/S raise and
  lower the sail one notch per press.
- Pointer events work for mouse, pen and touch; `touchAction: none` and
  `data-no-look="true"` keep the look overlay from stealing the drag.

### 6. Multiplayer

- Add an optional `vessel?: VesselState` to `RoomPresence` and to
  `sendRoomPresence`'s payload (older peers ignore it).
- While aboard, broadcast immediately on board, leave, sail change and rudder
  change (throttled to 4 Hz), and every 1 s otherwise. Because `t` is on the
  shared Earth clock, each viewer **dead-reckons** the boat forward with the
  same step function from the last sample, then eases any correction over
  ~0.5 s. Boats glide rather than hop between 1 s updates.
- `RemoteBoatsLayer` draws one boat per peer that has a `vessel` (and keeps a
  peer's last anchored boat until they leave the room).
- **Vessel lock**, like the seat lock: if a peer's presence carries a `vessel`
  with them as captain, `RemoteAvatarLayer` renders them pinned at that boat's
  helm (`pinned`), ignoring the 1.5 s body position. They never flicker between
  the sea and the deck.
- The dock always shows a moored boat. When you sail off in it, it becomes your
  boat (`boat-<peerId>`) and a fresh boat appears at the dock for everyone else.
  If you hold to board the dock boat again while your own boat is elsewhere,
  your old boat is recalled. One boat per player.

## Phases and acceptance checks

**Phase 1: dock and boat (static).** `dockSite.ts`, `BoatMesh.tsx`, jetty.
- Unit tests: the mooring has `groundElevationAt ≤ −1.8 m`, sits within 60 m of a
  beach point on the village island, is at least 250 m from the volcano centre,
  and is the same on every run.
- Headless `/brain-dev` screenshot from the village: the boat floats at the
  waterline beside the jetty, bobbing, not on sand and not under water.

**Phase 2: board and leave.** `boatStore`, `useNearbyBoat`, hold pills, deck pin,
boat camera.
- Walk to the jetty end: "Hold to board" appears; holding fills the ring and
  puts you on the deck; letting go early drains it.
- Joystick input on board does not walk you off the deck. "Hold to go ashore"
  puts you on wadeable ground; the boat stays put.
- Unit test: pin keeps the body on the deck for 600 physics ticks with joystick
  input applied.

**Phase 3: sailing.** `vessel.ts` step, `ShipWheel`, sail lever, keyboard,
beaching.
- Unit tests: after 10 000 steps `|n| = 1`, `heading ⟂ n`; a boat sailed at the
  island stops before its bow ground rises above −0.8 m; full rudder at full
  sail turns a circle of ≈ 18 m radius; zero speed does not turn.
- Manual or headless run: sail from the dock to the nearest other island in
  under 90 s, beach, go ashore, walk on that island, re-board, sail home.
- Touch (mobile emulation) and desktop both steer; the run bolt is hidden.

**Phase 4: multiplayer.** `vessel` in presence, dead reckoning, remote boats,
vessel lock, dock refill.
- Unit tests: presence round-trips `vessel`; dead reckoning from a 1 s old
  sample matches the captain's own step within 0.5 m.
- Two browser contexts in one room: B sees A board, sees A's boat leave the dock
  with A at the wheel, sees a new dock boat appear, sees A's wheel turn and sail
  billow, and sees A step off on the far island.

**Phase 5: polish and docs.** Wake ribbon, sail billow by speed, boat marker on
`MiniMapHUD`, gentle water sounds if the audio layer allows, a
`docs/features/boats.md` page, an `AGENTS.md` line, and a MemoryGarden entry.

## Things deliberately left for later

- Passengers (other players boarding your boat), anchoring by choice, wind
  direction affecting speed, and collisions between two boats (in v1 boats pass
  through each other).
- Persisting boats across a refresh. A refresh is a disconnect in the Brain, so
  your boat goes with you, and you spawn at the village as now.

## Decision needed before building

**Who gets a boat?** The plan above gives each player their own boat, with the
dock always refilled. The alternative is one shared boat, claimed by whoever
boards it first (a lock like the bar seats), which means others have to wait or
swim. Personal boats are recommended: no waiting, and nobody can strand someone
else on another island by sailing off with the only boat.
