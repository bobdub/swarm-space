import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type * as THREE from 'three';
import { AVATAR_REGISTRY } from '@/lib/virtualHub/avatars';
import { Text } from './SafeText';

/** Wait this long after the scene mounts, so warming never competes with entry. */
const WARMUP_DELAY_MS = 2_500;
/** Characters a nameplate usually needs, so their glyphs are ready too. */
const NAMEPLATE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 _-.…';

/**
 * Compiles every avatar's shader programs, and lays out a sample nameplate,
 * before anyone needs them. Without this the first peer to arrive as a cat
 * or raven (sheen and flat-shaded materials) made the GPU compile those
 * programs on the frame they appeared, and every new nameplate built its
 * glyphs right then: a visible hitch for everyone already in the Brain.
 *
 * The copies are never drawn (the group is hidden); `compileAsync` prepares
 * their materials against the scene's real lights, without blocking where
 * the browser supports parallel shader compilation. The copies stay mounted
 * for the life of the scene: three.js frees a shader program once no
 * material uses it, so unmounting them would throw the warm programs away
 * before the first cat or raven arrived.
 */
export function AvatarShaderWarmup(): JSX.Element {
  const { gl, scene, camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const group = groupRef.current;
      if (!group || cancelled) return;
      try {
        if (typeof gl.compileAsync === 'function') void gl.compileAsync(group, camera, scene).catch(() => undefined);
        else gl.compile(group, camera, scene);
      } catch { /* warming is best-effort */ }
    }, WARMUP_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [gl, scene, camera]);

  return (
    <group ref={groupRef} visible={false} matrixAutoUpdate={false}>
      {AVATAR_REGISTRY.map((avatar) => (
        <group key={avatar.id}>{avatar.render({ scale: 1, color: 'hsl(180, 70%, 60%)' })}</group>
      ))}
      <Billboard follow>
        <Text
          fontSize={0.2}
          color="hsl(210, 40%, 96%)"
          anchorX="center"
          anchorY="middle"
          maxWidth={3}
          outlineWidth={0.018}
          outlineColor="hsl(245, 70%, 8%)"
          outlineOpacity={0.85}
        >
          {NAMEPLATE_GLYPHS}
        </Text>
      </Billboard>
    </group>
  );
}
