import { EARTH_RADIUS, getEarthLocalSiteFrame, type Vec3 } from './earth';
import { LAND_LIFT } from './surfaceProfile';

export const BAR_SITE = {
  anchorId: 'swarm-shared-village',
  rightOffset: -22,
  forwardOffset: 26,
  halfWidth: 12,
  halfDepth: 10,
} as const;

let siteNormal: Vec3 | undefined;
export function getBarGroundNormal(): Vec3 {
  if (siteNormal) return siteNormal;
  const frame = getEarthLocalSiteFrame(BAR_SITE.anchorId);
  const raw: Vec3 = frame.normal.map((v, i) =>
    v * EARTH_RADIUS + frame.right[i] * BAR_SITE.rightOffset + frame.forward[i] * BAR_SITE.forwardOffset,
  ) as Vec3;
  const length = Math.hypot(...raw);
  siteNormal = [raw[0] / length, raw[1] / length, raw[2] / length];
  return siteNormal;
}

/** A dry tangent-plane foundation, feathered into the surrounding terrain.
 * The level region includes a mesh-cell margin around the 24 × 20 m bar.
 */
export function barFoundationElevation(localN: Vec3, original: number): number {
  const normal = getBarGroundNormal();
  const dot = normal[0] * localN[0] + normal[1] * localN[1] + normal[2] * localN[2];
  const distance = Math.acos(Math.max(-1, Math.min(1, dot))) * EARTH_RADIUS;
  if (distance >= 110) return original;
  const planeElevation = (EARTH_RADIUS + LAND_LIFT) / dot - EARTH_RADIUS;
  const t = Math.max(0, Math.min(1, (distance - 65) / 45));
  const blend = t * t * (3 - 2 * t);
  return planeElevation * (1 - blend) + original * blend;
}