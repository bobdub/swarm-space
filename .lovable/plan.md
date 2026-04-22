

## Got it — first-person walker on Earth's outside surface (you ARE on the landmass)

You're already on the landmass — the avatar's feet are on `EARTH_RADIUS`, which IS the outside ground. The problem is purely the **camera**: it's pulled back so far you see Earth as a ball instead of the grass under your feet. A person walking to the store doesn't see their planet from orbit — they see sidewalk, horizon, sky.

This plan brings the camera down to human eye height so it feels like walking, not orbiting.

### What changes

**1. `src/components/brain/BrainUniverseScene.tsx` — first-person camera rig**

Replace the current orbital follow with a human-scale rig:

```text
eye    = avatarPos + up * 1.6        (eye 1.6m above feet)
look   = eye + forward * 10          (look 10m ahead along ground)
camUp  = up                          (radial outward — horizon stays level)
near   = 0.05                        (don't clip your own feet)
far    = EARTH_RADIUS * 4            (see the whole sky)
```

- `up` and `forward` come from `getSurfaceFrame(avatarPos, pose)` every frame, so the horizon re-levels as you walk around the curve of the planet.
- Mouse / touch-drag rotates `forward` around `up` (yaw) and tilts pitch within ±80°. This is standard FPS look.
- WASD / joystick intent is interpreted in the tangent plane (already wired) — "forward" walks you toward where the camera is looking.

**2. Optional zoom-out toggle (hold `V`)**

Lerp the camera back to a 200m third-person orbit while held, so you can confirm "yes, I'm a tiny figure on a planet." Releasing snaps back to first-person. Pure quality-of-life — skip if you want a strict walker.

**3. `src/components/brain/EarthBody.tsx` — readable ground at eye height**

The current shader is tuned for planetary views — at eye height every pixel is one color. Add a near-camera detail octave to the fragment shader:

```glsl
float dist = length(cameraPosition - vWorldPos);
float nearMix = 1.0 - smoothstep(20.0, 200.0, dist);
float micro = noise(vWorldPos * 80.0) * nearMix;
col = mix(col, col * (0.85 + micro * 0.3), nearMix);
```

This gives grass/dirt-tuft variation when you're standing on it, and fades out when you zoom away — no extra geometry, no perf cost.

**4. Sky stays a sky**

`<StarField/>` and the atmosphere rim already render. Verify draw order is `EarthBody → StarField → atmosphere` so stars don't get clipped by the new far plane (`EARTH_RADIUS * 4` is plenty). Add a soft hemisphere tint (sky-blue from `up`, ground-tan from `-up`) so the world feels lit from above.

### Files touched

- **EDIT** `src/components/brain/BrainUniverseScene.tsx` — first-person eye-height camera, surface-aligned `up`, mouse/touch look, near/far planes, optional `V` zoom toggle.
- **EDIT** `src/components/brain/EarthBody.tsx` — near-camera detail noise octave in fragment shader.

### What you'll see

- Spawn drops you onto a colored patch of land at eye height. You see ground in front of you, sky above, horizon curving gently away.
- Walk forward (W / joystick): you move across the surface; the world flows past you like walking down a street.
- Look around (drag): horizon stays level; sky and ground rotate around you naturally.
- Hold `V`: camera pulls back 200m so you can see the tiny "you" standing on a curved planet. Release: snap back to walking.

### Out of scope (next, when you're ready)

- A literal "store" / buildings / roads as actual scene objects on the surface.
- Atmosphere transition + flight up into space (the `ATMOSPHERE_RADIUS` hook is already there).

