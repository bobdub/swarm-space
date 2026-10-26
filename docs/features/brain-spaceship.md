# Brain spaceship

The launchpad uses existing dry terrain about 95 metres from the shared bar.
The exterior is Kenney's Space Kit Craft Speeder A (CC0), normalized to an
eight-metre craft; the model is stored in the project's asset gateway.

Close-range held boarding costs 5 SWARM. If the wallet lacks 5 SWARM,
the fallback is **500 engagement/game credits**, using the existing 100:1
denomination. Admission uses the existing game/land fee ledger, not Creator
Vault settlement. A failed SWARM payment never also charges credits.

Boarding attaches the existing avatar body through an exclusive reversible
control lease. Ten real seconds count down before a sixteen-second automatic
ascent. The pad becomes available ten seconds after departure. Spaceflight
uses WASD or the existing joystick for thrust/yaw, drag to aim, pitch buttons,
and Space/the brake control to stop. The Home control returns to the pad.

Ships are ephemeral, pilot-owned room records over the existing P2P mesh,
sent at 5 Hz, with interpolated remote visuals and roster/timeout cleanup.
No Cloud service, persisted ship position, or new gravity implementation is
introduced. A page exit returns the local avatar safely; voice/chat room
membership still follows the existing cross-page Brain sync rules.

## Verification

Focused tests cover prices, cancellation, duplicate completion, countdown,
replacement, sender/room checks, malformed states, stale frames, pilot
departure, causal speed bounds, braking, and passenger-lease isolation.
The hosted GLB was fetched and validated (`glTF`). No live browser session
was opened because Mike is actively testing Brain. Cockpit framing, actual
two-device shared launch/flight, and simultaneous pad claims over delayed
networks remain unverified. Pad arbitration is best-effort client authority,
not competitive consensus or anti-cheat proof.