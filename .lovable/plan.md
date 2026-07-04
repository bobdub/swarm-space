# Investigation: Site slowness on `/brain`

## What I found

The preview is currently on `/brain`, and the console shows a nonstop flood of
`[Brain.spawn] remote` logs — many per second, even when nothing visible is
happening. That log storm (plus the work it wraps) is the main reason typing,
scrolling and interaction feel sluggish.

### Root cause

`src/components/brain/BrainUniverseScene.tsx` (line ~1238) runs an effect
whose dependency list ends with `voicePeers`:

```ts
useEffect(() => {
  ...
  for (const p of voicePeers) { console.log('[Brain.spawn] remote', ...); physics.addBody/update... }
}, [guestCandidateId, physics, ready, selfId, voicePeers]);
```

`voicePeers` comes from `useBrainVoice` (`src/hooks/useBrainVoice.ts` line 177),
which builds it with `.map(...)` on every render — a **brand-new array
reference every time the hook re-renders**. Since `BrainUniverseScene` is
already re-rendering constantly (physics tick, HUD counters, presence
updates), the effect fires on every render and:

1. Iterates all remote peers
2. Logs `[Brain.spawn] remote` per peer (visible in console)
3. Calls `physics.addBody` / mutates existing bodies

This creates a self-sustaining feedback loop: physics mutation → state
change → re-render → effect re-runs → more physics mutation. The "radius"
value in each log drifts slightly, confirming the effect is being re-invoked
per frame rather than only when the peer set actually changes.

Secondary contributors (smaller, but piling on):
- `useBrainVoice.participants` is not memoized, so every consumer that
  depends on it also re-renders each tick.
- Verbose per-tick logging elsewhere in the same loop:
  `[Instinct] Layer degraded`, `[Neural:Predict] flow:sync`,
  `[GunAdapter] Broadcasting on channel presence`,
  `[SwarmMesh][Mining] CONSENSUS REACHED`.
  Individually cheap; collectively they're thousands of `console.log`
  calls/minute, which the DevTools console + rrweb capture serializes on
  the main thread and stalls input.

## Plan to fix

Scope: reduce main-thread load from the `/brain` render loop. No behavior
changes to physics, voice, or gossip.

1. **Stabilize `voicePeers` in `useBrainVoice`**
   - Wrap the merged `participants` array in `useMemo` keyed on
     `rawParticipants` + `presenceById` so its identity only changes when
     peer data actually changes.

2. **Guard the remote-peer effect in `BrainUniverseScene`**
   - Keep the effect but derive a stable signature (e.g. `peerId|pos|avatarId`
     joined string) and short-circuit when the signature matches the last run.
   - Remove the per-peer `console.log('[Brain.spawn] remote', …)` (or gate it
     behind a `?debug=brain` query flag). The information is redundant with
     the physics body state and is the dominant console spammer.

3. **Silence per-tick logs on hot paths (log-only, no logic change)**
   - `src/lib/p2p/transports/gunAdapter.ts`: drop or throttle
     `Broadcasting on channel presence` to at most once / 10 s.
   - `src/lib/p2p/neuralStateEngine.ts`: gate `[Neural:Predict] flow:sync`
     behind a debug flag; only log when correction magnitude exceeds a
     threshold.
   - `src/lib/p2p/instinctHierarchy.ts`: log `Layer degraded` on state
     transitions only, not while the state persists.
   - `src/lib/p2p/swarmMesh.standalone.ts`: keep `CONSENSUS REACHED` (rare
     event) but ensure it isn't inside a tick loop.

4. **Verification**
   - Reload `/brain`, observe console — `[Brain.spawn] remote` should appear
     only when peers join/leave/move, not per frame.
   - Type into the chat input and confirm no perceptible lag.
   - Run `bun run build` and existing brain tests to make sure nothing
     regressed.

### Out of scope
- Rewriting the physics tick or peer-body ownership model.
- Changing gossip cadence or WebRTC signaling.
- Any visual / UX changes.
