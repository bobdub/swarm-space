/**
 * wetWorkGrowth — drives the WetWork habitat through the BuilderBlockEngine.
 *
 * Replaces the static SurfaceApartmentV2 single-pin approach. Each node
 * from `buildWetWorkSeed` becomes a real builder block with mass + basin,
 * pinned to the field via the engine. Growth state advances through
 * `upgradeBlock` based on field signals — never by visual deformation.
 *
 * Phase 4D: the field decides the timing (coreBreath), the seed decides
 * the topology, the engine owns all writes. Render is read-only.
 */
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { getBrainPhysics, worldToLattice } from '@/lib/brain/uqrcPhysics';
import { curvatureAt } from '@/lib/uqrc/field3D';
import { getEarthLocalSiteFrame, EARTH_RADIUS, getEarthPose, earthLocalToWorld } from '@/lib/brain/earth';
import { boundaryInfo } from '@/lib/brain/tectonics';
import { coreBreath } from '@/lib/brain/earthCore';
import { buildWetWorkSeed, type WetWorkNode } from './wetWorkSeed';

export interface WetWorkHabitat {
  id: string;
  anchorPeerId: string;
  blockIds: string[];
  nodes: WetWorkNode[];
}

const _habitats = new Map<string, WetWorkHabitat>();

function readFieldSignals(anchorPeerId: string): {
  crustCurvature: number;
  plateStress: number;
  coreBreath: number;
} {
  const physics = getBrainPhysics();
  const field = physics.getField();
  const pose = getEarthPose();
  const lf = getEarthLocalSiteFrame(anchorPeerId);
  const surfaceLocal: [number, number, number] = [
    lf.normal[0] * EARTH_RADIUS,
    lf.normal[1] * EARTH_RADIUS,
    lf.normal[2] * EARTH_RADIUS,
  ];
  const surfaceWorld = earthLocalToWorld(surfaceLocal, pose);
  const lx = worldToLattice(surfaceWorld[0], field.N);
  const ly = worldToLattice(surfaceWorld[1], field.N);
  const lz = worldToLattice(surfaceWorld[2], field.N);
  const crustCurvature = Math.min(2, Math.abs(curvatureAt(field, lx, ly, lz)) * 6);
  const info = boundaryInfo(lf.normal);
  const plateStress = info.boundaryKind === 'convergent'
    ? Math.exp(-(info.boundaryDistance / 0.09) ** 2)
    : 0;
  const t = (Date.now() / 1000);
  return { crustCurvature, plateStress, coreBreath: coreBreath(t) };
}

/**
 * Grow (or re-grow) a WetWork habitat at the given anchor. Each node
 * becomes a builder block placed through the engine. Idempotent: calling
 * twice returns the existing habitat without creating duplicates.
 */
export function growWetWorkHabitat(opts: {
  habitatId: string;
  anchorPeerId: string;
  centerRight?: number;
  centerForward?: number;
}): WetWorkHabitat {
  const existing = _habitats.get(opts.habitatId);
  if (existing) return existing;

  const signals = readFieldSignals(opts.anchorPeerId);
  const nodes = buildWetWorkSeed(signals, { seed: opts.habitatId });
  const engine = getBuilderBlockEngine();
  const blockIds: string[] = [];
  const cR = opts.centerRight ?? 0;
  const cF = opts.centerForward ?? 0;

  for (const node of nodes) {
    const block = engine.placeBlock({
      id: `${opts.habitatId}:${node.id}`,
      kind: `wetwork-${node.kind}`,
      anchorPeerId: opts.anchorPeerId,
      rightOffset: cR + node.rightOffset,
      forwardOffset: cF + node.forwardOffset,
      mass: node.mass,
      basin: node.basin,
      yaw: node.yaw,
      meta: {
        species: 'wet-work',
        habitatId: opts.habitatId,
        nodeKind: node.kind,
        nodeId: node.id,
        scale: node.scale,
      },
    });
    blockIds.push(block.bodyId);
  }

  const habitat: WetWorkHabitat = {
    id: opts.habitatId,
    anchorPeerId: opts.anchorPeerId,
    blockIds,
    nodes,
  };
  _habitats.set(opts.habitatId, habitat);
  return habitat;
}

export function removeWetWorkHabitat(habitatId: string): void {
  const habitat = _habitats.get(habitatId);
  if (!habitat) return;
  const engine = getBuilderBlockEngine();
  for (const node of habitat.nodes) {
    engine.removeBlock(`${habitatId}:${node.id}`, `wetwork-${node.kind}`);
  }
  _habitats.delete(habitatId);
}

export function getWetWorkHabitat(habitatId: string): WetWorkHabitat | undefined {
  return _habitats.get(habitatId);
}

export function listHabitatBlocks(habitatId: string): BuilderBlock[] {
  const habitat = _habitats.get(habitatId);
  if (!habitat) return [];
  const engine = getBuilderBlockEngine();
  const out: BuilderBlock[] = [];
  for (const id of habitat.blockIds) {
    const b = engine.getBlock(id);
    if (b) out.push(b);
  }
  return out;
}
