import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPose } from '@/lib/brain/earth';
import { COSMO_COMPOUNDS } from '@/lib/brain/cosmoChemistry';

const SUN_LIGHT_COLOR = COSMO_COMPOUNDS.sun.color;

/**
 * The scene's real point-light Sun. It is not static: it rides the solar
 * system along Earth's galactic orbit while Earth revolves around it, so
 * its position is read from the shared-epoch pose every frame.
 */
export function SunLight() {
  const ref = useRef<THREE.PointLight>(null);
  const initial = getEarthPose().sun;
  useFrame(() => {
    const sun = getEarthPose().sun;
    ref.current?.position.set(sun[0], sun[1], sun[2]);
  });
  return (
    <pointLight
      ref={ref}
      position={initial}
      intensity={4500}
      decay={2}
      color={SUN_LIGHT_COLOR}
    />
  );
}
