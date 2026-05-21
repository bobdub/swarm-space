/**
 * ToolSwingFX — Canvas-side visualiser for tool swings.
 *
 * Subscribes to `swingFxBus` and renders a brief expanding ring at the
 * swing point so the user can SEE the swing in front of them. Pure
 * cosmetic; the physics outcome was already resolved by
 * `UqrcPhysics.swingAt(...)` in toolActions.
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { subscribeSwingFx, type SwingFx } from '@/lib/world/swingFxBus';

export function ToolSwingFX() {
  const [fxList, setFxList] = useState<SwingFx[]>([]);

  useEffect(() => subscribeSwingFx((fx) => {
    setFxList((prev) => [...prev, fx]);
  }), []);

  useFrame(() => {
    const now = performance.now();
    setFxList((prev) => {
      const next = prev.filter((fx) => now - fx.startedAt < fx.durationMs);
      return next.length === prev.length ? prev : next;
    });
  });

  return (
    <>
      {fxList.map((fx) => <SwingArc key={fx.id} fx={fx} />)}
    </>
  );
}

function SwingArc({ fx }: { fx: SwingFx }) {
  const ref = useRef<THREE.Mesh>(null);
  // Orient the ring so its plane is perpendicular to the local up (i.e.
  // the swing reads as a horizontal arc in front of the user).
  const quat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  useEffect(() => {
    const up = new THREE.Vector3(fx.up[0], fx.up[1], fx.up[2]).normalize();
    quat.current.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  }, [fx.up]);

  useFrame(() => {
    if (!ref.current) return;
    const t = Math.min(1, (performance.now() - fx.startedAt) / fx.durationMs);
    const ease = 1 - Math.pow(1 - t, 2);
    const scale = 0.4 + ease * (0.8 + fx.intensity * 1.5);
    ref.current.scale.setScalar(scale);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = (1 - t) * 0.85;
  });

  return (
    <mesh
      ref={ref}
      position={fx.point}
      quaternion={quat.current}
    >
      <torusGeometry args={[fx.radius, fx.radius * 0.18, 8, 24, Math.PI]} />
      <meshBasicMaterial color={fx.color} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}

export default ToolSwingFX;