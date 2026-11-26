# Boats

Status: **live** in the Brain world. The full design and build history is in
`docs/project-plans/village-boat-plan.md`; this page is how boats work now.

## For players

- **The jetty.** A wooden jetty runs out from the village island on the side
  away from the volcano, with a boat moored alongside.
- **The boat.** 11 m long and 3.8 m in the beam. Bow to stern: two rod
  holders, the mast, a gate each side midships, three rowing benches, the
  wheel and the stern ladder. An aisle runs down the middle for walking.
- **Boarding.** On the jetty beside the boat, hold the ring ("Hold to
  board"), or walk in through a gate midships. From the water, swim to the
  stern ladder or a gate and hold "Hold to climb aboard".
- **A party of 12.** A boat takes twelve people at most, crew included,
  with room for all of them to move about. Once she is full the ring says
  "Boat is full" and the gates shut to anyone coming aboard.
- **Staying aboard.** The rail is waist high and holds you even mid-jump.
  A gate only opens onto something you can step onto: the jetty, another
  boat's deck alongside, or a beach. Out at sea both gates stay shut. To get
  into the sea on purpose, go down the stern ladder.
- **Your own boat.** Take the wheel or the oars of the boat at the jetty
  and she becomes yours. A fresh boat appears at the berth once yours is
  clear of it. You can't claim another while your old boat has people
  aboard.
- **Sailing** (helm, at the wheel):
  - A/D or the joystick turn the wheel.
  - Hold Raise sail or Lower sail (on screen), or W/S, or press and hold the mast.
  - She won't sail within 40° of the wind, goes best with the wind on the
    beam, and only answers the rudder once she is moving.
  - The sail bellies to leeward as it draws, and flaps when you point her
    into the wind.
- **Letting go.** While you hold the wheel, the oars or a rod, the "Hold to
  let go" ring sits at the lower right (above the joystick on a phone), out
  of your view.
- **Running aground.** If your boat runs onto land, the readout says
  "Aground!" and a Push off button appears at the wheel and the oars (R on a
  keyboard). It shoves her toward the deepest water close by and lets the
  sail down so the wind can't drive her straight back on; then turn her and
  raise the sail. At the oars you can also row astern, and the oars can turn
  her where she lies.
- **Rowing** (oars, at a bench):
  - Three benches seat a rower each side, so six can row at once. Hold
    "Take oars" by any free oar place.
  - W/S row ahead or back; A/D turn.
  - One rower makes about 2 m/s; every extra stroke adds to it.
  - On a calm day (sea state up to 1.6, a calm or an ordinary breeze) all
    six strokes count. As the swell builds, the oars catch the waves out of
    time and fewer count, down to one rower from sea state 2.6 on. The
    readout says "Rough sea: n oars pull" when not every bench can.
  - Rowing costs 1 Food per 60 m. With no Food the oars won't pull, and the readout says so.
  - The oars swing out when you take them and sweep with each stroke.
  - Anyone aboard can row anyone's boat; the rower pays the Food.
- **Fishing** (a rod holder at either rail, forward of the mast):
  - Hold "Hold to take a rod", then press Cast (or F).
  - When the float dips ("Fish on!"), press Hook it! (or F) within 5 s.
    Too early and you just wind in; too late and it gets away.
  - Then the fish fights. A marker sweeps along a bar: strike (Reel!, F,
    or a click on the bar) while it is inside the gold zone. Three good
    strikes land it for +1 Food; each one narrows the zone and speeds the
    marker up. Two bad strikes, or 6 s without one, count as misses, and
    two misses lose the fish.
  - Bites come sooner in deep water (about every 12 s on average) than in
    the shallows (about 25 s). Over a school of fish they come in about 5 s,
    and the readout says "A school of fish is under the boat".
  - Land one and you see it swung up out of the water to the rod tip.
  - Nothing bites while the boat makes more than 1.5 m/s.
  - Fishing doesn't claim the boat, so you can fish from the jetty boat or
    from anyone's boat.
  - Sharks: in water 15 m deep or more with a shark within 120 m, about one
    bite in ten is the shark (the readout says when one is about). It
    fights harder: five good strikes, with a smaller zone (20% down to 9%)
    and a quicker marker. Landing it gives +5 Food, and that shark is gone
    from the sea for everyone for ten minutes.
- **Sea life.** Schools of fish swim just under the surface all over the
  sea, with a few close to the jetty, and now and then one leaps clear.
  Sharks patrol deep water well out past the shelf, their fins cutting the
  surface. Everyone sees the same fish and sharks in the same places.
- **Sharks and swimmers.** Swim within about 12 m of a shark and you get a
  warning. Within 3 m it bites once: you lose 2 Food (whatever you have, up
  to 2) and get shoved 2 m away, and that shark dives away for 30 s. Swing
  the Stone Knife with a shark's body within 1.5 m and it dives away for a
  minute.
- **Swimming.** Space or the round arrow button jumps about a metre. On the
  jetty or from a gate that opens onto it, run and jump and you're in the
  sea; from a boat at sea, take the stern ladder.
- **Weather.** The boat feels the same wind the clouds ride. The swell
  builds with the wind and more under rain, from gentle in a calm to about
  3.5× in a squall. It builds and lies down over several seconds, and the
  deck carries you with it.
- **Tides.** The sea rises and falls with the Moon and Sun: two high waters
  each in-game day (about every 1.7 real hours), a few tens of centimetres,
  stronger or weaker as the Sun's pull lines up with the Moon's or not.
  Boats, swimmers and the drawn water all ride the same tide.
- **Wake.** A moving boat leaves a widening, fading wake behind her stern,
  and rings of ripples spread from her bow. Each ring grows at a third of
  the speed she had when she left it, so together they fan into the Kelvin
  V (about 19.5° either side of her track); crests run outward through each
  ring and fade with distance and age. Faster boats make longer ripples.
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
| Hull shape, deck walls, gates | `boatHull.ts`, `boatDeck.ts` (`confineInBoatFrame`, `boardingShut`, `gateOpen`) |
| Where the mast, benches, oar places and helm stand | `boatLayout.ts` |
| Float, sea state, sailing, oars, hull contact | `vessel.ts` (`PARTY_SIZE`, `rowersAllowed`, `seaStateFor`, `stepMotion`, `sailFill`) |
| Every boat in this world, presence, dead reckoning | `fleet.ts` |
| Hold-ring actions | `villageBoat.ts` (`boatActionFor`) |
| Crew roles (helm, oars, rod) and Food | `crew.ts` |
| Fishing | `fishing.ts` |
| Fish schools and sharks | `seaLife.ts`, drawn by `components/brain/sea/SeaLifeLayer.tsx` |
| Shark bites, the knife, hooking a shark | `sharks.ts` (knife hook-in: `world/toolActions.ts`) |
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
- **Shared clock.** Swell, tilt, tide and dead reckoning use
  `getEarthPoseTime()`, never local elapsed time.
- **One sea surface.** `sea/seaSurface.ts` owns the tide (`tideAt`) and the
  visual swell GLSL. The water shader, `supportElevationAt` (swimmers) and
  `Vessel.waterlineAt` (hulls and decks) all read it, so never offset the
  water anywhere else. Aground checks still use mean sea level.
- **Presence `boat`.** The wire format is `{v, d, r}`, validated by
  `decodeBoatPresence`. It is opaque to the signaling bridge and
  `useBrainVoice`, which only pass it along.
- **Sea life is never sent.** Every school and shark has a home picked from
  shared terrain (only where the whole loop is in deep enough water) and a
  path on the shared clock, so every peer computes the same creatures.
  The one shared fact is a caught shark: a `shark-caught` nature event
  (`world/natureEventsStore.ts`) gossiped like a felled tree. A shark
  backing off after a bite or fleeing a knife is local to the player it
  met; other peers keep seeing it on its path.
- **Local things stay local.** Food spends, fishing bites and catches, the
  wake and sail fill are worked out on each device and never sent.
- **Version bump.** Changing deck or boat physics in a way older peers would
  mis-render needs a `BRAIN_PHYSICS_VERSION` bump in `brainPersistence.ts`.
