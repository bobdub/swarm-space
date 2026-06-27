## Scope
Five problem areas reported on `/brain`. Each fix stays in the smallest possible module; no UQRC field or P2P-bus rewrites.

---

### 1. Builder placement flow

**Files:** `src/components/world/AssetCaster.tsx`, `src/components/brain/BrainUniverseScene.tsx` (prefab arm effect ~L1740), `src/lib/world/assetCaster.ts`, `src/lib/world/placementController.ts`, `src/lib/brain/useBrainBuilder.ts` (free-build flag plumbing).

- Re-seed ghost in front of the avatar, not the camera. Replace the camera-forward seed in `AssetCaster.useEffect` with the avatar pose + facing from `physicsAvatarStore` and project ~2 m forward onto the shell. Falls back to camera-forward only if avatar pose unavailable.
- Snap ghost to the world grid. While dragging, quantize the Earth-local tangent to `CELL` from `buildGrid.ts` unless `freeBuild` is on. Read flag via the existing `brain-builder-mode` event (already carries `freeBuild`).
- Correct order of operations: armed prefab spawns ghost → drag → rotate → ✓ confirm. On mobile the ✓ button in the in-world HUD already exists; just ensure it is visible above the ghost (already wired). No commit-on-tap path needs to be added or removed — the existing flow already gates on ✓; we only fix the spawn-far bug and remove any accidental auto-commit in the BuilderBar (audit the "Confirm" button: it should commit only when a ghost exists, not while dragging).
- Move action persistence: in the wall-edit `onConfirm` path (Scene L1701), after `updateLocalPlacement`, re-register the Earth-local site frame for the new hit so the renderer reads the updated anchor instead of the cached one. Verify `worldPlacementsStore.updateLocalPlacement` writes the new `localNormal/Forward/Right`; if not, recompute via `deriveLocalFrame` before save.
- Free Build toggle: today it only flips `magnetic` off. Extend the snap step in AssetCaster to early-return raw `localDir` when `freeBuild` is true, and hide the `BuildGridOverlay` when `freeBuild` is on (subscribe to the same event in `BuildGridOverlay.tsx`).

### 2. Land Plots

**Files:** `src/lib/world/landPlots.ts`, `src/components/world/LandPlotsOverlay.tsx`, `src/components/brain/builder/BrainBuilderBar.tsx`, `src/lib/brain/prefabHouseCatalog.ts` (section list).

- After a successful purchase (`confirmPlotPurchase`), set a local flag `hasOwnedPlot` and append a `landmarks` section to the BuilderBar tabs. Source landmark prefabs from `landmarkCatalog.ts` (already exists) and any minted coins via `toolMintStore`. Tabs render conditionally on `ownsAnyPlot(selfId)`.
- Other-owned plots: in `LandPlotsOverlay`, color plots owned by peers with a red translucent fill + red boundary (currently all plots render the same). The placement gate at `BrainUniverseScene` L1776 already refuses placement; add the same gate to the wall-edit move path and the AssetCaster drag (toast "Owned by another player" and snap ghost back inside the caller's plot).

### 3. User Avatars

**Files:** `src/components/brain/PhysicsCameraRig.tsx` or wherever remote avatar height is sampled, `src/lib/brain/collide.ts`, `src/components/world/RemoteAvatars.tsx` (whichever renders peer capsules).

- Floor-sink fix: remote avatars derive Y from their last broadcast surface lift; if the local terrain sample differs (mesh LOD), they sink. Resample `sampleSurfaceLift(localDir)` per-frame for each remote avatar using the local Earth pose and add the avatar capsule half-height (1.0 m) so feet sit on the ground.
- Sizing: standardize capsule to 1.8 m tall × 0.4 m radius and apply to both local and remote renderers (one constant in `avatarMetrics.ts`).
- Collisions vs. world assets: feed `BuilderBlockEngine` block AABBs into the existing capsule resolver in `collide.ts`. Subscribe once at mount and rebuild on `world.mutation`. Trees/rocks already register; walls/prefabs currently don't — add a registration step inside `placePrefabAtHit` after engine commit.

### 4. In-world Audio / Video sync

**Files:** `src/lib/streaming/webrtcManager.ts` (or current path), `src/components/streaming/LivePostBoxBody.tsx`, peer mesh hookup in `StreamingContext.tsx`.

- The asymmetric "A hears B, B doesn't hear A" pattern is a half-open WebRTC connection. Add a per-pair offer/answer integrity check: when a remote peer appears in the room roster but no `RTCPeerConnection` exists with `connectionState === 'connected'` after 4 s, re-initiate via the polite/impolite peer pattern (lower peerId = polite). Log mismatches to console.
- Black-frame case: when a track arrives but `videoElement.videoWidth === 0` after 3 s, trigger `pc.restartIce()` once and re-attach `srcObject`.
- Add a "Resync" button on each tile in the spectator/host grid that calls the above two recovery paths on demand.

### 5. Verification

- Manual: open three browser contexts, place + move a wall in a plot, switch Free Build, attempt build on another player's plot, walk through walls (should collide), join live with mic-only / cam-only / none.
- Automated: extend `src/lib/world/__tests__` with a placement-snap test (grid quantization on/off) and a plot-ownership gate test.

---

### Out of scope
- Re-skinning the BuilderBar UI.
- Rewriting the WebRTC signaling layer.
- New landmark assets beyond what `landmarkCatalog.ts` already exposes.
