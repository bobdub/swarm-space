import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { EARTH_RADIUS, SURFACE_TESS_CLEARANCE, getEarthPose, getSurfaceFrame, spawnOnEarth } from '@/lib/brain/earth';

/**
 * Scatters tall landmark pillars on the planet surface near the local
 * player's spawn so walking has unmistakable visual references. Pure
 * presentation: no physics, no field interaction.
 */
export function SurfaceLandmarks({ anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const itemRefs = useRef<(THREE.Mesh | null)[]>([]);

  const landmarks = useMemo(() => {
    const pose = getEarthPose();
    const anchor = spawnOnEarth(anchorPeerId, pose);
    const frame = getSurfaceFrame(anchor, pose);

    const items: { pos: [number, number, number]; up: [number, number, number]; height: number; hue: number }[] = [];
    // Ring of 12 tall pillars at 18m, plus an inner ring at 8m.
    const placeRing = (count: number, radius: number, heightBase: number) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (radius * 0.13);
        // Step along the surface tangent plane by `radius` meters.
        const tx = Math.cos(angle) * radius;
        const tz = Math.sin(angle) * radius;
        const local: [number, number, number] = [
          anchor[0] + frame.forward[0] * tz + frame.right[0] * tx,
          anchor[1] + frame.forward[1] * tz + frame.right[1] * tx,
          anchor[2] + frame.forward[2] * tz + frame.right[2] * tx,
        ];
        // Re-project that tangent step onto the actual sphere surface.
        const dx = local[0] - pose.center[0];
        const dy = local[1] - pose.center[1];
        const dz = local[2] - pose.center[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        // Match the apartment's tessellation clearance so pillars and
        // building share the same ground plane. Sphere is 48×32 segments
        // ⇒ triangulated mesh dips ~3.6 m below analytic radius between
        // vertices; lift by 4.5 m so bases never sink into the polygons.
        const k = (EARTH_RADIUS + SURFACE_TESS_CLEARANCE) / len;
        const surfacePos: [number, number, number] = [
          pose.center[0] + dx * k,
          pose.center[1] + dy * k,
          pose.center[2] + dz * k,
        ];
        const up: [number, number, number] = [dx / len, dy / len, dz / len];
        items.push({
          pos: surfacePos,
          up,
          height: heightBase + ((i * 37) % 7) * 0.8,
          hue: (i * 47) % 360,
        });
      }
    };
    placeRing(8, 6, 3);
    placeRing(12, 18, 6);
    placeRing(16, 40, 9);
    return items;
  }, [anchorPeerId]);

  useFrame(() => {
    if (!groupRef.current) return;
    const pose = getEarthPose();
    const anchor = spawnOnEarth(anchorPeerId, pose);
    const frame = getSurfaceFrame(anchor, pose);
    landmarks.forEach((lm, i) => {
      const mesh = itemRefs.current[i];
      if (!mesh) return;
      const angle = (i < 8)
        ? (i / 8) * Math.PI * 2 + (6 * 0.13)
        : i < 20
          ? (((i - 8) / 12) * Math.PI * 2 + (18 * 0.13))
          : (((i - 20) / 16) * Math.PI * 2 + (40 * 0.13));
      const radius = i < 8 ? 6 : i < 20 ? 18 : 40;
      const tx = Math.cos(angle) * radius;
      const tz = Math.sin(angle) * radius;
      const local: [number, number, number] = [
        anchor[0] + frame.forward[0] * tz + frame.right[0] * tx,
        anchor[1] + frame.forward[1] * tz + frame.right[1] * tx,
        anchor[2] + frame.forward[2] * tz + frame.right[2] * tx,
      ];
      const dx = local[0] - pose.center[0];
      const dy = local[1] - pose.center[1];
      const dz = local[2] - pose.center[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = (EARTH_RADIUS + SURFACE_TESS_CLEARANCE) / len;
      const surfacePos: [number, number, number] = [
        pose.center[0] + dx * k,
        pose.center[1] + dy * k,
        pose.center[2] + dz * k,
      ];
      const up: [number, number, number] = [dx / len, dy / len, dz / len];
      const upVec = new THREE.Vector3(up[0], up[1], up[2]);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
      mesh.position.set(
        surfacePos[0] + up[0] * (lm.height / 2),
        surfacePos[1] + up[1] * (lm.height / 2),
        surfacePos[2] + up[2] * (lm.height / 2),
      );
      mesh.quaternion.copy(quat);
    });
  });

  return (
    <group ref={groupRef}>
      {landmarks.map((lm, i) => {
        // Build orientation: align pillar's +Y to surface up.
        const upVec = new THREE.Vector3(lm.up[0], lm.up[1], lm.up[2]);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
        const euler = new THREE.Euler().setFromQuaternion(quat);
        // Position pillar so its base sits on the surface.
        const basePos: [number, number, number] = [
          lm.pos[0] + lm.up[0] * (lm.height / 2),
          lm.pos[1] + lm.up[1] * (lm.height / 2),
          lm.pos[2] + lm.up[2] * (lm.height / 2),
        ];
        return (
          <mesh
            key={i}
            ref={(node) => {
              itemRefs.current[i] = node;
            }}
            position={basePos}
            rotation={[euler.x, euler.y, euler.z]}
            castShadow
          >
            <cylinderGeometry args={[0.4, 0.6, lm.height, 8]} />
            <meshStandardMaterial
              color={`hsl(${lm.hue}, 60%, 55%)`}
              emissive={`hsl(${lm.hue}, 80%, 35%)`}
              emissiveIntensity={0.4}
              roughness={0.7}
            />
          </mesh>
        );
      })}
    </group>
  );
}