/**
 * WeatherLayer — renders the water cycle produced by `lib/world/weather.ts`.
 *
 * Clouds are instanced puffs; rain is one instanced streak mesh per
 * raining cloud, capped and only rendered within the horizon band. All
 * state lives in the weather module — this component is view-only.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getWeather,
  startWeather,
  stopWeather,
  subscribeWeather,
  type WeatherCloud,
  type WeatherSnapshot,
} from '@/lib/world/weather';
import { EARTH_RADIUS, earthLocalToWorld, getEarthPose, quatRotate } from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { HORIZON_FADE_OUTER } from '@/lib/brain/horizonFade';

const RAIN_DROPS = 120;
const PUFFS = 7;

export function WeatherLayer() {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot>(() => getWeather());

  useEffect(() => {
    const stop = startWeather();
    const unsub = subscribeWeather(setSnapshot);
    return () => { unsub(); stop(); stopWeather(); };
  }, []);

  return (
    <>
      {snapshot.clouds.map((cloud) => <CloudBody key={cloud.id} cloud={cloud} />)}
    </>
  );
}

function CloudBody({ cloud }: { cloud: WeatherCloud }) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const [near, setNear] = useState(true);

  const puffs = useMemo(() => {
    const out: { pos: [number, number, number]; r: number }[] = [];
    for (let i = 0; i < PUFFS; i++) {
      const a = (i / PUFFS) * Math.PI * 2;
      out.push({
        pos: [
          Math.cos(a) * cloud.radius * 0.6,
          Math.sin(i * 1.7) * cloud.radius * 0.14,
          Math.sin(a) * cloud.radius * 0.6,
        ],
        r: cloud.radius * (0.42 + ((i * 37) % 11) / 32),
      });
    }
    return out;
  }, [cloud.radius]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    const r = EARTH_RADIUS + sampleSurfaceLift(cloud.normal) + cloud.altitude;
    const world = earthLocalToWorld(
      [cloud.normal[0] * r, cloud.normal[1] * r, cloud.normal[2] * r],
      pose,
    );
    g.position.set(world[0], world[1], world[2]);
    const worldN = quatRotate(pose.spinQuat, cloud.normal);
    g.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(worldN[0], worldN[1], worldN[2]).normalize(),
    );
    const dist = camera.position.distanceTo(g.position);
    const shouldShow = dist < HORIZON_FADE_OUTER * 2.2;
    if (shouldShow !== near) setNear(shouldShow);
  });

  const tone = cloud.raining ? '#5b6474' : '#cfd8e6';
  const opacity = cloud.raining ? 0.85 : 0.55 + Math.min(0.3, cloud.charge * 0.3);

  return (
    <group ref={groupRef} visible={near}>
      {puffs.map((p, i) => (
        <mesh key={i} position={p.pos}>
          <sphereGeometry args={[p.r, 10, 8]} />
          <meshStandardMaterial color={tone} roughness={1} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      ))}
      {cloud.raining && <RainColumn altitude={cloud.altitude} radius={cloud.radius} />}
      {cloud.raining && <GroundRipples altitude={cloud.altitude} radius={cloud.radius} />}
    </group>
  );
}

/** Falling streaks between the cloud base and the ground below it. */
function RainColumn({ altitude, radius }: { altitude: number; radius: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () => Array.from({ length: RAIN_DROPS }, () => ({
      x: (Math.random() * 2 - 1) * radius,
      z: (Math.random() * 2 - 1) * radius,
      phase: Math.random(),
      speed: 0.55 + Math.random() * 0.5,
    })),
    [radius],
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const f = (s.phase + t * s.speed) % 1;
      dummy.position.set(s.x, -f * altitude, s.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, RAIN_DROPS]} frustumCulled={false}>
      <boxGeometry args={[0.05, 1.4, 0.05]} />
      <meshBasicMaterial color="#a8cdf0" transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}

/** Splash rings where rain lands. */
function GroundRipples({ altitude, radius }: { altitude: number; radius: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const rings = useMemo(
    () => Array.from({ length: 8 }, () => ({
      x: (Math.random() * 2 - 1) * radius,
      z: (Math.random() * 2 - 1) * radius,
      phase: Math.random(),
    })),
    [radius],
  );

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.children.forEach((child, i) => {
      const f = (rings[i].phase + t * 0.9) % 1;
      child.scale.setScalar(0.3 + f * 1.8);
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - f) * 0.4;
    });
  });

  return (
    <group ref={groupRef} position={[0, -altitude + 0.05, 0]}>
      {rings.map((r, i) => (
        <mesh key={i} position={[r.x, 0, r.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.5, 14]} />
          <meshBasicMaterial color="#bfe4ff" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export default WeatherLayer;
