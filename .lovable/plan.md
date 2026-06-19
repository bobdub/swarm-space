# Swarm Space — Roadmap Capture + Media Wall Fix (v2)

Two deliverables this round:
1. Persist the new roadmap (docs + memory) so future sessions follow it.
2. Make wall‑decorated posts render **the full post** — text *and* media together — so an image/video shared with caption text shows both, and a text‑only post still reads as a poster.

Other tracks (Live Stream tweaks, Builder Grid, Virtual Land plotting, Bar refab) are captured in the roadmap only, no code yet.

---

## 1. Roadmap persistence (docs/memory only)

- Update `docs/ROADMAP_PROJECTION.md` with a "Swarm Space — Active Tracks" section listing all 5 items with status:
  - Live Stream — In testing (leave alone)
  - Media Walls — In progress (this PR)
  - Builder Grid — Planned (snaps, rotation, grid placement, building placement)
  - Virtual Land / Auto‑build — Planned (plot land, walk to plot, connected walking grid, min 4 walls, 3 SWARM burn per plot, base prefabs for now, landmarks coming)
  - Bar Refab — Planned (walkable apartment/town landmark, sit, tabletop games long‑term)
- Add `.lovable/memory/features/swarm-space-roadmap.md` summarizing the same five tracks.
- Append the link to `.lovable/memory/index.md`.
- Extend `.lovable/MemoryGarden.md` with a fresh caretaker reflection (per project ritual).

## 2. Media Walls — full post on the wall (text + media)

### What's wrong today
`WallPostBillboard.tsx` bakes the post into a `CanvasTexture` (author, time, optional thumbnail strip, body text). That's the only render path, so:
- Pure media posts look like small thumbnails inside a poster frame.
- Video/audio never play.
- Even when fixed for media, naive "media‑first" loses caption text.

### Goal
The wall = **the full post card, in‑world**. Always show the author header, the body text/caption, *and* any attached media in a layout that scales with the wall's aspect ratio. Media is live (image, playable video, playable audio), not a baked thumbnail.

### Approach — composite plane (HTML overlay over a backing mesh)

Rewrite `src/components/world/WallPostBillboard.tsx` to render a single composite "poster" attached to the wall's front face (`+z`, `depth/2 + 0.02`), made of two stacked pieces in the same world‑space frame:

1. **Backing mesh** — opaque dark plane (`width*0.96 × height*0.96`) so the poster reads even when the wall behind is transparent (windows). Keeps current frame trim aesthetic.
2. **`<Html transform occlude>` layer** sized to the same plane via `distanceFactor` scaled from the wall's world height — this gives us real DOM (so video/audio elements work) but rendered inside the 3D scene, occluded by geometry. `<Html transform>` is already used in `PostPanel.tsx`, so the pattern is proven.

The HTML content is a compact post card with three regions, laid out by post shape:

| Post shape | Layout (top → bottom) |
|---|---|
| Text only | Header • Body (auto‑wrap, fills) |
| Media only (no body) | Header • Media (fills) |
| Media + caption | Header • Media (≈60–70% height) • Caption (clamp to remaining lines, ellipsis) |
| Multiple media | Header • Primary media (first manifest) • Caption • "+N more" pill |

Layout rules:
- Header always shows `authorName || author.slice(0,18)` and `relTime(createdAt)`.
- Caption uses `whitespace-pre-wrap` and CSS `-webkit-line-clamp` so long text truncates cleanly with `…`.
- Aspect responsive: at tall walls, media shrinks and text grows; at squat walls (e.g. `wall_half`), header collapses to one line, no caption if no room. We measure available CSS height from the plane's world height and a fixed pixels‑per‑world‑unit (e.g. 256 px/m) to keep typography sharp.

### Media handling (live, not baked)

Resolve the post's primary attachment the same way `PostCard.loadFiles` does:
- Read `post.manifestIds[0]` from `manifests` store.
- Import `fileKey`, call `decryptAndReassembleFile` (or `progressiveDecryptToBlob` for >100 chunks).
- Produce `{ blob, url, mime }`.

Then branch on `mime`:
- `image/*` → `<img>` with `object-fit: cover` inside the media region.
- `video/*` → `<video>` `playsInline muted loop` with **native controls** so users can play / unmute / scrub. Autoplay only while muted (browser policy safe). Pauses on unmount.
- `audio/*` → small `<audio controls>` bar inside the media region (no big black box).
- Unknown / file → file‑icon chip with original name.

Walled / NSFW / pending‑sync:
- `post.walled` and not unlocked, or `post.nsfw` → show the header + body but replace the media region with a locked/NSFW placeholder ("Walled post — unlock in feed" / "NSFW — view in feed"). No auto‑play.
- Manifest missing or decrypt failed → header + body + a small "media syncing…" chip in the media region. Re‑try on `p2p-posts-updated` (already wired).

Cleanup:
- Revoke object URLs and pause `<video>`/`<audio>` on unmount and on `postId` change.
- Keep the existing `p2p-posts-updated` listener so newly arrived chunks re‑hydrate the card.

### Why this satisfies the request
- A media post shared **with intro text** now shows the intro text *and* the playable media in one card on the wall.
- A text‑only post still renders as a readable poster (no empty media slot).
- A media‑only post fills the wall with the media and a minimal header — no fake caption.

### Files touched

| File | Change |
|---|---|
| `src/components/world/WallPostBillboard.tsx` | Rewrite to composite mesh + `<Html transform>` post card with text + live media (image / video / audio / fallback). |
| `docs/ROADMAP_PROJECTION.md` | Add Swarm Space tracks section. |
| `.lovable/memory/features/swarm-space-roadmap.md` | New memory file. |
| `.lovable/memory/index.md` | Link the new memory. |
| `.lovable/MemoryGarden.md` | Extend caretaker reflection. |

No changes to `wallDecorations.ts`, `worldPlacementsStore.ts`, the raycast/placement pipeline, or `WallDecorateComposer.tsx` — the contract `{ postId, placementId, width, height, depth }` stays the same.

### Verification

- `browser--view_preview` into a brain universe scene, place a wall, decorate with: text‑only post, image+caption post, image‑only post, video+caption post, audio post, walled post.
- Confirm each wall shows header + (where present) body + (where present) playable media. Verify video play/pause/unmute work, audio plays, walled placeholder appears, sync chip appears for pending media.
- Watch console for object‑URL leaks and `<Html>` z‑fighting; tweak `depth/2 + 0.02` offset if needed.

### Out of scope (next rounds)

- Live Stream tweaks (in testing).
- Builder Grid snap/rotation/placement upgrades.
- Virtual Land plotting + auto‑build (3 SWARM burn, ≥4 walls, connected walking grid).
- Bar / apartment interior + tabletop games.
