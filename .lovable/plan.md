# Make avatars turn to face the way they walk

Right now a character in the Brain always keeps one fixed facing. The only rotation applied is "stand upright on the curved ground" — nothing rotates the body around its own up-axis — so walking left, right or backwards slides the avatar sideways while it stares in the same direction.

## What the code shows

- `src/components/brain/RemoteAvatarBody.tsx:119-126` builds the avatar's rotation purely from the surface normal (`setFromUnitVectors(Y, up)`). There is no heading term at all.
- Your own character (`SelfAvatarBody`, `BrainUniverseScene.tsx:709-737`) renders through that same component, so it inherits the same missing turn.
- The component already keeps a smoothed Earth-relative position (`smoothRel`), which is the natural place to read travel direction from — it works identically for you and for other people, whose positions arrive as presence updates.

## Changes

### 1. Derive a heading from actual movement
In `RemoteAvatarBody`, each frame compare the smoothed Earth-relative position with the previous frame's. Project that displacement onto the local ground plane (remove the component along `up`). When the movement is above a small threshold (roughly a few millimetres per frame, so standing still doesn't cause spinning), that flattened direction becomes the target facing.

### 2. Combine upright + facing into one rotation
Build the target quaternion from a full surface basis: up = surface normal, forward = the travel direction, right = their cross product. When there is no recent movement, keep the last heading so an idle avatar holds its pose instead of snapping back.

### 3. Turn smoothly
Slerp toward the target rotation with the existing smoothing factor (`0.18`), so turns read as a body pivot rather than a snap. Seat-locked (`pinned`) avatars keep the current snap-and-hold behaviour — a seated peer must not spin on their stool.

### 4. Keep your own view consistent
Because your own avatar goes through the same component, over-the-shoulder view immediately shows your character turning as you strafe or back up. First-person is unaffected (the mesh is hidden there). The camera, controls and physics are untouched — this is presentation only.

## Verification

- Walk forward, strafe left/right, and back up in third person: the body should rotate to face travel within a fraction of a second, with no jitter when standing still.
- Watch a remote peer move: their avatar should also turn, driven by the same smoothed track.
- Sit on a stool: no rotation drift.

## Technical notes

No physics, intent or field changes; nothing new is broadcast over the mesh. Heading is inferred locally from the position track that already exists, so old clients and new clients stay compatible.
