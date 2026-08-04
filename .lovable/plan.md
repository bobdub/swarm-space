# Sync bar lights across everyone in the Brain

Right now the bar light switch is a purely local toggle: flipping it changes only your own screen. Another user standing in the same bar sees no change. This plan makes the switch a shared state broadcast over the mesh, so a flip is visible to everyone within a moment.

## What changes for users

- Anyone flips Ceiling / Sconces / Sign -> all users currently in the Brain lobby see the lights change almost instantly.
- A user who arrives later gets the current light state from a peer instead of defaulting to "on".
- Last flip wins. If two people flip at once, the most recent one is what everybody ends up seeing.
- Nothing about project worlds, builder placements, or the switch's look and click behaviour changes.

## Technical detail

1. `src/lib/brain/barLightsStore.ts`
   - Keep the exact same public API (`getBarLightsOn`, `setBarLightsOn`, `toggleBarLights`, `useBarLightsOn`) so `SurfaceBar` and `BarLightSwitchButton` are untouched.
   - Add an internal `updatedAt` timestamp alongside the boolean.
   - Add `attachBarLightsGossip(fn)` (called on every local change, mirroring `attachPlacementGossip`), `acceptPeerBarLights({ on, updatedAt })` which applies a remote value only when `updatedAt` is newer than the local one (last-writer-wins, no echo loop), and `getBarLightsSnapshot()`.
   - Local sets stamp `updatedAt = Date.now()` and notify the gossip hook; remote applies do not re-broadcast.

2. `src/lib/world/p2pPlacementBridge.ts` (reuse the existing, already-booted bridge — no new boot path)
   - New channels `brain:barlights` (state gossip) and reuse of the existing new-peer poll to send the current snapshot to peers we haven't backfilled yet, plus `brain:barlights:sync-request` / `-response` for a newcomer asking for state.
   - Inbound messages are funnelled to `acceptPeerBarLights`.
   - Scope: lobby-only state, so no project membership check is needed; it is never sent for project universes.

3. Tests — `src/lib/brain/__tests__/barLightsStore.test.ts`
   - Newer remote timestamp overrides local; older remote is ignored; remote apply does not fire the outbound gossip hook.

4. Verification in the live preview
   - Open the Brain in two browser contexts via Playwright, walk to the bar in both, flip a switch in one, and screenshot the second to confirm the lights changed there too.
