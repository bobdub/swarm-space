/**
 * BuildGridOverlay — translucent ground-grid disk pinned to an Earth
 * anchor's tangent frame, visible only while Builder Mode is active.
 *
 * The mesh is a flat disk at the anchor; its shader paints `CELL`-pitch
 * lines (with every `WALL_PITCH` line emphasised) and fades to zero at
 * the disk edge so it dissolves into the world. Because the disk is
 * positioned + oriented via `anchorOnEarth` each frame, it follows the
 * planet through spin/orbit and stays flush with the local ground.
 *
 * No DOM, no React state — pure r3f with a `useFrame` write to the
 * group's matrix. Safe to mount alongside SurfaceBar / NatureLayer.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { anchorOnEarth, getEarthPose, BODY_SHELL_RADIUS } from '@/lib/brain/earth';
import { CELL, WALL_PITCH, GRID_RADIUS } from '@/lib/world/buildGrid';

interface BuildGridOverlayProps {
  anchorPeerId: string;
  /** Tangent-plane offset of the disk centre from the anchor (m). */
  rightOffset?: number;
  forwardOffset?: number;
  /** Override the visible radius (m). */
  radius?: number;
  /** Tint color for grid lines (hex or css). */
  color?: string;
  /** Highlight color used for every WALL_PITCH line. */
  majorColor?: string;
  /** Optional opacity multiplier. */
  opacity?: number;
}

export function BuildGridOverlay({
  anchorPeerId,
  rightOffset = 0,
  forwardOffset = 0,
  radius = GRID_RADIUS,
  color = '#7dd3fc',
  majorColor = '#fbbf24',
  opacity = 0.55,
}: BuildGridOverlayProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Custom shader — radial-faded grid lines on a transparent disk.
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uCell: { value: CELL },
        uMajor: { value: WALL_PITCH },
        uRadius: { value: radius },
        uColor: { value: new THREE.Color(color) },
        uMajorColor: { value: new THREE.Color(majorColor) },
        uOpacity: { value: opacity },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          // The disk lies in the XZ plane of its local frame; pass the
          // XZ coords (≡ tangent right/forward) to the fragment shader.
          vLocal = vec2(position.x, position.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vLocal;
        uniform float uCell;
        uniform float uMajor;
        uniform float uRadius;
        uniform vec3 uColor;
        uniform vec3 uMajorColor;
        uniform float uOpacity;

        float gridMask(vec2 p, float pitch, float lineW) {
          vec2 g = abs(fract(p / pitch - 0.5) - 0.5) / fwidth(p / pitch);
          float m = min(g.x, g.y);
          return 1.0 - smoothstep(0.0, lineW, m);
        }

        void main() {
          float r = length(vLocal);
          float edge = 1.0 - smoothstep(uRadius * 0.65, uRadius, r);
          if (edge <= 0.001) discard;
          float minor = gridMask(vLocal, uCell, 1.0);
          float major = gridMask(vLocal, uMajor, 1.2);
          vec3 col = mix(uColor, uMajorColor, major);
          float a = max(minor * 0.55, major) * edge * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
    });
  }, [color, majorColor, opacity, radius]);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const pose = getEarthPose();
    const { worldPos, up, forward, right } = anchorOnEarth(
      anchorPeerId,
      rightOffset,
      forwardOffset,
      // Sit just above the body shell so the grid lays on the ground.
      BODY_SHELL_RADIUS + 0.02,
      pose,
    );
    // Build a basis matrix from (right, up, forward) so the disk's
    // local XZ plane coincides with the tangent plane at this anchor.
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    m.setPosition(worldPos[0], worldPos[1], worldPos[2]);
    group.matrixAutoUpdate = false;
    group.matrix.copy(m);
  });

  return (
    <group ref={groupRef}>
      {/* Disk lies in XZ; vertical Y axis = surface normal. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <circleGeometry args={[radius, 96]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}

export default BuildGridOverlay;