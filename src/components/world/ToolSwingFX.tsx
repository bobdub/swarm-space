/**
 * ToolSwingFX — Canvas-side visualiser for tool swings.
 *
 * Subscribes to `swingFxBus` and renders:
 *   • a brief expanding ring / arc at the swing point, and
 *   • a material-specific particle burst on impact (wood chips, stone
 *     sparks, soil clods, lifted petals, water splash, lava embers).
 *
 * Pure cosmetic; the physics outcome was already resolved by
 * `UqrcPhysics.swingAt(...)` + `applyImpact(...)` in toolActions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { subscribeSwingFx, type ImpactMaterial, type SwingFx } from '@/lib/world/swingFxBus';

export function ToolSwingFX() {
  const [fxList, setFxList] = useState<SwingFx[]>([]);

  useEffect(() => subscribeSwingFx((fx) => {
    setFxList((prev) => (prev.length > 24 ? [...prev.slice(-24), fx] : [...prev, fx]));
  }), []);

  useFrame(() => {
    const now = performance.now();
    setFxList((prev) => {
      const next = prev.filter((fx) => now - fx.startedAt < fx.durationMs + 520);
      return next.length === prev.length ? prev : next;
    });
  });

  return (
    <>
      {fxList.map((fx) => <SwingArc key={fx.id} fx={fx} />)}
    </>
  );
}

interface MaterialStyle {
  colors: [string, string];
  count: number;
  spread: number;
  rise: number;
  gravity: number;
  size: number;
  shape: 'chip' | 'spark' | 'clod' | 'petal' | 'drop';
}

const MATERIAL_STYLES: Record<ImpactMaterial, MaterialStyle> = {
  wood:  { colors: ['#a9762f', '#6b4f2a'], count: 19, spread: 3.36, rise: 2.6, gravity: 7.5, size: 0.18, shape: 'chip' },
  stone: { colors: ['#d9dee8', '#8b8f99'], count: 16, spread: 4.48, rise: 2.2, gravity: 9.0, size: 0.12, shape: 'spark' },
  soil:  { colors: ['#7b5a34', '#4a3520'], count: 22, spread: 2.52, rise: 2.9, gravity: 8.5, size: 0.22, shape: 'clod' },
  flora: { colors: ['#f7a8d8', '#7bd88f'], count: 14, spread: 1.54, rise: 1.6, gravity: 1.4, size: 0.16, shape: 'petal' },
  water: { colors: ['#8fd4ff', '#3f8fd0'], count: 25, spread: 2.8, rise: 3.0, gravity: 8.0, size: 0.14, shape: 'drop' },
  lava:  { colors: ['#ffb347', '#ff4d1a'], count: 19, spread: 3.08, rise: 3.4, gravity: 6.0, size: 0.18, shape: 'spark' },
  air:   { colors: ['#ffffff', '#c8d4ff'], count: 5,  spread: 1.2, rise: 1.0, gravity: 1.0, size: 0.1, shape: 'drop' },
};

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
      {fx.material && fx.material !== 'air' && (
        <ImpactBurst material={fx.material} startedAt={fx.startedAt} intensity={fx.intensity} />
      )}
      {fx.material === 'water' && <SplashRipple startedAt={fx.startedAt} />}
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

/**
 * Instanced particle burst. All particles share one draw call and one
 * geometry; per-frame work is a single matrix write per particle.
 */
function ImpactBurst({
  material,
  startedAt,
  intensity,
}: {
  material: ImpactMaterial;
  startedAt: number;
  intensity: number;
}) {
  const style = MATERIAL_STYLES[material];
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lifeMs = 900;

  const seeds = useMemo(() => {
    const out: { dir: THREE.Vector3; speed: number; spin: number }[] = [];
    for (let i = 0; i < style.count; i++) {
      const a = (i / style.count) * Math.PI * 2 + Math.random() * 0.4;
      const lift = 0.4 + Math.random() * 0.9;
      out.push({
        dir: new THREE.Vector3(Math.cos(a), lift, Math.sin(a)).normalize(),
        speed: style.spread * (0.5 + Math.random()) * (0.7 + intensity * 1.6),
        spin: (Math.random() - 0.5) * 8,
      });
    }
    return out;
  }, [style, intensity]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = Math.min(1.4, (performance.now() - startedAt) / lifeMs);
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const x = s.dir.x * s.speed * t;
      const z = s.dir.z * s.speed * t;
      const y = s.dir.y * style.rise * t - 0.5 * style.gravity * t * t;
      dummy.position.set(x, Math.max(-0.05, y), z);
      dummy.rotation.set(s.spin * t, s.spin * t * 0.6, 0);
      const shrink = Math.max(0, 1 - t / 1.2);
      dummy.scale.setScalar(style.size * (0.6 + shrink));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = Math.max(0, 1 - t / 1.2);
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, style.count]} frustumCulled={false}>
      {style.shape === 'spark' && <tetrahedronGeometry args={[1, 0]} />}
      {style.shape === 'chip' && <boxGeometry args={[1.6, 0.35, 0.9]} />}
      {style.shape === 'clod' && <dodecahedronGeometry args={[1, 0]} />}
      {style.shape === 'petal' && <circleGeometry args={[1, 6]} />}
      {style.shape === 'drop' && <sphereGeometry args={[1, 6, 6]} />}
      <meshStandardMaterial
        color={style.colors[0]}
        emissive={style.colors[1]}
        emissiveIntensity={material === 'lava' ? 1.6 : 0.15}
        roughness={0.8}
        transparent
        opacity={1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** Expanding flat ripple used for water impacts. */
function SplashRipple({ startedAt }: { startedAt: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current) return;
    const t = Math.min(1, (performance.now() - startedAt) / 1100);
    ref.current.scale.setScalar(0.4 + t * 2.6);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.5;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[0.6, 0.78, 24]} />
      <meshBasicMaterial color="#9fdcff" transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}

export default ToolSwingFX;
