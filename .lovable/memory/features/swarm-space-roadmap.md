---
name: Swarm Space Roadmap
description: Active tracks — Live Stream, Media Walls, Builder Grid, Virtual Land/Auto-build, Bar Refab
type: feature
---
Live Stream: in testing, leave alone unless asked.
Media Walls: WallPostBillboard renders the full post (header + body + live media). Image/video/audio decrypted from manifestIds[0] via importFileKey + decryptAndReassembleFile / progressiveDecryptToBlob, rendered through drei <Html transform occlude> over a backing mesh on the wall's +z face. Walled/NSFW posts show header+body with a locked placeholder instead of auto-playing media. Pending sync re-tries on `p2p-posts-updated`.
Builder Grid: planned — improve snaps, rotations, grid placement, building placement (see HubBuildLayer, snapping.ts).
Virtual Land / Auto-build: planned — builder-mode plot tool. Toggle, walk, plot. Walking grid must connect plots; each plot ≥4 walls. Plotting burns 3 SWARM. Base prefabs only; landmarks coming.
Bar Refab: planned — apartment/town landmark becomes a walkable bar (enter, sit, tabletop games long-term).