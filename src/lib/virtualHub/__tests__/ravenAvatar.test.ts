import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Euler, Vector3 } from 'three';
import {
  AVATAR_REGISTRY,
  getAvatarById,
  getAvatarMassFromId,
} from '../avatars';
import {
  BEAK_ROOT,
  BEAK_TIP,
  BODY_CENTER,
  BODY_RADIUS,
  BODY_SCALE,
  BODY_TILT,
  HEAD_CENTER,
  HEAD_RADIUS,
  LEGS,
  NECK,
  TAIL,
  TOES,
  WINGS,
  limbBetween,
  ravenAvatar,
  type RavenLimb,
} from '../avatars/raven';

type Vec3 = [number, number, number];

/** Where a +Y capsule with this pose actually puts its two ends. */
function capsuleEnds(limb: RavenLimb): [Vector3, Vector3] {
  const axis = new Vector3(0, 1, 0).applyEuler(new Euler(...limb.rotation, 'XYZ'));
  const centre = new Vector3(...limb.position);
  const half = axis.multiplyScalar(limb.length / 2);
  return [centre.clone().sub(half), centre.clone().add(half)];
}

/** < 1 inside the tilted body ellipsoid, 1 on its surface, > 1 outside. */
function bodyLevel(p: Vec3): number {
  const local = new Vector3(...p)
    .sub(new Vector3(...BODY_CENTER))
    .applyEuler(new Euler(-BODY_TILT, 0, 0, 'XYZ'));
  return (
    (local.x / (BODY_RADIUS * BODY_SCALE[0])) ** 2 +
    (local.y / (BODY_RADIUS * BODY_SCALE[1])) ** 2 +
    (local.z / (BODY_RADIUS * BODY_SCALE[2])) ** 2
  );
}

function insideHead(p: Vec3): boolean {
  return new Vector3(...p).distanceTo(new Vector3(...HEAD_CENTER)) < HEAD_RADIUS;
}

function collectMeshes(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => collectMeshes(n, out));
  } else if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === 'mesh') out.push(el);
    if (typeof el.type === 'function') {
      collectMeshes((el.type as (p: unknown) => ReactNode)(el.props), out);
    } else {
      collectMeshes(el.props.children, out);
    }
  }
  return out;
}

describe('raven avatar', () => {
  it('is registered, selectable and lighter than the other forms', () => {
    expect(AVATAR_REGISTRY.map((a) => a.id)).toContain('raven');
    expect(getAvatarById('raven')).toBe(ravenAvatar);
    expect(ravenAvatar.unlocked).toBe(true);
    expect(getAvatarMassFromId('raven')).toBe(0.8);
    for (const other of AVATAR_REGISTRY.filter((a) => a.id !== 'raven')) {
      expect(ravenAvatar.mass!).toBeLessThan(other.mass ?? 1.8);
    }
  });

  it('keeps avatar ids unique so peers resolve the same form', () => {
    const ids = AVATAR_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('limbBetween aims a capsule exactly from one point to the other', () => {
    const cases: [Vec3, Vec3][] = [
      [[0, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [0, 0, 1]],
      [[0.1, 0.2, 0.3], [-0.4, 0.5, -0.2]],
      [[0, 0.5, 0], [0.3, 0.1, 0.25]],
    ];
    for (const [a, b] of cases) {
      const [s, e] = capsuleEnds(limbBetween(a, b, 0.1));
      expect(s.distanceTo(new Vector3(...a))).toBeLessThan(1e-9);
      expect(e.distanceTo(new Vector3(...b))).toBeLessThan(1e-9);
    }
  });

  it('roots every part inside the body or head (no floating pieces)', () => {
    expect(bodyLevel(NECK.from)).toBeLessThan(1);
    expect(insideHead(NECK.to)).toBe(true);
    expect(insideHead(BEAK_ROOT)).toBe(true);
    expect(insideHead(BEAK_TIP)).toBe(false);
    expect(bodyLevel(TAIL.from)).toBeLessThan(1);
    expect(bodyLevel(TAIL.to)).toBeGreaterThan(1);
    for (const leg of LEGS) expect(bodyLevel(leg.from)).toBeLessThan(1);
    for (const w of WINGS) expect(bodyLevel(w.position)).toBeLessThan(1);
  });

  it('joins every toe to its ankle and stands the feet on the ground', () => {
    expect(TOES).toHaveLength(LEGS.length * 4);
    TOES.forEach((toe, i) => {
      const leg = LEGS[Math.floor(i / 4)];
      expect(toe.from).toEqual(leg.to);
    });
    for (const limb of [...LEGS, ...TOES]) {
      const lowest = Math.min(limb.from[1], limb.to[1]) - limb.radius;
      expect(lowest).toBeGreaterThanOrEqual(0);
      expect(lowest).toBeLessThan(0.05);
    }
  });

  it('renders the same mesh tree for world and preview, using the peer color', () => {
    const world = collectMeshes(ravenAvatar.render({ scale: 1, color: '#ff0000' }));
    const preview = collectMeshes(ravenAvatar.preview({ scale: 0.9 }));
    expect(world.length).toBeGreaterThan(10);
    expect(preview.length).toBe(world.length);
    const colored = world.filter((m) => {
      const kids = ([] as ReactNode[]).concat(
        (m.props as { children?: ReactNode }).children,
      );
      return kids.some(
        (k) => isValidElement(k) && (k.props as { color?: string }).color === '#ff0000',
      );
    });
    // body, neck, head, two wings, tail
    expect(colored.length).toBe(6);
  });
});
