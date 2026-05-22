# Known Issues

## NPCs not embodied in world (BUGGED — DEFERRED)

NPC roster boots, scheduler ticks, `npcEngine.reanchorNpc` runs after the
live peerId resolves — but no NPC bodies render in the scene.

Markers were removed (false positives), so the world now correctly shows
"nothing" instead of misleading resource spheres.

Suspected: `BuilderBlockEngine` does not pick up the re-anchored block
group, OR the body group is anchored to a frame the camera never visits.

Re-open after Lab + Forge phases ship. Until then, the dev overlay (`?debug=npc`)
shows a `NPC: BUGGED — embodiment disabled` banner so we stop chasing it
from the visual layer.

Relevant files: `src/components/brain/npc/NpcSwarmLayer.tsx`,
`src/lib/world/wetWork.ts`.

---

## Cleanup log (2026-05-22)

- Removed `src/components/remix/LabPopover.tsx`; Lab creations now render
  as a native section in `BrainBuilderBar` (tab + "+ Create" tile).
- Mobile bottom nav (`MobileBottomBar`) is a no-op render; users exit
  the Brain via in-app affordances before social-site chrome shows.
- Forge `CraftView` rail caps at 5 empty coins and collapses to the
  picked coin when the user focuses one (with "Show all (N)" toggle).
