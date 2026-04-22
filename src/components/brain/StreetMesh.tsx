import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPose, quatRotate } from '@/lib/brain/earth';
import {
  getStreet,
  STREET_LENGTH,
  STREET_CELL_SPACING,
} from '@/lib/brain/street';

/**
 * Renders the street + land patch on Earth's INNER shell as a CURVED
 * tessellated mesh. Each cell of `street.particles` is materialised as a
 * small quad whose vertices live on the STANDING sphere — i.e. exactly
 * the same sphere the body integrator clamps the avatar's feet to.
 * Geometry lives in Earth-LOCAL coords and is repositioned each frame
 * using the live Earth pose so the patch co-rotates with the planet.
 */
export function StreetMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const street = useMemo(() => getStreet(), []);

  // Build a tiny quad per particle, lifted slightly outward from the
  // shell to avoid z-fighting with the Earth crust mesh. We split road
  // and land into two BufferGeometries so they can use distinct
  // materials.
  const { roadGeom, landGeom, dashGeom } = useMemo(() => {
    const road: number[] = [];
    const land: number[] = [];
    const dash: number[] = [];
    const half = STREET_CELL_SPACING * 0.5;
    const lift = 0.005; // outward bias toward the cavity (along normalLocal)
    const t = street.tangentLocal;
    const b = street.bitangentLocal;
    for (const p of street.particles) {
      // Outward radial unit at this particle (== local-normalised since
      // local sits on STANDING sphere centered at origin).
      const r = Math.hypot(p.local[0], p.local[1], p.local[2]) || 1;
      const nx = p.local[0] / r, ny = p.local[1] / r, nz = p.local[2] / r;
      // Four quad corners in Earth-local coords. Tangent/bitangent are
      // shared (we accept tiny shear at far cells; visually negligible).
      // Inward bias so cells sit ABOVE the shell from inside POV (the
      // cavity side), not below.
      const cx = p.local[0] - nx * lift;
      const cy = p.local[1] - ny * lift;
      const cz = p.local[2] - nz * lift;
      const corners: [number, number, number][] = [
        [cx - t[0]*half - b[0]*half, cy - t[1]*half - b[1]*half, cz - t[2]*half - b[2]*half],
        [cx + t[0]*half - b[0]*half, cy + t[1]*half - b[1]*half, cz + t[2]*half - b[2]*half],
        [cx + t[0]*half + b[0]*half, cy + t[1]*half + b[1]*half, cz + t[2]*half + b[2]*half],
        [cx - t[0]*half + b[0]*half, cy - t[1]*half + b[1]*half, cz - t[2]*half + b[2]*half],
      ];
      // Two triangles: 0-1-2 and 0-2-3.
      const tri = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
      const target = p.kind === 'road' ? road : land;
      for (const c of tri) target.push(c[0], c[1], c[2]);
    }
    // Centre lane dashes — small quads laid on top of road cells along
    // the tangent axis at v ≈ 0.
    const dashHalfLen = STREET_LENGTH / 24;
    const dashHalfW = 0.09;
    const dashLift = lift + 0.003;
    for (let i = 0; i < 5; i++) {
      const along = -STREET_LENGTH / 2 + (i + 0.5) * (STREET_LENGTH / 5);
      // Centre point on the standing sphere along the tangent.
      const cxL = street.centerLocal[0] + t[0] * along;
      const cyL = street.centerLocal[1] + t[1] * along;
      const czL = street.centerLocal[2] + t[2] * along;
      const rr = Math.hypot(cxL, cyL, czL) || 1;
      const nx = cxL / rr, ny = cyL / rr, nz = czL / rr;
      // Project to standing sphere (centerLocal already is, but along-step
      // is straight-line; reproject for curvature) then lift.
      const targetR = Math.hypot(street.centerLocal[0], street.centerLocal[1], street.centerLocal[2]);
      const k = (targetR - dashLift) / rr;
      const cx = cxL * k, cy = cyL * k, cz = czL * k;
      const corners: [number, number, number][] = [
        [cx - t[0]*dashHalfLen - b[0]*dashHalfW, cy - t[1]*dashHalfLen - b[1]*dashHalfW, cz - t[2]*dashHalfLen - b[2]*dashHalfW],
        [cx + t[0]*dashHalfLen - b[0]*dashHalfW, cy + t[1]*dashHalfLen - b[1]*dashHalfW, cz + t[2]*dashHalfLen - b[2]*dashHalfW],
        [cx + t[0]*dashHalfLen + b[0]*dashHalfW, cy + t[1]*dashHalfLen + b[1]*dashHalfW, cz + t[2]*dashHalfLen + b[2]*dashHalfW],
        [cx - t[0]*dashHalfLen + b[0]*dashHalfW, cy - t[1]*dashHalfLen + b[1]*dashHalfW, cz - t[2]*dashHalfLen + b[2]*dashHalfW],
      ];
      const tri = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
      for (const c of tri) dash.push(c[0], c[1], c[2]);
    }
    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    };
    return { roadGeom: mk(road), landGeom: mk(land), dashGeom: mk(dash) };
  }, [street]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    // Geometry vertices already live in Earth-LOCAL coords. Just place
    // the group at the Earth center and apply the spin quaternion so the
    // patch co-rotates with the planet — same transform the body
    // integrator uses.
    g.position.set(pose.center[0], pose.center[1], pose.center[2]);
    g.quaternion.set(pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3]);
  });
  // suppress unused-import lint for quatRotate (kept for potential debug)
  void quatRotate;

  return (
    <group ref={groupRef}>
      <mesh geometry={landGeom}>
        <meshStandardMaterial
          color="hsl(120, 35%, 35%)"
          side={THREE.DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <mesh geometry={roadGeom}>
        <meshStandardMaterial
          color="hsl(0, 0%, 28%)"
          side={THREE.DoubleSide}
          roughness={0.7}
        />
      </mesh>
      <mesh geometry={dashGeom}>
        <meshBasicMaterial color="hsl(48, 90%, 55%)" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
