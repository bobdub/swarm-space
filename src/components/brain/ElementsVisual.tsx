/**
 * ElementsVisual — renders the periodic shell structure baked into the field.
 * Pure presentation: reads from buildElements() and draws rings + spheres.
 * Never mutates body state or the field.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  getElements,
  SHELL_DEFS,
  type ElementSpec,
} from '@/lib/brain/elements';

// Shell color palette (HSL strings → THREE colors).
const SHELL_COLORS: Record<number, string> = {
  0: 'hsl(0, 0%, 95%)',         // boundary — white
  1: 'hsl(180, 80%, 60%)',      // cyan
  2: 'hsl(265, 75%, 70%)',      // violet
  3: 'hsl(40, 90%, 65%)',       // amber
  4: 'hsl(310, 80%, 70%)',      // magenta inner
};

function colorFor(shell: number): string {
  return SHELL_COLORS[shell] ?? SHELL_COLORS[4];
}

function ShellRing({ radius, yOffset, color }: { radius: number; yOffset: number; color: string }) {
  const lineObj = useMemo(() => {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2, false, 0);
    const pts = curve.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
    return new THREE.LineLoop(geometry, material);
  }, [radius, color]);
  return <primitive object={lineObj} position={[0, yOffset, 0]} />;
}

function ElementPin({
  el,
  showLabel,
  pulse,
}: {
  el: ElementSpec;
  showLabel: boolean;
  pulse: boolean;
}) {
  const haloRef = useRef<THREE.Mesh>(null);
  const color = colorFor(el.shell);
  const isInner = el.role === 'inner';
  const radius = isInner ? 0.12 : el.role === 'boundary' ? 0.32 : 0.22;

  useFrame((state) => {
    if (pulse && haloRef.current) {
      const t = state.clock.elapsedTime;
      const s = 1 + 0.25 * Math.sin(t * 2 + el.id);
      haloRef.current.scale.setScalar(s);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.25 + 0.15 * Math.sin(t * 2 + el.id);
    }
  });

  return (
    <group position={el.pos}>
      <mesh>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={el.role === 'closure' ? 0.9 : 0.5}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      {pulse && (
        <mesh ref={haloRef}>
          <sphereGeometry args={[radius * 1.8, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}
      {showLabel && (
        <Text
          position={[0, radius + 0.35, 0]}
          fontSize={0.28}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="hsl(265, 70%, 8%)"
        >
          {el.symbol}
        </Text>
      )}
    </group>
  );
}

function InnerSpiralCluster({ elements }: { elements: ElementSpec[] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.18;
  });
  return (
    <group ref={groupRef}>
      {elements.map((el) => (
        <ElementPin key={el.id} el={el} showLabel={false} pulse={false} />
      ))}
    </group>
  );
}

export function ElementsVisual() {
  const isMobile = useIsMobile();
  const { elements, innerSpiral } = useMemo(() => getElements(), []);
  const shellElements = useMemo(
    () => elements.filter((e) => e.shell < 4),
    [elements],
  );

  return (
    <group>
      {/* Shell ring guides (n=1..3). */}
      {SHELL_DEFS.filter((s) => s.n >= 1).map((s) => (
        <ShellRing
          key={`ring-${s.n}`}
          radius={s.radius}
          yOffset={s.yOffset}
          color={colorFor(s.n)}
        />
      ))}

      {shellElements.map((el) => {
        const isClosure = el.role === 'closure';
        const isBoundary = el.role === 'boundary';
        // Mobile: only show labels for boundary + closure pins to keep the
        // 360-px viewport readable. Desktop: show all shell-element labels.
        const showLabel = !isMobile || isBoundary || isClosure;
        return (
          <ElementPin
            key={el.id}
            el={el}
            showLabel={showLabel}
            pulse={isClosure}
          />
        );
      })}

      <InnerSpiralCluster elements={innerSpiral} />
    </group>
  );
}
