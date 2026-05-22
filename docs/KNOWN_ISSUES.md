# Known Issues

## NPCs not embodied in world (DEFERRED)

NPC roster boots, scheduler ticks, `npcEngine.reanchorNpc` runs after the
live peerId resolves — but no NPC bodies render in the scene.

Markers were removed (false positives), so the world now correctly shows
"nothing" instead of misleading resource spheres.

Suspected: `BuilderBlockEngine` does not pick up the re-anchored block
group, OR the body group is anchored to a frame the camera never visits.

Re-open after Lab phase ships. Until then, the dev overlay (`?debug=npc`)
shows a `NPC: BUGGED — embodiment disabled` banner so we stop chasing it
from the visual layer.
