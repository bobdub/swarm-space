
# Builder, Plots, Avatars & A/V — Fix Plan

Scoped fixes only; no UQRC field or signaling rewrites. Each area lists the exact files and the change.

---

## 1. Object Placement Flow

**Goal order:** Open Builder → Select asset → Click/tap to drop ghost → rotate → Confirm → later Edit/Move/Delete.

**Files:** `src/components/world/AssetCaster.tsx`, `src/components/brain/builder/BrainBuilderBar.tsx`, `src/lib/world/assetCaster.ts`, `src/lib/world/worldPlacementsStore.ts`, `src/components/world/BuildGridOverlay.tsx`, `src/lib/brain/useBrainBuilder.ts`.

- **Spawn near avatar, not camera horizon.** In `AssetCaster.useEffect` arm path, seed `hitPoint` from the local avatar's surface position projected ~2 m along avatar facing (read `physicsAvatarStore` + Earth pose). Fall back to camera-forward only if no avatar pose.
- **Defer commit until explicit Confirm.** Audit BuilderBar's "Confirm" button so it only fires `confirmCast()` when a ghost is positioned. Remove any auto-commit on arm. On mobile, a tap on the ghost ✓ button is the only commit path.
- **Grid snap during drag.** In the AssetCaster drag loop, quantize the Earth-local tangent offset to `CELL` (= `WALL_PITCH`, 2.5 m) before writing back via `setCastHitSilent`. Skip the snap when `freeBuild` is true.
- **Move persistence.** `updateLocalPlacement` (already partially fixed) must drop the cached `localNormal/Forward/Right` and recompute from the new `hitPoint` via `placePrefabAtHit`, then re-register the anchor frame so the renderer reads the new pose instead of snapping back.
- **Free Build toggle.** Wire `freeBuild` end-to-end: (a) AssetCaster skips grid quantization, (b) `BuildGridOverlay` hides (already done), (c) BuilderBar shows toggle state. Event channel: existing `BUILDER_MODE_EVENT` carries the flag.

## 2. Land Plots

**Files:** `src/components/brain/builder/BrainBuilderBar.tsx`, `src/components/world/LandPlotsOverlay.tsx`, `src/lib/world/landPlots.ts`, `src/lib/brain/prefabHouseCatalog.ts`, `src/lib/world/landmarkCatalog.ts`, `src/lib/remix/coinCraftingStore.ts`.

- **Landmarks tab unlock.** After `confirmPlotPurchase`, gate a new "Landmarks" tab in BuilderBar on `ownsAnyPlot(selfId)`. Tab lists prefabs from `landmarkCatalog` + minted coins from `coinCraftingStore`. Placement of landmarks restricted to owner's plot polygon (point-in-polygon check inside `AssetCaster` commit).
- **Foreign plot rendering + block.** `LandPlotsOverlay` paints plots owned by other peers with a translucent red fill + red boundary (current: uniform). Add a gate in the AssetCaster commit and move paths that rejects placements landing inside a foreign plot, with a "Owned by another player" toast.

## 3. Avatars

**Files:** `src/components/brain/RemoteAvatarBody.tsx`, `src/lib/brain/avatarMetrics.ts` (new constant file), `src/components/brain/PhysicsCameraRig.tsx`, `src/lib/brain/collide.ts`, `src/lib/brain/builderBlockEngine.ts`.

- **Floor sink.** Remote avatars resample `sampleSurfaceLift(localDir)` every frame and add capsule half-height. Stop trusting the peer's broadcast Y — terrain LOD differs per client.
- **Standard capsule.** Single constant: 1.8 m tall × 0.4 m radius applied to both local and remote renderers and the physics capsule.
- **Collisions with placed assets.** Register every committed prefab's AABB with `BuilderBlockEngine` → `collide.ts` so capsules cannot phase through walls/bar/landmarks. Subscribe rebuild on `world.mutation`.

## 4. In-world Audio / Video

**Files:** `src/lib/webrtc/manager.ts`, `src/contexts/StreamingContext.tsx`, `src/components/streaming/LivePostBoxBody.tsx`, `src/components/streaming/LivePostPreview.tsx`.

- **Half-open repair.** For each peer in the room roster, if no `RTCPeerConnection` reaches `connectionState === 'connected'` within 4 s, re-initiate with polite/impolite roles based on `peerId` lexical order. Log mismatch causes.
- **Black-frame repair.** When a remote track is attached but `videoElement.videoWidth === 0` after 3 s, call `pc.restartIce()` once and re-bind `srcObject`.
- **Per-tile Resync button.** Visible on each participant tile in spectator and stage grids; runs the two recovery paths on demand.
- **Roster reconciliation.** On every `peer-joined`/`peer-left` event, run a pass that ensures pairwise PCs exist; tear down stale ones whose remote peer left.

## 5. Verification

- Three browser contexts on `/brain`:
  1. Place + move a wall inside an owned plot; reload, confirm persistence.
  2. Toggle Free Build; ghost no longer snaps, grid hides.
  3. Attempt to place inside a foreign plot; expect rejection toast + red overlay.
  4. Walk into walls and the bar; expect collision.
  5. Join live with mic-only, cam-only, and no equipment; verify all three pairs hear and see each other; trigger Resync after killing one PC manually in devtools.
- Add unit tests under `src/lib/world/__tests__`: grid quantization on/off; plot-ownership gate.

## Out of scope

- BuilderBar visual redesign.
- WebRTC signaling protocol rewrite.
- New landmark art beyond `landmarkCatalog`.
- UQRC field changes.
