import { useEffect, useMemo, useRef } from 'react';
import { useGovernedFrame } from './useGovernedFrame';
import * as THREE from 'three';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { ventEmissionAt } from '@/lib/brain/eruptionCycle';
import { plumeParcelAt } from '@/lib/brain/volcanoEffects';
import type { VolcanoOrgan } from '@/lib/brain/volcanoOrgan';
import { windAt } from '@/lib/world/weather';

const PARCELS = 16;
const STEAM = new THREE.Color('hsl(0, 0%, 94%)');
const ASH = new THREE.Color('hsl(20, 6%, 28%)');

/**
 * Vent plume: small, expanding translucent parcels rather than a rigid
 * cone. Each parcel takes its colour and strength from what the vent was
 * emitting when it left (`ventEmissionAt` on the shared clock): faint
 * white fumarole steam most of the time, dark ash only during an eruption
 * or a slug burst near the surface. Parcels with nothing to show are
 * hidden, so a quiet volcano costs almost no draws.
 */
export function VolcanoAshPlume({ organ, altitude }: { organ: VolcanoOrgan; altitude: number }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 10, 8), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const frame = useMemo(() => new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(...organ.centerNormal),
  ).invert(), [organ]);
  const wind = useMemo(() => new THREE.Vector3(), []);
  const lastRead = useRef(-Infinity);

  useGovernedFrame('ambiance', 'volcano-ash', () => {
    const time = getEarthPoseTime();
    if (Math.abs(time - lastRead.current) >= 0.25) {
      wind.set(...windAt(organ.centerNormal, altitude)).applyQuaternion(frame);
      lastRead.current = time;
    }
    for (let i = 0; i < PARCELS; i++) {
      const mesh = meshes.current[i];
      if (!mesh) continue;
      const parcel = plumeParcelAt(time, i, PARCELS, [wind.x, 0, wind.z], ventEmissionAt);
      mesh.visible = parcel.opacity > 0.004;
      if (!mesh.visible) continue;
      mesh.position.set(...parcel.position);
      // Smooth expansion/billowing, with no frame-count-dependent motion.
      mesh.scale.set(parcel.radius * (1 + 0.12 * Math.sin(time + i)), parcel.radius * 0.85, parcel.radius);
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.opacity = parcel.opacity;
        mesh.material.color.copy(STEAM).lerp(ASH, parcel.ash);
      }
    }
  });

  return <group>{Array.from({ length: PARCELS }, (_, i) => (
    <mesh key={i} ref={(mesh) => { meshes.current[i] = mesh; }} geometry={geometry} visible={false}>
      <meshStandardMaterial color="hsl(0, 0%, 94%)" roughness={1} transparent opacity={0} depthWrite={false} />
    </mesh>
  ))}</group>;
}
