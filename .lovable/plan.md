## Goal

Make NPCs appear as real in-world entities, not just leave the resource-marker overlay visible.

## What the code shows

- `NpcSwarmLayer` always renders `ResourceMarkers`, even if the NPC roster is empty.
- Actual NPC bodies only render from `npcRegistry` via `NpcBodies` → `BuilderBlockView`.
- NPC creation currently depends on a deferred idle boot in `main.tsx`, where `startNpcTickScheduler()` is started after async imports.
- If that boot path does not run reliably in preview / mobile timing, or runs before the scene is ready, you get exactly your symptom: markers visible, zero embodied NPCs anywhere in the world.

## Plan

### 1. Move NPC live boot closer to the world scene

Start the NPC lifecycle from the world scene layer instead of relying only on `main.tsx` idle boot.

- Add a small `bootNpcWorld()` helper in the NPC module.
- Call it from `NpcSwarmLayer` (or `BrainUniverseScene`) on mount.
- Keep it idempotent so repeated mounts do nothing.

This makes NPC embodiment part of the actual world lifecycle, not a background boot detail.

### 2. Guarantee seed spawn into the registry

Harden the scheduler start path so it proves NPCs exist after boot:

- `startNpcTickScheduler()` should ensure the seed roster exists immediately.
- If the registry is still empty after hydration + seed pass, run one explicit fallback seed pass.
- Keep all NPC spawning through `npcEngine.spawnNpc()` so BuilderBlockEngine remains the only world writer.

### 3. Add lightweight spawn diagnostics

Add targeted logs around the real failure points:

- when NPC boot begins
- how many persisted NPCs were loaded
- how many were successfully spawned
- final `npcRegistry` count after seed
- any per-NPC spawn failure reason

This will let us distinguish between:
- scheduler never starting
- roster seeding failing
- blocks spawning but not rendering

### 4. Stop showing orphaned markers

The marker layer should not be the only visible evidence of the NPC system.

- Render `ResourceMarkers` only when there is at least one live NPC in the roster, or behind an explicit debug toggle.
- Default behavior: no NPCs means no NPC-only markers.

That removes the misleading state you’re seeing now.

## Technical changes

| File | Change |
|---|---|
| `src/lib/brain/npc/npcTickScheduler.ts` | Harden scheduler start and fallback seed path; expose a safe boot helper if needed. |
| `src/components/brain/npc/NpcSwarmLayer.tsx` | Trigger NPC boot on mount; gate resource markers on live roster/debug state. |
| `src/main.tsx` | Reduce NPC responsibility here or leave only hydration as a secondary boot path. |
| `src/lib/brain/npc/npcEngine.ts` and/or scheduler boot path | Add precise spawn diagnostics around failures. |

## Expected result

- NPCs become real embodied world entities again.
- Traveling the planet reveals actual NPC bodies, not just marker spheres.
- If NPC boot fails in the future, the logs will show exactly where.
- The UI no longer shows markers by themselves when there are no live NPCs.