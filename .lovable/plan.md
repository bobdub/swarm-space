

## Fix Brain: stand on Earth as a human, see each other's chosen avatars

The previous plans missed two physical realities:

1. The physics engine (`uqrcPhysics`) treats Earth as an attractor field, not a solid surface. The self body is anchored at `EARTH_RADIUS + 0.04` but the camera/avatar is rendered as if floating, not standing. We need a **humanoid stance**: feet on the surface, head ~1.7m above, upright relative to the surface normal.
2. Remote bodies are spawned as generic placeholders, not the **dragon/rabbit/etc. avatar each peer chose** in the entry modal. The avatar choice is saved to local prefs but never broadcast over the room, so peers can't render each other correctly.

### 1. Stand on Earth like a human (physics + render)

**`src/lib/brain/earth.ts`**
- Add `HUMAN_HEIGHT = 1.7` and `FEET_OFFSET = 0` constants.
- `spawnOnEarth(id, pose)` returns a position at `EARTH_RADIUS + HUMAN_HEIGHT/2` (body center), so feet land at the surface and head is ~1.7m up.
- Add helper `getSurfaceFrame(pos, pose)` returning `{ up, forward, right }` orthonormal basis at that point on the sphere — used by camera and avatar orientation.

**`src/lib/uqrc/field3D.ts` / physics integration in `BrainUniverse.tsx`**
- After every physics step, for `kind: 'self'` and `kind: 'remote-avatar'` bodies on Earth, **clamp** the position to the surface shell `[EARTH_RADIUS, EARTH_RADIUS + HUMAN_HEIGHT]` instead of letting attractor fields pull them inside or fling them out. This is a hard kinematic constraint, not a soft pin — the user reported they spawn *inside* or *outside* the planet, which means the attractor alone is not sufficient.
- Zero the radial velocity component when clamped (keep tangential motion for walking later).

**Camera (`PhysicsCameraRig` in `BrainUniverse.tsx`)**
- Position camera at body center + `up * 0.3` (eye height above body center).
- Orient with `up` = surface normal, look along `forward` tangent.
- Use `camera.up.copy(up)` then `camera.lookAt(pos + forward)` so horizon is level and Earth curves below — not a top-down view of the planet.

### 2. Broadcast and render the chosen avatar per peer

**`src/lib/streaming/webrtcSignalingBridge.standalone.ts`** — already carries room chat. Add a tiny presence message type alongside chat:
- `sendRoomPresence(roomId, { peerId, username, avatarId, color })` and `onRoomPresence(handler)`.
- On `peer-joined`, every peer rebroadcasts its own presence so late joiners learn existing avatars.

**`src/hooks/useBrainVoice.ts`**
- On `joinRoom` success, immediately call `sendRoomPresence` with `loadHubPrefs().avatarId` and username.
- Subscribe to `onRoomPresence`; expose `participants` enriched with `{ avatarId }`.
- Re-broadcast presence when a new `peer-joined` event fires.

**`src/components/brain/RemoteAvatarBody.tsx`**
- Accept `avatarId` prop; switch between `Dragon`, `Rabbit`, etc. from `src/lib/virtualHub/avatars/*` (same components the entry modal uses).
- Orient the avatar group using `getSurfaceFrame(pos, pose)` so it stands upright on the curved surface, not lying sideways in world space.
- Render a small floating username label above the head.

**`BrainUniverse.tsx` BodyLayer**
- For each `voicePeer`, create/update a physics body of `kind: 'remote-avatar'` anchored to the same Earth surface clamp as the self body, positioned in a small ring around the local user (existing logic), but now passing `participant.avatarId` into `RemoteAvatarBody`.

### 3. Don't fight the entry modal

Keep the existing modal flow intact — just guarantee that whatever avatar the user picks is:
1. Saved to `loadHubPrefs/saveHubPrefs` (already done).
2. Used to render the **local** body (currently the local body is invisible/first-person, which is fine — but the chosen `avatarId` must be in prefs before voice joins).
3. Broadcast over the room as soon as voice joins (new presence message above).

### Files touched

- `src/lib/brain/earth.ts` — add `HUMAN_HEIGHT`, `getSurfaceFrame`, fix `spawnOnEarth` height
- `src/pages/BrainUniverse.tsx` — surface clamp in physics loop, camera up/lookAt fix, pass `avatarId` to remote bodies
- `src/components/brain/RemoteAvatarBody.tsx` — render real avatar by `avatarId`, orient to surface normal, label
- `src/hooks/useBrainVoice.ts` — broadcast + receive presence (avatarId, username)
- `src/lib/streaming/webrtcSignalingBridge.standalone.ts` — add `sendRoomPresence` / `onRoomPresence`
- `src/lib/brain/__tests__/earth.test.ts` — assert feet land at `EARTH_RADIUS`, head at `~+1.7m`, surface frame is orthonormal

### Acceptance

```text
1. After entering /brain, the camera is at human eye height (~1.7m above the surface), horizon is level, Earth curves away below — no top-down view, no floating in space, no clipping inside the planet.
2. Radial position is hard-clamped to [EARTH_RADIUS, EARTH_RADIUS + 1.7m]; physics attractors no longer push the body off-surface.
3. The avatar selected in the entry modal (dragon/rabbit/etc.) is broadcast to the room within 1s of voice join.
4. Every other user in /brain renders as their actual selected avatar mesh, oriented upright on the Earth's surface, with their username floating above.
5. Late joiners receive presence rebroadcasts and see existing peers' avatars within ~2s.
6. Existing earth.test.ts and uqrcConformance.test.ts pass; new surface-frame and stance tests pass.
```

