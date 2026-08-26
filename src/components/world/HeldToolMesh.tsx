/**
 * HeldToolMesh — renders the tool the local player is holding as a real
 * 3-D object in their hand, and animates it on every swing.
 *
 * Position is derived from the player's physics body + intent basis, so
 * the tool tracks the avatar exactly the way `toolActions` computes its
 * swing point. Swing animation is driven by the same `swingFxBus` event
 * the FX layer listens to — one signal, two consumers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getHeldTool, subscribeHeldTool, type HeldTool } from '@/lib/world/heldToolStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { EYE_LIFT } from '@/lib/brain/earth';
import { subscribeSwingFx } from '@/lib/world/swingFxBus';

interface Props {
  selfId?: string;
}

export function HeldToolMesh({ selfId }: Props) {
  const [held, setHeld] = useState<HeldTool | null>(() => getHeldTool());
  useEffect(() => subscribeHeldTool(setHeld), []);

  const groupRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const swingStart = useRef(0);

  useEffect(() => subscribeSwingFx((fx) => {
    if (fx.variant === 'swing') swingStart.current = fx.startedAt;
  }), []);

  const prefab = held ? getPrefab(held.prefabId) : null;
  const tool = held ? getToolAny(held.prefabId) : null;

  const dims = useMemo(() => {
    const mass = tool?.mass ?? 1;
    // First-person held scale: the tool sits ~0.6 m from the eye, so it
    // needs to read at arm's length rather than at world scale.
    // Held at ~0.8 m from the eye: a 1.5 m handle filled a third of the
    // screen. Keep it reading as a tool, not a billboard.
    const handle = Math.max(0.28, Math.min(0.52, 0.24 + mass * 0.03));
    return { handle, head: Math.max(0.09, Math.min(0.17, 0.08 + mass * 0.012)) };
  }, [tool]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g || !selfId) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(selfId);
    const intent = physics.getIntent(selfId);
    const basis = intent?.basis;
    if (!body || !basis?.forward || !basis?.up) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const fwd = basis.forward;
    const up = basis.up;
    // right = forward × up
    const rx = fwd[1] * up[2] - fwd[2] * up[1];
    const ry = fwd[2] * up[0] - fwd[0] * up[2];
    const rz = fwd[0] * up[1] - fwd[1] * up[0];
    const rLen = Math.hypot(rx, ry, rz) || 1;

    // Anchor on the EYE (bodyPos + up × EYE_LIFT), not the body centre —
    // anchoring on the chest put the tool ~61° below a 60° fov frustum,
    // i.e. permanently off-screen.
    const bob = Math.sin(performance.now() / 900) * 0.03;
    const OUT = 0.78;   // forward from the eye
    const SIDE = 0.16;  // to the right hand (portrait fov is narrow)
    const DROP = 0.30 - bob;  // below eye line
    g.position.set(
      body.pos[0] + up[0] * EYE_LIFT + fwd[0] * OUT + (rx / rLen) * SIDE - up[0] * DROP,
      body.pos[1] + up[1] * EYE_LIFT + fwd[1] * OUT + (ry / rLen) * SIDE - up[1] * DROP,
      body.pos[2] + up[2] * EYE_LIFT + fwd[2] * OUT + (rz / rLen) * SIDE - up[2] * DROP,
    );

    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(rx / rLen, ry / rLen, rz / rLen),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(fwd[0], fwd[1], fwd[2]).multiplyScalar(-1),
    );
    g.quaternion.setFromRotationMatrix(m);


    // Swing animation — quick forward chop, eased return.
    const p = pivotRef.current;
    if (p) {
      const dt = (performance.now() - swingStart.current) / 380;
      const swing = dt >= 0 && dt <= 1 ? Math.sin(dt * Math.PI) : 0;
      p.rotation.x = -0.35 - swing * 1.5;
      p.rotation.z = swing * 0.25;
    }
  });

  if (!held || !prefab) return null;
  const headColor = prefab.color;

  return (
    <group ref={groupRef}>
      <group ref={pivotRef} scale={1.15}>
        {/* Handle */}
        <mesh position={[0, -dims.handle / 2, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.027, dims.handle, 8]} />
          <meshStandardMaterial color="#6b4f2a" roughness={0.9} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <boxGeometry args={[dims.head * 1.6, dims.head, dims.head * 0.45]} />
          <meshStandardMaterial
            color={headColor}
            roughness={0.35}
            metalness={0.55}
            emissive={headColor}
            emissiveIntensity={0.18}
          />
        </mesh>
        {/* Binding */}
        <mesh position={[0, -0.08, 0]}>
          <torusGeometry args={[0.05, 0.014, 6, 12]} />
          <meshStandardMaterial color="#3d2c18" roughness={1} />
        </mesh>
      </group>
    </group>
  );
}

export default HeldToolMesh;
