/**
 * BuildGridOverlay — world-anchored ground-grid disk that follows the
 * player and hugs actual terrain. Visible only in Builder Mode.
 *
 * Anchoring (UQRC): the lattice is a discrete sampling of the local
 * tangent connection `𝒟_μ u`, so the disk re-centres at the player's
 * foot every tick. The painted lines stay locked to *absolute* world
 * cells via a `uCellOffset` shader uniform measured against a fixed
 * lattice origin (`WORLD_GRID_ORIGIN_ANCHOR`), so as you walk, lines
 * slide under you rather than dragging with the mesh.
 *
 * Altitude (terrain hugging): the disk centre is lifted by
 * `sampleSurfaceLift(localNormal)` so it lays on the visible ground
 * instead of floating at the flat physics shell.
 *
 * Pure r3f — no DOM, no React state. Falls back to a fixed anchor
 * before the local body spawns.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  anchorOnEarth,
  earthLocalToWorld,
  getEarthPose,
  getEarthLocalSiteFrame,
  worldDisplacementToEarthLocal,
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { WALL_PITCH, GRID_RADIUS, WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';

interface BuildGridOverlayProps {
  /** Local peer id — the disk follows this body each frame. */
  selfId?: string;
  /** Anchor used before the local body spawns (and as lattice origin). */
  fallbackAnchorPeerId?: string;
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
  selfId,
  fallbackAnchorPeerId = WORLD_GRID_ORIGIN_ANCHOR,
  radius = GRID_RADIUS,
  color = '#94a3b8',
  majorColor = '#fbbf24',
  opacity = 0.7,
}: BuildGridOverlayProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Custom shader — radial-faded grid lines on a transparent disk.
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMajor: { value: WALL_PITCH },
        uRadius: { value: radius },
        uMajorColor: { value: new THREE.Color(majorColor) },
        uOpacity: { value: opacity },
        uCellOffset: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          // circleGeometry lies in the LOCAL XY plane (z = 0) and is
          // rotated into the world XZ plane by the parent mesh. Sample
          // the in-plane coords (x, y) so both grid axes vary —
          // reading position.z here would always be 0 and collapse the
          // grid to a single direction of stripes.
          vLocal = vec2(position.x, position.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vLocal;
        uniform float uMajor;
        uniform float uRadius;
        uniform vec3 uMajorColor;
        uniform float uOpacity;
        uniform vec2 uCellOffset;

        // Per-axis line mask. Clamps fwidth so grazing-angle axes don't
        // explode into a uniform flood — each axis renders as discrete
        // lines and we combine them with max() so both directions are
        // always visible (true 2D grid, not 1D stripes).
        float axisLine(float coord, float pitch, float lineW) {
          float fw = max(fwidth(coord / pitch), 1e-3);
          float d = abs(fract(coord / pitch - 0.5) - 0.5) / fw;
          return 1.0 - smoothstep(0.0, lineW, d);
        }

        void main() {
          float r = length(vLocal);
          float edge = 1.0 - smoothstep(uRadius * 0.65, uRadius, r);
          if (edge <= 0.001) discard;
          vec2 p = vLocal + uCellOffset;
          // Single wall-pitch lattice: one box = one wall = one plot cell.
          // Combine X- and Z-axis line masks so the ground reads as a
          // checker grid in every viewing direction.
          float lineX = axisLine(p.x, uMajor, 1.4);
          float lineZ = axisLine(p.y, uMajor, 1.4);
          float major = max(lineX, lineZ);
          float a = major * edge * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uMajorColor, a);
        }
      `,
    });
  }, [majorColor, opacity, radius]);

  // Scratch math vectors reused each frame.
  const tmp = useMemo(
    () => ({
      rightV: new THREE.Vector3(),
      upV: new THREE.Vector3(),
      fwdV: new THREE.Vector3(),
      basis: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const pose = getEarthPose();
    const physics = getBrainPhysics();
    const body = selfId ? physics.getBody(selfId) : undefined;

    // Lattice-origin frame (Earth-local) — fixed, shared across viewers.
    const refFrame = getEarthLocalSiteFrame(fallbackAnchorPeerId);

    let worldPos: [number, number, number];
    let up: [number, number, number];
    // Earth-local position of the disk centre — used to compute the
    // global tangent-plane offset against the lattice-origin frame.
    let localPos: [number, number, number];

    if (body) {
      // 1. Body world pos → Earth-local displacement → unit normal.
      const disp: [number, number, number] = [
        body.pos[0] - pose.center[0],
        body.pos[1] - pose.center[1],
        body.pos[2] - pose.center[2],
      ];
      const local = worldDisplacementToEarthLocal(disp, pose);
      const rN = Math.hypot(local[0], local[1], local[2]) || 1;
      const n: [number, number, number] = [local[0] / rN, local[1] / rN, local[2] / rN];

      // 2. Lift onto the visible terrain (matches surface-profile elevation).
      const lift = sampleSurfaceLift(n);
      const r = EARTH_RADIUS + lift + 0.02;
      localPos = [n[0] * r, n[1] * r, n[2] * r];
      worldPos = earthLocalToWorld(localPos, pose);
      // up = outward normal in world space.
      const wx = worldPos[0] - pose.center[0];
      const wy = worldPos[1] - pose.center[1];
      const wz = worldPos[2] - pose.center[2];
      const wR = Math.hypot(wx, wy, wz) || 1;
      up = [wx / wR, wy / wR, wz / wR];
    } else {
      // Pre-spawn: anchor to the fallback at body-shell height.
      const a = anchorOnEarth(fallbackAnchorPeerId, 0, 0, BODY_SHELL_RADIUS + 0.02, pose);
      worldPos = a.worldPos;
      up = a.up;
      // Lattice-origin's own local-normal position (this is also the
      // ref-frame origin, so the cell-offset below collapses to 0).
      localPos = [
        refFrame.normal[0] * EARTH_RADIUS,
        refFrame.normal[1] * EARTH_RADIUS,
        refFrame.normal[2] * EARTH_RADIUS,
      ];
    }

    // 3. Build a stable tangent basis at the disk centre (same ref-axis
    //    construction as anchorOnEarth, so it matches the rest of the
    //    world's tangent maths).
    const ref: [number, number, number] =
      Math.abs(up[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let rrx = ref[1] * up[2] - ref[2] * up[1];
    let rry = ref[2] * up[0] - ref[0] * up[2];
    let rrz = ref[0] * up[1] - ref[1] * up[0];
    const rrn = Math.hypot(rrx, rry, rrz) || 1;
    rrx /= rrn; rry /= rrn; rrz /= rrn;
    const fwdX = up[1] * rrz - up[2] * rry;
    const fwdY = up[2] * rrx - up[0] * rrz;
    const fwdZ = up[0] * rry - up[1] * rrx;

    tmp.rightV.set(rrx, rry, rrz);
    tmp.upV.set(up[0], up[1], up[2]);
    tmp.fwdV.set(fwdX, fwdY, fwdZ);
    tmp.basis.makeBasis(tmp.rightV, tmp.upV, tmp.fwdV);
    tmp.basis.setPosition(worldPos[0], worldPos[1], worldPos[2]);
    group.matrixAutoUpdate = false;
    group.matrix.copy(tmp.basis);

    // 4. Cell offset: project the disk-centre's Earth-local position
    //    onto the lattice-origin tangent basis. Within the ~40 m grid
    //    radius this dot product is metres-accurate (small-angle on the
    //    sphere), so lines paint on the same absolute world cells for
    //    every viewer regardless of who is standing where.
    const tx =
      localPos[0] * refFrame.right[0] +
      localPos[1] * refFrame.right[1] +
      localPos[2] * refFrame.right[2];
    const tz =
      localPos[0] * refFrame.forward[0] +
      localPos[1] * refFrame.forward[1] +
      localPos[2] * refFrame.forward[2];
    const off = material.uniforms.uCellOffset.value as THREE.Vector2;
    off.set(tx, tz);
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