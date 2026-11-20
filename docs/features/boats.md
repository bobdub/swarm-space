# Boats

Status: **live** in the Brain world. The full design and build history is in
`docs/project-plans/village-boat-plan.md`; this page is how boats work now.

## For players

- **The jetty.** A wooden jetty runs out from the village island on the side
  away from the volcano, with a boat moored alongside.
- **Boarding.** On the jetty beside the boat, hold the ring ("Hold to
  board"), or walk in through a gate midships. From the water, swim to the
  stern ladder or a gate and hold "Hold to climb aboard".
- **A party of 10.** A boat takes ten people at most, crew included. Once
  she is full the ring says "Boat is full" and the gates shut to anyone
  coming aboard. People already aboard can still walk off or jump.
- **Your own boat.** Take the wheel or the oars of the boat at the jetty
  and she becomes yours. A fresh boat appears at the berth once yours is
  clear of it. You can't claim another while your old boat has people
  aboard.
- **Sailing** (helm, at the wheel):
  - A/D or the joystick turn the wheel.
  - W/S raise and lower the sail. On a touch screen, press and hold the mast.
  - She won't sail within 40° of the wind, goes best with the wind on the
    beam, and only answers the rudder once she is moving.
  - The sail bellies to leeward as it draws, and flaps when you point her
    into the wind.
- **Rowing** (oars, at the bench):
  - W/S row ahead or back; A/D turn.
  - The boat makes about 2 m/s.
  - Rowing costs 1 Food per 60 m. With no Food the oars stop.
  - Anyone aboard can row anyone's boat; the rower pays the Food.
- **Fishing** (a rod holder at either rail, forward of the mast):
  - Hold "Hold to take a rod", then press Cast (or F).
  - When the float dips ("Fish on!"), press Reel in within 3 s for
    +1 Food. Too early and you just wind in; too late and it gets away.
  - Bites come sooner in deep water (about every 12 s on average) than in
    the shallows (about 25 s). Over a school of fish they come in about 5 s,
    and the readout says "A school of fish is under the boat".
  - Land one and you see it swung up out of the water to the rod tip.
  - Nothing bites while the boat makes more than 1.5 m/s.
  - Fishing doesn't claim the boat, so you can fish from the jetty boat or
    from anyone's boat.
- **Sea life.** Schools of fish swim just under the surface all over the
  sea, with a few close to the jetty, and now and then one leaps clear.
  Sharks patrol deep water well out past the shelf, their fins cutting the
  surface. Sharks never hurt anyone: swim within about 12 m of one and you
  get a warning to head for a boat or the shore. Everyone sees the same fish
  and sharks in the same places.
- **Swimming.** Space or the round arrow button jumps about a metre: clear
  the rail and you're in the sea.
- **Weather.** The boat feels the same wind the clouds ride. The swell
  builds with the wind and more under rain, from gentle in a calm to about
  3.5× in a squall. It builds and lies down over several seconds, and the
  deck carries you with it.
- **Wake.** A moving boat leaves a widening, fading wake behind her stern.
- **Mini map.** The map shows the jetty and every boat as an arrow along her
  heading: gold for yours, tan for the jetty boat, white for other
  players' boats.
- **Together.** Everyone in the room sees each boat sail and turn on the
  same shared clock.
  - Only the owner steers; anyone can walk the deck, row or fish.
  - If an owner goes quiet, their boat drifts to a stop.
  - If an owner leaves, their boat goes with them and anyone aboard drops
    into the sea.

## For developers

| Piece | Where |
| --- | --- |
| Berth, jetty line, deck surfaces | `src/lib/brain/sea/dockSite.ts`, `deckSupport.ts` |
| Hull shape, deck walls, gates | `boatHull.ts`, `boatDeck.ts` (`confineInBoatFrame`, `boardingShut`) |
| Float, sea state, sailing, oars, hull contact | `vessel.ts` (`PARTY_SIZE`, `seaStateFor`, `stepMotion`, `sailFill`) |
| Every boat in this world, presence, dead reckoning | `fleet.ts` |
| Hold-ring actions | `villageBoat.ts` (`boatActionFor`) |
| Crew roles (helm, oars, rod) and Food | `crew.ts` |
| Fishing | `fishing.ts` |
| Fish schools and sharks | `seaLife.ts`, drawn by `components/brain/sea/SeaLifeLayer.tsx` |
| Wake | `wake.ts` |
| Drawing | `components/brain/sea/DockLayer.tsx`, `BoatMesh.tsx` |
| Controls | `components/brain/sea/BoatControls.tsx`, `ShipWheel.tsx` |
| Map | `components/brain/MiniMapHUD.tsx` |

Rules worth keeping:

- **One wind.** The boat's wind is `windAt` from `world/weather.ts`, the
  same field the clouds drift by. Never sample a separate wind.
- **Boats are not physics bodies.** They run on their own integrator
  (`stepMotion`) inside the fleet tick, which runs after each physics tick.
  Riders are carried kinematically: sideways with the hull, and up and down
  with the deck's swell, so the support settle never lags a rough sea.
- **Shared clock.** Swell, tilt and dead reckoning use `getEarthPoseTime()`,
  never local elapsed time.
- **Presence `boat`.** The wire format is `{v, d, r}`, validated by
  `decodeBoatPresence`. It is opaque to the signaling bridge and
  `useBrainVoice`, which only pass it along.
- **Sea life is never sent.** Every school and shark has a home picked from
  shared terrain (only where the whole loop is in deep enough water) and a
  path on the shared clock, so every peer computes the same creatures.
- **Local things stay local.** Food spends, fishing bites and catches, the
  wake and sail fill are worked out on each device and never sent.
- **Version bump.** Changing deck or boat physics in a way older peers would
  mis-render needs a `BRAIN_PHYSICS_VERSION` bump in `brainPersistence.ts`.
