/**
 * ToolSwingFX — Canvas-side visualiser for tool swings.
 *
 * Subscribes to `swingFxBus` and renders a brief expanding ring at the
 * swing point so the user can SEE the swing in front of them. Pure
 * cosmetic; the physics outcome was already resolved by
 * `UqrcPhysics.swingAt(...)` in toolActions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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
  const accent = useMemo(() => new THREE.Color(fx.color), [fx.color]);
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
    const scale = fx.variant === 'impact'
      ? 0.28 + ease * (0.55 + fx.intensity * 1.15)
      : 0.4 + ease * (0.8 + fx.intensity * 1.5);
    ref.current.scale.setScalar(scale);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = (1 - t) * 0.85;
  });

  return (
    <group position={fx.point} quaternion={quat.current}>
      <mesh ref={ref}>
        {fx.variant === 'impact'
          ? <ringGeometry args={[fx.radius * 0.72, fx.radius, 24]} />
          : <torusGeometry args={[fx.radius, fx.radius * 0.18, 8, 24, Math.PI]} />}
        <meshBasicMaterial color={accent} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {fx.variant === 'impact' && (
        <mesh>
          <sphereGeometry args={[Math.max(0.08, fx.radius * 0.14), 12, 12]} />
          <meshBasicMaterial color={fx.success ? accent : '#ffffff'} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
      {fx.label && (
        <Html position={[0, fx.radius * 1.3, 0]} center distanceFactor={10}>
          <div
            style={{
              padding: '2px 6px',
              borderRadius: 999,
              background: 'rgba(5, 8, 20, 0.78)',
              border: `1px solid ${fx.color}`,
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              letterSpacing: 0,
            }}
          >
            {fx.label}
          </div>
        </Html>
      )}
    </group>
  );
}

export default ToolSwingFX;