/**
 * wetWorkSeed — deterministic blueprint for the grown habitat.
 *
 * Pure data. No physics writes here — the engine consumes this graph and
 * places real builder blocks for every node. Layout is parameterised by
 * the field reading at the seed site so calmer crusts grow wider chambers
 * and stronger plate stress thickens roots.
 */
export type WetWorkNodeKind =
  | 'root'
  | 'trunk'
  | 'rib'
  | 'chamber'
  | 'corridor';

export interface WetWorkNode {
  /** Stable id within the seed graph (kind + index suffix). */
  id: string;
  kind: WetWorkNodeKind;
  /** Tangent-plane offset from the anchor, metres. */
  rightOffset: number;
  forwardOffset: number;
  /** UQRC body mass — weight that node pushes into the field. */
  mass: number;
  /** Curvature basin radius (passed to physics.pinPiece). */
  basin: number;
  /** Radial growth scale (1 = baseline; >1 expands when crust calm). */
  scale: number;
  /** Rotation around local-up, radians. */
  yaw: number;
}

export interface WetWorkSeedSignals {
  /** Mean curvature magnitude at the surface site (sampled by growth). */
  crustCurvature: number;
  /** Plate stress proximity in [0,1] (1 = right at convergent boundary). */
  plateStress: number;
  /** Optional core breath phase in [-1,1] (sets growth wave timing only). */
  coreBreath: number;
}

export interface WetWorkSeedOptions {
  /** Anchor seed used for deterministic angles/sizes per habitat. */
  seed: string;
  /** Spread of branch ribs across the trunk circumference. */
  ribCount?: number;
  /** Number of chamber buds to grow off ribs. */
  chamberCount?: number;
}

function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * Build the growth graph. Pure function — same inputs always produce the
 * same node list. Caller (wetWorkGrowth.ts) feeds these nodes into the
 * BuilderBlockEngine; renderer subscribes to engine events.
 */
export function buildWetWorkSeed(
  signals: WetWorkSeedSignals,
  opts: WetWorkSeedOptions,
): WetWorkNode[] {
  const ribCount = opts.ribCount ?? 6;
  const chamberCount = opts.chamberCount ?? 4;
  const h = hash32(opts.seed);
  const nodes: WetWorkNode[] = [];

  // Calmer crust → larger chambers; stronger plate stress → denser ribs/roots.
  const calm = Math.max(0, 1 - Math.min(1, signals.crustCurvature));
  const stress = Math.max(0, Math.min(1, signals.plateStress));
  const chamberScale = 1 + 0.5 * calm;
  const ribMass = 4 + 6 * stress;
  const rootMass = 6 + 8 * stress;

  // 1. Trunk — central load-bearing spine, the only piece at the anchor.
  nodes.push({
    id: 'trunk-0',
    kind: 'trunk',
    rightOffset: 0,
    forwardOffset: 0,
    mass: 18,
    basin: 0.6,
    scale: 1 + 0.15 * calm,
    yaw: 0,
  });

  // 2. Roots — three roots spread around the trunk, biased outward.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + ((h >>> (i * 5)) & 0xff) / 0xff * 0.4;
    const r = 2.4;
    nodes.push({
      id: `root-${i}`,
      kind: 'root',
      rightOffset: Math.cos(angle) * r,
      forwardOffset: Math.sin(angle) * r,
      mass: rootMass,
      basin: 0.45,
      scale: 1 + 0.25 * stress,
      yaw: angle,
    });
  }

  // 3. Ribs — branch out around the trunk at mid height in the seed plane.
  for (let i = 0; i < ribCount; i++) {
    const angle = (i / ribCount) * Math.PI * 2;
    const r = 1.6 + 0.4 * (((h >>> (i * 3)) & 0xf) / 0xf);
    nodes.push({
      id: `rib-${i}`,
      kind: 'rib',
      rightOffset: Math.cos(angle) * r,
      forwardOffset: Math.sin(angle) * r,
      mass: ribMass,
      basin: 0.3,
      scale: 1,
      yaw: angle,
    });
  }

  // 4. Chambers — grown off the outer arc of the rib ring. Walking these
  //    chambers is the "interior" — the open space between them is the
  //    living branch tunnel network (corridors below).
  for (let i = 0; i < chamberCount; i++) {
    const angle = (i / chamberCount) * Math.PI * 2 + 0.3;
    const r = 4.0 + ((h >>> (i * 7)) & 0xff) / 0xff * 0.8;
    nodes.push({
      id: `chamber-${i}`,
      kind: 'chamber',
      rightOffset: Math.cos(angle) * r,
      forwardOffset: Math.sin(angle) * r,
      mass: 12,
      basin: 0.55,
      scale: chamberScale,
      yaw: angle + Math.PI,
    });
  }

  // 5. Corridor markers — small massless blocks at the chamber midpoints
  //    so the renderer knows where to draw branch tunnels (open tubes).
  for (let i = 0; i < chamberCount; i++) {
    const a0 = (i / chamberCount) * Math.PI * 2 + 0.3;
    const r0 = 4.0;
    const r1 = 1.6;
    const midR = (r0 + r1) / 2;
    nodes.push({
      id: `corridor-${i}`,
      kind: 'corridor',
      rightOffset: Math.cos(a0) * midR,
      forwardOffset: Math.sin(a0) * midR,
      mass: 1,
      basin: 0.18,
      scale: 1,
      yaw: a0,
    });
  }

  return nodes;
}
