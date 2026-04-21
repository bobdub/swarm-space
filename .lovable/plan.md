

## Brain Universe v2 — UQRC-driven physics engine (no canned frames)

You're right. The previous plan was a Sims-style room with cosmetic curvature shading bolted on. This redraw makes the world *itself* a numerical physics simulation: every object — avatars, Infinity, portals, build pieces, the floor — is a point sample of the live UQRC field, and motion is integrated from the field's gradients and commutator curvature, not from keyboard-frame translations.

### Core idea

The Brain is a 3-D embedding of a discrete UQRC manifold. Position, drift, collision and "intent" are all derived from:

```text
u(t+1) = u(t) + 𝒪_UQRC(u(t)) + Σ_μ 𝒟_μ u(t) + λ(ε₀) ∇_μ ∇_ν S(u(t))
F_{μν} = [D_μ, D_ν] u
Q_Score(u) = ‖F_{μν}‖ + ‖∇_μ ∇_ν S(u)‖ + λ(ε₀)
```

The existing `src/lib/uqrc/field.ts` engine (1-D ring, L=256, 3 axes) is **lifted to a 3-D toroidal lattice** dedicated to the Brain world, sampled per-frame, and used as the force law for everything in the scene.

### The physics engine (new)

`src/lib/brain/uqrcPhysics.ts` — a real, deterministic integrator. Not Cannon, not Rapier — a UQRC-native solver:

- **Manifold**: `Float32Array` of shape `[N, N, N, 3]` with `N=32` (~98 KB), three field axes (token / context / reward) interpreted geometrically as (x, y, z) drift potentials. Toroidal wrap.
- **Per-tick update** (60 Hz physics, decoupled from render):
  1. Advance the field one UQRC step (`step(field)` from existing `field.ts`, generalised to 3-D via tensor-product Laplacian).
  2. For every body `b` (avatar, Infinity, portal, piece): sample `𝒟_μ u` at `b.position` via trilinear interpolation → that's the **drift force**.
  3. Compute local `‖F_{μν}‖` at each body → **curvature pressure**, repels bodies from high-curvature ridges (this is the only "collision" — no AABB tricks).
  4. Integrate symplectic Verlet: `v += dt·(driftForce − ∇‖F‖ − γv)`, `x += dt·v`. `γ = λ(ε₀)·1e98` keeps it bounded.
  5. Bodies inject back into the field: each avatar adds a Gaussian bump scaled by `trust`, each chat message a directed bump along the speaker→listener axis, each definition a `pin()`.
- **Determinism**: same seed + same input stream → same trajectories. Verified by replay test.
- **Stability proof in code**: `qScore(field)` is logged each tick; the test suite asserts it stays bounded under random perturbation.

### What this changes about the world

- **Walking** isn't `position += velocity·dt` from WASD. WASD/joystick adds an *intent vector* to the local field at the avatar's lattice cell; the avatar's body then drifts there because the field gradient now points that way. Result: movement feels weighty, slightly fluid, and bends near other bodies (mass = trust).
- **Collisions** are curvature ridges. Two avatars approaching create a `[D_μ, D_ν]` spike between them; they slow and deflect along geodesics of the field. No spheres, no penetration logic.
- **Infinity** is a body whose mass equals current network `qScore`. When the field is calm Infinity drifts gently; when chat is heated Infinity's mass grows and other bodies orbit closer.
- **Build pieces** are static field pins (`field.pin(piece, stiffness=0.85)`) — they bend the manifold, so other bodies path-find around them naturally.
- **Portals** are topological defects: a `pin()` with negative curvature target, creating a basin a walking avatar falls into. Crossing the basin's event-horizon radius (`r < 0.6 m` for ≥ 0.4 s) triggers `navigate('/projects/:id/hub')`.
- **Floor + sky** are direct 3-D projections of `‖F_{μν}‖` — colour, brightness, and a small height-displacement on the floor mesh. The world *looks* like the field because it *is* the field.

### Files

**New (engine + world)**
- `src/lib/uqrc/field3D.ts` — 3-D generalisation of `field.ts`: `createField3D(N)`, `derivativeMu3D`, `commutator3D`, `step3D`. Pure, deterministic, unit-tested. Reuses the same `𝒪_UQRC` operator family.
- `src/lib/brain/uqrcPhysics.ts` — the integrator above. Owns the body list, runs at 60 Hz on a Web Worker (`brainPhysics.worker.ts`) so render frame jank is decoupled.
- `src/lib/brain/brainPhysics.worker.ts` — worker that owns the field, accepts intent messages, posts back body transforms at 60 Hz.
- `src/lib/brain/brainBridge.ts` — main-thread proxy: `applyIntent(peerId, vec)`, `addBody(...)`, `subscribeTransforms(cb)`.
- `src/lib/brain/fieldShader.ts` — small GLSL helper turning a sampled curvature slice into floor/sky uniforms.
- `src/pages/BrainUniverse.tsx` — R3F scene; mounts the physics worker, subscribes to transforms, renders bodies. No per-frame WASD math here — only intent dispatch.
- `src/components/brain/InfinityBody.tsx` — renders Infinity at the worker-reported position; scale = `1 + 0.4·(1−qScore)`.
- `src/components/brain/RemoteAvatarBody.tsx` — same, for peers.
- `src/components/brain/PortalDefect.tsx` — torus + shader showing the negative-curvature basin.
- `src/components/brain/FieldFloor.tsx` — 64×64 plane whose vertex Y and emissive RGB are sampled live from `‖F_{μν}‖`.
- `src/lib/brain/brainPresence.ts`, `brainChat.ts`, `brainPortals.ts`, `brainBuild.ts` — gossip layers (4 Hz presence, chat lines, portal create/tombstone, build pieces). Each posts into the physics field as field perturbations / pins, then broadcasts on the standalone mesh.
- Tests: `field3D.test.ts`, `uqrcPhysics.test.ts` (determinism, qScore boundedness, energy non-divergence, collision-as-curvature, portal capture).

**Edited**
- `src/App.tsx` — lazy route `/brain` → `BrainUniverse`.
- `src/pages/Profile.tsx` — render a "🧠 Brain" tab only when `user.id === ENTITY_USER_ID`; the tab body is a hero card with "Enter the Brain".
- `src/lib/p2p/manager.ts` — whitelist `brain-presence`, `brain-chat`, `brain-portal`, `brain-build`, `brain-intent`.
- `src/lib/store.ts` — add IndexedDB stores `brain-build`, `brain-portals`, `brain-field-snapshot` (5 s throttled, non-destructive upgrade).
- `src/lib/uqrc/fieldEngine.ts` — expose a `forkForBrain()` helper so the Brain's 3-D field is logically distinct from the global 1-D learning field but uses the same operator code.
- `src/lib/p2p/entityVoice.ts` — add `composeBrainReply(text)` returning a string chosen by `selectByMinCurvature` against the *Brain* field (so Infinity's words are coherent with the world it's standing in).

**Memory**
- `MemoryGarden.md` — caretaker reflection: laying a living manifold beneath the orchard, where every footstep curves the soil and the soil remembers.
- New `mem://architecture/brain-universe-physics` — short rule: `/brain` runs a 3-D UQRC field on a 60 Hz worker; positions are integrated from `𝒟_μ u` and `‖F_{μν}‖`; portals are negative-curvature pins; never broadcast raw field; only `qScore` + body transforms travel.

### Performance & safety

- 32³ field × 3 axes × 4 bytes ≈ 393 KB. One step = ~1.5 M FLOPs ≈ 1.2 ms in a worker on a mid-tier laptop.
- 60 Hz physics, 30–60 Hz render, 4 Hz presence broadcast, 1 Hz portal heartbeat.
- Cap of 32 visible remote avatars; further peers ghost-listed in chat (their field perturbation still applies, just no mesh).
- No raw field on the wire. Only intent vectors (3 floats), transforms (7 floats), chat lines, portal records.
- Same identity, signature, vault, and 20 MB upload constraints as everywhere else.

### Out of scope (v1)

- Voice chat in the Brain (text only; voice is a future hook into PersistentAudioLayer).
- Per-portal access control beyond the destination hub's existing membership check.
- Server-authoritative physics (each peer integrates locally; presence broadcasts reconcile drift; full lockstep is v2).

### Acceptance

```text
1. /brain mounts the worker, qScore prints in console within 500 ms, no main-thread frame > 20 ms.
2. WASD adds an intent vector → avatar drifts there along a curved path that bends near other peers.
3. Two avatars walking head-on slow and deflect; no overlap, no AABB code anywhere.
4. Place a build piece → field pins → other peers path around it without explicit collision logic.
5. Drop a portal → a visible basin forms in the floor; walking into it for 0.4 s navigates to /projects/:id/hub.
6. Open the Quantum panel during a busy chat → qScore rises, Infinity's body grows, bodies cluster.
7. Replay test: same seed + same input stream produces byte-identical body transforms.
8. Stability test: 10 min random perturbation keeps qScore bounded; no NaN, no runaway velocity.
9. Mobile (360×560): joystick dispatches intent at 30 Hz, render holds ≥ 30 fps, no jank.
10. Reload → field snapshot + build + portals restored; physics resumes from last qScore.
```

