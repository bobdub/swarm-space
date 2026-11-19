# A boat at the village island — plan

Status: **plan, awaiting go-ahead.** Captured 2026-11-18, revised 2026-11-19.

Decided with bobdub: every player gets their own boat (the dock refills), other
players can board your boat as crew (up to 4 aboard, only the owner steers),
A/D turn the wheel and W/S raise/lower the sail on a keyboard, and on touch the
joystick turns the wheel while pressing and holding the mast raises or lowers
the sail. The sail has two states, up and down.

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
   raises the sail sails straight off the island.

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
- **Ship's wheel** at the stern: a torus + 8 spokes, rotated by the live wheel value,
  so other players see the owner turning it.
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
  owner: string | null;  // null for the dock boat
  n: Vec3;               // Earth-local unit normal (position on the sphere)
  heading: Vec3;         // unit tangent at n (bow direction)
  speed: number;         // m/s along heading
  wheel: number;         // −1..1 from the wheel
  sail: boolean;         // up or down
  t: number;             // getEarthPoseTime() when sampled
}
```

Step (fixed dt, run in the physics subscription so it shares the sim clock):

- Target speed: 9 m/s with the sail up (≈ 2 s to reach it), 0 with it down (≈ 4 s to stop).
- Turn rate = `wheel × 28°/s × min(1, speed / 3)` (no turning on the spot),
  rotate `heading` about `n`.
- Advance along the great circle: rotate `n` and `heading` together about the
  axis `n × heading` by `speed·dt / EARTH_RADIUS`. Re-orthonormalise.
- **Water check:** sample `groundElevationAt` at the bow point (3.5 m ahead).
  If it is above `−BOAT_DRAFT − 0.2` (−0.8 m), the boat **beaches**: speed → 0,
  a small bump. With the sail down, turning the wheel backs it off at 1 m/s. The boat can never climb onto land.
- Ride height: the boat always sits on sea level (radius `EARTH_RADIUS`), never
  on the floor, so it floats however deep the water is.

At 9 m/s, the nearest neighbouring island (~425 m off the village shore) is
under a minute away; sailing right around the 1700 m planet takes ~20 minutes.

### 4. Boarding, crew and leaving (`src/lib/brain/sea/boatStore.ts` + `BoatLayer.tsx`, new)

- `useNearbyBoat(selfId)`: same 5 Hz poll as `useNearbyInteractable`, 5 m radius.
- Prompts (all `usePressAndHold` + `HoldProgressRing`, 900 ms):
  - empty dock boat or your own boat → **Hold to board** (you take the helm);
  - someone else's boat with room → **Hold to join crew** (first free spot: bow, port, starboard);
  - a boat with 4 aboard → **Boat full** (disabled);
  - aboard, wadeable ground (`groundElevationAt ≥ −1.0`) within 12 m → **Hold to go ashore**;
  - aboard, open sea → **Hold to dive in** (dropped swimming beside the boat).
- Ownership: the dock always holds one empty boat. The first to board it owns it
  (`boat-<peerId>`) and a fresh dock boat appears. One boat per player; boarding
  the dock boat again recalls your old boat only if nobody is aboard it. When the
  owner goes ashore the boat anchors where it is (sail down) and stays visible.
- Deck pin: `teleportBody` onto the deck spot, then a pin subscribed to the
  physics clock (as in `seating.ts`). Unlike the stool pin, joystick input does
  not release it; it zeroes walking intent every tick.
- Crew spots are ordered by `boardedAt` then peer id (the `seatLock.ts` rule);
  a fifth simultaneous boarder is put in the water.
- Crew do not steer: no joystick, look-drag still works, only "Hold to go ashore".
- Camera: third-person boom ≈ 9 m back and 4 m up; yaw eases toward the heading
  unless the player is dragging to look.

### 5. Controls (`src/components/brain/sea/ShipWheel.tsx`, new)

While you own the boat and are aboard, `BrainUniverseScene` renders `ShipWheel`
in place of `MobileJoystick` / `DesktopJoystick` (same corner, same size) and
hides the run bolt.

| Action | Touch | Mouse | Keyboard |
| --- | --- | --- | --- |
| Turn the wheel | push the joystick left/right | drag the joystick left/right | hold A / D (or arrows) |
| Release | wheel eases back to centre (≈ 0.5 s) | same | same |
| Raise / lower sail | press and hold the mast | press and hold the mast | W raises, S lowers |

- The joystick knob is drawn as a ship's wheel. Its left/right axis
  (`moveInput.right`) maps to wheel −1..1 (full = 1.5 turns, full rudder) and the
  picture spins to match. Forward/back does nothing at sea.
- The mast has an enlarged hit area with r3f pointer events driving the same
  hold timer and ring, labelled "Raise sail" / "Lower sail". Owner only.
- `PhysicsCameraRig` routes A/D to the wheel and W/S as single presses to the
  sail while at the helm, and sends no walking intent.

### 6. Multiplayer

- `RoomPresence` / `sendRoomPresence` gain two optional fields (older peers ignore them):
  - owner: `vessel` = `{ id, n, heading, speed, wheel, sail, t }`, sent at once on
    board/leave/sail change, up to 4 Hz while the wheel moves, else 1 Hz;
  - crew: `aboard` = `{ boatId, boardedAt }`, sent at once on board/leave and with
    every presence tick.
- `t` is `getEarthPoseTime()`, so every viewer dead-reckons the boat with the same
  step function from the owner's last sample and eases corrections over ~0.5 s.
- Crew list per boat = owner + every peer whose `aboard` names it, sorted by
  `boardedAt`; everyone derives the same spots.
- Vessel lock (like `seatedTransform`): `RemoteAvatarLayer` and `SelfAvatarBody`
  render anyone on a boat pinned to their deck spot, ignoring the 1.5 s body position.
- `BoatLayer` draws the dock boat plus one boat per owner broadcasting `vessel`;
  anchored boats stay until the owner leaves the room.
- No owner update for 3 s → viewers freeze the boat; crew can still go ashore or
  dive in. Owner leaves the room → boat removed, crew dropped in the water.

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

**Phase 3: sailing.** `vessel.ts` step, `ShipWheel`, mast hold, keyboard,
beaching.
- Unit tests: after 10 000 steps `|n| = 1`, `heading ⟂ n`; a boat sailed at the
  island stops before its bow ground rises above −0.8 m; full wheel at full
  speed turns a circle of ≈ 18 m radius; zero speed does not turn.
- Manual or headless run: sail from the dock to the nearest other island in
  under 90 s, beach, go ashore, walk on that island, re-board, sail home.
- Touch (mobile emulation): the joystick turns the wheel and holding the mast
  raises/lowers the sail. Desktop: A/D, W/S, mouse joystick and mast hold all
  work. The run bolt is hidden.

**Phase 4: multiplayer.** `vessel` in presence, dead reckoning, remote boats,
vessel lock, dock refill.
- Unit tests: presence round-trips `vessel`; dead reckoning from a 1 s old
  sample matches the owner's own step within 0.5 m.
- Unit test: crew order gives each person their own spot; a fifth boarder is
  put in the water.
- Two browser contexts in one room: B sees A board, sees A's boat leave the dock
  with A at the wheel, sees a new dock boat appear, sees A's wheel turn and sail
  fill, boards A's boat as crew, rides to the far island, and both go ashore.

**Phase 5: polish and docs.** Wake ribbon, sail billow by speed, boat marker on
`MiniMapHUD`, gentle water sounds if the audio layer allows, a
`docs/features/boats.md` page, an `AGENTS.md` line, and a MemoryGarden entry.

## Things deliberately left for later

- Anchoring by choice, wind direction affecting speed, crew walking about the
  deck, handing the wheel to crew, and collisions between two boats (in v1 boats
  pass through each other).
- Persisting boats across a refresh. A refresh is a disconnect in the Brain, so
  your boat goes with you, and you spawn at the village as now.

## Open questions

- Should crew be allowed to dive in at sea, or only go ashore in shallows? The plan allows both.
- Is 4 aboard the right boat size?
