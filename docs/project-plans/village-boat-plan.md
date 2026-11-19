# A boat at the village island — plan

Status: **plan, awaiting go-ahead.** Captured 2026-11-18, revised 2026-11-20.
The readable version is the Claude Doc "Sailing between islands: the village
boat plan"; this file mirrors it for implementers.

Decided with bobdub: every player gets their own boat (the dock refills);
anyone can board any boat, only the owner takes the wheel; the boat obeys UQRC
physics (wind from the weather field, buoyancy, hull basins); players walk
around the deck, jump into the sea, swim and climb back aboard. Keyboard: A/D
wheel, W/S sail, Space jump. Touch: the joystick turns the wheel, press and hold
the mast to raise or lower the sail, a jump button beside the run bolt.

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

A plank jetty runs from `shoreN` to the mooring at deck height. It is
registered as a static deck surface (§3), so it is walkable.

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

### 3. Aboard: deck, rail, jump, swim (`src/lib/brain/deckSupport.ts`, new)

Aboard you are an ordinary walker; the deck is ground and the rail is a wall.

- **Deck surface.** A registry of moving deck footprints feeds
  `supportElevationAt` (`groundHeight.ts`): feet over a deck and at or above it
  are supported at deck height (sea level + freeboard + heave). Physics floor,
  remote feet and the camera guard all read that one function (AGENTS rule).
- **Riding along.** Bodies on a deck integrate in the deck frame, like
  `integrateCoRotatingBody` does for the spinning planet: idle walkers are
  carried, walking moves you about the deck, the walk cap applies deck-relative.
- **Rail and hull.** `pinSupportBasin` at the live hull/rail positions each
  tick (as the builder does for walls); walkers are pushed by −∇Π(u). Gaps: a
  gate each side, a ladder at the stern.
- **Jump.** New action (Space / touch button): radial impulse ≈ 4.5 m/s (≈ 1 m
  hop, clears the 0.6 m rail). The existing settle band passes radial velocity
  while intent is present. Works on land too.
- **Sea.** Off the deck the support is the water again: swim
  (`isSwimmingAt`). "Hold to climb aboard" beside the ladder or a gate.
- **Boarding.** "Hold to board" at the jetty end, or walk through a gate.
- **Capacity.** Each avatar adds `AVATAR_MASS`; the hull sinks with load and
  boarding is refused below 0.2 m freeboard ("Boat is full").
- **Helm.** Owner holds "Take the wheel" at the wheel: held there like a stool
  (`seating.ts`), the joystick becomes the wheel; "Hold to let go" returns it.
- **Ownership.** Dock boat: first to take its wheel owns it, dock refills; one
  boat per player, old boat recalled only if empty.

### 4. Sailing by UQRC physics (`src/lib/brain/sea/vessel.ts`, new)

New `BodyKind` `'vessel'`, integrated by the same step as walkers (a = F/m,
γ = γ₀√m, co-rotating frame).

| Force | Source |
| --- | --- |
| Buoyancy | `sampleMantleRadialAcceleration` with rest level = sea level − draft(load) |
| Wind | −Σ_μ 𝒟_μ u₂ (moisture-axis gradient) on the tangent plane, as `tickWeather` drifts clouds |
| Sail | wind × sail-up × polar curve (max beam/broad reach, 0 within ~40° of the wind) along heading |
| Keel / drag | anisotropic damping, lateral ≈ 8× forward |
| Rudder | heading rate = wheel × 28°/s × min(1, speed/3) |
| Hull | `pinSupportBasin` basins: boats, walkers and swimmers push apart by −∇Π(u) |
| Sea floor | hard floor: keel ground (`groundElevationAt`) shallower than draft → aground |
| Speed cap | tangential 10 m/s, like the walk cap |

Waves: heave/roll amplitude from `weatherCurvatureBoost` and raining clouds;
the deck surface heaves with them. Sail coupling is tuned in Phase 3 from
measured sea wind, target 6–9 m/s in a normal wind.

### 5. Controls (`src/components/brain/sea/ShipWheel.tsx`, new)

| Action | Touch | Mouse | Keyboard |
| --- | --- | --- | --- |
| Walk on deck | joystick | mouse joystick | WASD |
| Jump | jump button | jump button | Space |
| Turn the wheel (at helm) | joystick left/right | drag joystick | A / D |
| Release | eases to centre ≈ 0.5 s | same | same |
| Sail (owner) | hold the mast | hold the mast | W up, S down |

At the helm `ShipWheel` replaces `MobileJoystick` / `DesktopJoystick` in place;
`moveInput.right` → wheel −1..1 (1.5 turns), forward/back unused. The mast has
an enlarged r3f hit area driving the hold ring, usable from anywhere aboard.

### 6. Multiplayer

- Owner's presence: `vessel` = position, velocity, heading, yaw rate, wheel,
  sail, load, `getEarthPoseTime()`; on change, ≤ 4 Hz moving, 1 Hz at anchor.
- Anyone on a deck: `deck` = `{ boatId, x, z, yaw }` in deck coordinates, ≤ 4 Hz.
- Viewers add other owners' boats as mass-0 bodies, dead-reckoned on the shared
  clock with 0.5 s easing, and stamp the same hull basins and deck surface so
  their own avatar can stand on and bump into them.
- Deck lock (like `seatedTransform`): peers with `deck` render at that deck spot.
- Owner silent 3 s → boat drifts with sail down; owner leaves → boat removed,
  anyone aboard falls in and swims.
- Bump `BRAIN_PHYSICS_VERSION` (support changes).

## Phases and acceptance checks

**Phase 1: dock and boat.** Mooring ≥ 1.8 m deep, ≤ 60 m from a village beach,
≥ 250 m from the volcano, deterministic; headless shot of the boat at the
waterline and an avatar walking the jetty.

**Phase 2: aboard.** Empty boat settles at draft for 10 000 steps; load lowers
it and "Boat is full" at 0.2 m freeboard; idle walker stays put on a moving
deck for 600 steps; rail stops a walker; a jump at a gate lands in the sea
swimming; run: board, walk, jump, swim to ladder, climb aboard.

**Phase 3: sailing.** Boat wind equals cloud wind at the same point; no sail →
no push; head to wind → no push; zero speed → no turn; aground at draft depth;
measured wind and tuned coupling recorded in the PR; touch and desktop sail to
the nearest island and back.

**Phase 4: multiplayer.** `vessel` / `deck` round-trip; 1 s dead reckoning
within 0.5 m; two windows: B walks A's deck while A sails and both see each
other, B jumps and swims, dock refills.

**Phase 5: polish and docs.** Weather waves and wake, sail fill, `MiniMapHUD`
marker, `docs/features/boats.md`, `AGENTS.md` line, MemoryGarden entry.

## Open question

- In a calm the boat barely moves. Add oars (joystick forward at walking
  strength), or keep calms as part of the game?
