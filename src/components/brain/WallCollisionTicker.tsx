/**
 * WallCollisionTicker — avatar-vs-AABB post-integration correction.
 *
 * Runs one useFrame per tick, reads the local avatar body from physics,
 * projects its position into each registered collider's village-local
 * frame using the exact math BuilderBlockView uses (radial up, tangent
 * right/forward from getEarthLocalSiteFrame, re-orthonormalised), and
 * applies a horizontal minimum-translation-vector correction so the
 * avatar cannot pass through wall boxes. Only the `self` body is
 * touched; NPCs, remote avatars, and every non-self body are ignored.
 *
 * No forces, no field writes. Just position + wall-normal velocity kill.
 */
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import {
  FEET_SHELL_RADIUS,
  getEarthPose,
  getLiveSiteFrame,
  worldDisplacementToEarthLocal,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { listWallColliders, type WallColliderSpec } from '@/lib/brain/wallColliders';

const AVATAR_R = 0.35; // horizontal capsule radius
const AVATAR_H = 1.7;  // capsule height (feet at upOffset 0, head at 1.7)
const EPS = 1e-6;

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Build the shared village-local basis used by movement/camera and block
 * anchoring. Wall extents live in this anchor frame; using the avatar's
 * changing tangent basis here lets the collider rotate underfoot and miss.
 */
function siteBasis(anchorPeerId: string, bodyPos: Vec3): {
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  groundRadius: number;
} {
  const pose = getEarthPose();
  const origin: Vec3 = [pose.center[0], pose.center[1], pose.center[2]];
  const rel = sub(bodyPos, origin);
  const rLen = Math.hypot(rel[0], rel[1], rel[2]) || 1;
  const up: Vec3 = [rel[0] / rLen, rel[1] / rLen, rel[2] / rLen];
  const local = worldDisplacementToEarthLocal(rel, pose);
  const localLen = Math.hypot(local[0], local[1], local[2]) || 1;
  const localNormal: Vec3 = [local[0] / localLen, local[1] / localLen, local[2] / localLen];
  const groundRadius = FEET_SHELL_RADIUS + sampleSurfaceLift(localNormal);
  const live = getLiveSiteFrame(anchorPeerId, pose);
  let forward: Vec3 = [live.forward[0], live.forward[1], live.forward[2]];
  const d = dot(forward, up);
  forward = norm([forward[0] - up[0] * d, forward[1] - up[1] * d, forward[2] - up[2] * d]);
  const right: Vec3 = norm(cross(forward, up));
  return { origin, right, up, forward, groundRadius };
}

export function WallCollisionTicker({ selfId }: { selfId: string }) {
  const physics = useMemo(() => getBrainPhysics(), []);

  useFrame(() => {
    if (!selfId) return;
    const body = physics.getBody(selfId);
    if (!body) return;
    const colliders = listWallColliders();
    if (colliders.length === 0) return;

    const bodyPos: Vec3 = [body.pos[0], body.pos[1], body.pos[2]];

    // Group colliders by anchor so we only build the basis once per anchor.
    const byAnchor = new Map<string, WallColliderSpec[]>();
    for (const c of colliders) {
      const list = byAnchor.get(c.anchorPeerId);
      if (list) list.push(c);
      else byAnchor.set(c.anchorPeerId, [c]);
    }

    let totalDR = 0;
    let totalDF = 0;
    // Track the strongest wall normal in world space for velocity correction.
    let normalWorld: Vec3 | null = null;
    let normalPenetration = 0;

    for (const [anchorPeerId, specs] of byAnchor) {
      const basis = siteBasis(anchorPeerId, bodyPos);
      const rel = sub(bodyPos, basis.origin);
      let rL = dot(rel, basis.right);
      let fL = dot(rel, basis.forward);
      // Colliders store `upOffset` in metres above local visible ground,
      // not absolute radius from Earth's centre. The previous comparison
      // used the full ~1700m Earth radius here, so vertical overlap was
      // always false and the avatar could phase through every wall.
      const radialL = dot(rel, basis.up);
      const uL = radialL - basis.groundRadius;

      // Resolve strongest overlap first for stability.
      const overlaps = specs.map((c) => {
        const dr = rL - c.rightOffset;
        const df = fL - c.forwardOffset;
        const du = uL - c.upOffset;
        const expR = c.halfRight + AVATAR_R;
        const expF = c.halfForward + AVATAR_R;
        const expU = c.halfUp + AVATAR_H / 2;
        const penR = expR - Math.abs(dr);
        const penF = expF - Math.abs(df);
        const penU = expU - Math.abs(du);
        return { c, dr, df, penR, penF, penU };
      })
      .filter((o) => o.penR > 0 && o.penF > 0 && o.penU > 0)
      .sort((a, b) => Math.min(b.penR, b.penF) - Math.min(a.penR, a.penF));

      for (const o of overlaps) {
        // Re-evaluate against the (possibly already corrected) position.
        const dr = (rL - o.c.rightOffset);
        const df = (fL - o.c.forwardOffset);
        const expR = o.c.halfRight + AVATAR_R;
        const expF = o.c.halfForward + AVATAR_R;
        const penR = expR - Math.abs(dr);
        const penF = expF - Math.abs(df);
        if (penR <= 0 || penF <= 0) continue;
        // Push out along the shallowest horizontal axis (MTV).
        if (penR < penF) {
          const push = dr >= 0 ? penR : -penR;
          rL += push;
          totalDR += push;
          if (penR > normalPenetration) {
            normalPenetration = penR;
            const sign = dr >= 0 ? 1 : -1;
            normalWorld = [
              basis.right[0] * sign,
              basis.right[1] * sign,
              basis.right[2] * sign,
            ];
          }
        } else {
          const push = df >= 0 ? penF : -penF;
          fL += push;
          totalDF += push;
          if (penF > normalPenetration) {
            normalPenetration = penF;
            const sign = df >= 0 ? 1 : -1;
            normalWorld = [
              basis.forward[0] * sign,
              basis.forward[1] * sign,
              basis.forward[2] * sign,
            ];
          }
        }
      }

      if (Math.abs(totalDR) > EPS || Math.abs(totalDF) > EPS) {
        // Write corrected position back to world using the same basis.
        body.pos[0] = basis.origin[0] + basis.right[0] * rL + basis.up[0] * radialL + basis.forward[0] * fL;
        body.pos[1] = basis.origin[1] + basis.right[1] * rL + basis.up[1] * radialL + basis.forward[1] * fL;
        body.pos[2] = basis.origin[2] + basis.right[2] * rL + basis.up[2] * radialL + basis.forward[2] * fL;
        totalDR = 0;
        totalDF = 0;
      }
    }

    // Kill wall-normal velocity component so the avatar slides instead of
    // pushing into the wall.
    if (normalWorld) {
      const vn = body.vel[0] * normalWorld[0] + body.vel[1] * normalWorld[1] + body.vel[2] * normalWorld[2];
      if (vn < 0) {
        body.vel[0] -= vn * normalWorld[0];
        body.vel[1] -= vn * normalWorld[1];
        body.vel[2] -= vn * normalWorld[2];
      }
    }
  });

  return null;
}

export default WallCollisionTicker;