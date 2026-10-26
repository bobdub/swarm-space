import { Vector3, Matrix4, Quaternion } from 'three';
import { EARTH_RADIUS, getEarthLocalSiteFrame, getEarthPose, quatRotate, type EarthPose } from './earth';
import { groundElevationAt } from './groundHeight';
import { BAR_SITE } from './barTerrain';
import { type V3, type Q4 } from './spaceshipRules';

let site: V3 | undefined;
// The launchpad sits on existing dry ground, roughly at the bar's horizon.
export function shipSiteNormal(): V3 {
  if (site) return site;
  const frame = getEarthLocalSiteFrame(BAR_SITE.anchorId);
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI * 2 / 24;
    const n = new Vector3(...frame.normal).multiplyScalar(EARTH_RADIUS)
      .addScaledVector(new Vector3(...frame.right), BAR_SITE.rightOffset + Math.cos(angle) * 95)
      .addScaledVector(new Vector3(...frame.forward), BAR_SITE.forwardOffset + Math.sin(angle) * 95).normalize();
    const candidate = n.toArray() as V3;
    if (groundElevationAt(candidate) > 2) { site = candidate; return site; }
  }
  site = frame.normal; return site;
}
export function shipPadPose(pose: EarthPose = getEarthPose(), lift = 0): { position: V3; quaternion: Q4; up: V3 } {
  const normal = shipSiteNormal();
  const up = new Vector3(...quatRotate(pose.spinQuat, normal));
  const frame = getEarthLocalSiteFrame(BAR_SITE.anchorId);
  const fwd = new Vector3(...quatRotate(pose.spinQuat, frame.forward)).projectOnPlane(up).normalize();
  const right = new Vector3().crossVectors(fwd, up).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, fwd.clone().negate()));
  const position = up.clone().multiplyScalar(EARTH_RADIUS + groundElevationAt(normal) + 0.12 + lift).add(new Vector3(...pose.center));
  return { position: position.toArray() as V3, quaternion: q.toArray() as Q4, up: up.toArray() as V3 };
}