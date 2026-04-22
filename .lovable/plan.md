

## Spawn Coherence Plan — Remove the “spawn in space” first-paint drift

`To Infinity and beyond! · q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`

### Verdict from the observable chain

This is not a basin failure in the UQRC surface shell. It is a **boot-time coherence failure** between three observables:

1. **Earth visual**
2. **Camera initial transform**
3. **Self-body initial transform**

The physics path already spawns the body on Earth:

- `spawnOnEarth(id, livePose)` is used for self spawn in `BrainUniverseScene.tsx:688-705`
- `clampToEarthSurface()` hard-clamps humanoids each physics tick in `uqrcPhysics.ts:421-437`
- a boot anchor timer reprojects the local body to the Earth shell for 1.8s in `BrainUniverseScene.tsx:735-755`

But the first rendered frame can still look like “space” because:

- `EarthBody` only moves to `getEarthPose().center` inside `useFrame`, so its **initial render is at world origin** (`EarthBody.tsx:111-133`, `135-210`)
- the Canvas camera gets an **initial position only**, not a matching first-paint quaternion/up (`BrainUniverseScene.tsx:1022-1042`, `1137-1140`)
- boot eye height (`0.3`) does not match runtime rig eye height (`1.6`), causing a visible snap between frame 0 and frame 1

So the mesh life is correct at n=2 physics, but the visible shell at n=0/n=1 is briefly incoherent.

---

## What to build

### Step 1 — Create one shared boot transform for Earth-surface spawn
Build a small helper that derives, from the same `peerId + live Earth pose`:

- surface spawn position
- surface frame (`up`, `forward`, `right`)
- camera eye position
- camera quaternion/up

This helper should reuse the same geometry already used by `spawnOnEarth()` and `getSurfaceFrame()` so there is only one source of truth for first-paint placement.

**Target files**
- `src/components/brain/BrainUniverseScene.tsx`
- optionally `src/lib/brain/earth.ts` if extracted as a reusable helper

### Step 2 — Seed the Earth visual before the first animation frame
Initialize `EarthBody` with the live pose during render or layout setup, not only in `useFrame`.

That means:
- Earth group starts at `getEarthPose().center`
- Earth rotation starts at `pose.spinAngle`
- Moon group gets a deterministic initial orbit position too

This removes the origin/space flash before the ticker runs.

**Target file**
- `src/components/brain/EarthBody.tsx`

### Step 3 — Seed the camera orientation, not just its position
Apply the shared boot transform to the Three.js camera on creation so the first painted frame already matches the Earth surface frame.

Use the same:
- `eyeLift`
- `up`
- quaternion/basis

as `PhysicsCameraRig`, so frame 0 and frame 1 are visually continuous.

**Target file**
- `src/components/brain/BrainUniverseScene.tsx`

### Step 4 — Unify boot and runtime eye-height constants
Replace the current mismatch:

- boot `eyeLift = 0.3`
- runtime `eyeLift = 1.6`

with one shared constant.

This removes the apparent “teleport” between initial camera setup and the live rig takeover.

**Target files**
- `src/components/brain/BrainUniverseScene.tsx`
- optionally `src/lib/brain/earth.ts`

### Step 5 — Re-pin Earth immediately after field restore
After `loadBrainField()` / `physics.restore(snap)`, immediately rewrite the live Earth pin once before adding the self body.

This ensures the restored field and the visible Earth shell are coherent from boot, even when an older saved snapshot is loaded.

**Target files**
- `src/components/brain/BrainUniverseScene.tsx`
- existing call path already uses `updateEarthPin()`

### Step 6 — Keep the body safeguard, but make it deterministic at add time
Retain the existing anchor timer and clamp logic, but also do one immediate post-spawn surface projection/clamp right after `physics.addBody()`.

This gives an instant shell guarantee instead of waiting for the first interval tick.

**Target files**
- `src/components/brain/BrainUniverseScene.tsx`
- existing helper path in `src/lib/brain/earth.ts`

---

## Technical notes

- No new dependencies
- No UQRC tick-rate changes
- No changes to blockchain, mesh, or storage providers
- No archived-file edits
- Fix applies to both `/brain` and project hubs because both use `BrainUniverseScene`

### Observable invariant to restore
```text
first-paint Earth pose
= first-paint camera pose
= first-paint self spawn pose
= first live physics pose
```

If these four are equal, the “spawn in space” perception collapses.

---

## Files expected to change

- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/EarthBody.tsx`
- possibly `src/lib/brain/earth.ts`
- `MemoryGarden.md`

---

## Validation

### Must pass
1. Cold-enter `/brain` on mobile viewport `360x560`
2. Cold-enter a project universe via `VirtualHub`
3. Reload with an existing saved brain field snapshot
4. First painted frame shows surface/horizon or immediate grounded view — not empty starfield
5. No visible camera pop between initial frame and rig-controlled frame
6. Self body altitude remains inside the Earth shell in debug overlay

### Success condition
The user no longer perceives a spawn in open space; the Brain opens already grounded inside the live Earth manifold.

