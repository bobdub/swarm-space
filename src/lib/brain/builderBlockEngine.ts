/**
 * BuilderBlockEngine — Phase 1 of `docs/BRAIN_NATURE_PHASES.md`.
 *
 * Single entry point for placing / removing / upgrading "blocks" in the
 * brain world. Lifts the SurfaceTree / SurfaceApartment pattern (UQRC body
 * + curvature pin + Earth-local site frame) into one reusable API.
 *
 * INVARIANT — the only writer of pin templates and the only place that
 * calls `physics.addBody` / `removeBody` / `pinPiece` / `unpin` for
 * builder content. Biology and renderers MUST go through this engine.
 * They never touch `field.axes`, `body.pos`, or pin templates directly.
 */
import {
  FEET_SHELL_RADIUS,
  EARTH_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  earthLocalToWorld,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';

export interface BuilderBlockSpec {
  /** Stable id (engine prefixes with kind for the underlying body id). */
  id: string;
  /** Species / structure tag — e.g. 'tree', 'apartment', 'flower'. */
  kind: string;
  /** Earth-local anchor (peer/site) the block is glued to. */
  anchorPeerId: string;
  /** Tangent-plane offset from the anchor, in metres. */
  rightOffset?: number;
  forwardOffset?: number;
  /** Yaw around local-up, radians. Renderers may use it; engine stores it. */
  yaw?: number;
  /** UQRC body mass. */
  mass?: number;
  /** Curvature basin radius passed to `physics.pinPiece`. */
  basin?: number;
  /** Free-form metadata (species rules, stage, ttl, etc.). */
  meta?: Record<string, unknown>;
}

export interface BuilderBlock extends Required<Pick<BuilderBlockSpec,
  'id' | 'kind' | 'anchorPeerId' | 'rightOffset' | 'forwardOffset' | 'yaw' | 'mass' | 'basin'
>> {
  /** Underlying UQRC body id (`${kind}:${id}`). */
  bodyId: string;
  /** Mutable meta — biology may swap stage/ttl through `upgradeBlock`. */
  meta: Record<string, unknown>;
  /** Volumetric support-basin handle, owned by the engine and re-issued
   *  every tick at the live world transform. Replaces the old single-cell
   *  `physics.pinPiece` defect. */
  support: { cells: number[] };
  /** Engine tick counter at last placement / upgrade. */
  placedAt: number;
}

type Listener = (event: { type: 'place' | 'remove' | 'upgrade'; block: BuilderBlock }) => void;

function computeWorldPos(spec: Required<Pick<BuilderBlockSpec,
  'anchorPeerId' | 'rightOffset' | 'forwardOffset'>>): [number, number, number] {
  const pose = getEarthPose();
  const lf = getEarthLocalSiteFrame(spec.anchorPeerId);
  const localPos: [number, number, number] = [
    lf.normal[0] * EARTH_RADIUS + lf.forward[0] * spec.forwardOffset + lf.right[0] * spec.rightOffset,
    lf.normal[1] * EARTH_RADIUS + lf.forward[1] * spec.forwardOffset + lf.right[1] * spec.rightOffset,
    lf.normal[2] * EARTH_RADIUS + lf.forward[2] * spec.forwardOffset + lf.right[2] * spec.rightOffset,
  ];
  const worldRaw = earthLocalToWorld(localPos, pose);
  const dx = worldRaw[0] - pose.center[0];
  const dy = worldRaw[1] - pose.center[1];
  const dz = worldRaw[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  // Lift the block to the LOCAL ground — land sits above the spherical
  // baseline. Without this, trees placed over land sink their trunks
  // into the displaced terrain (the user saw "tree tops with no
  // trunks" because the canopy stuck up while the trunk was buried).
  const localUnit: [number, number, number] = [
    localPos[0] / EARTH_RADIUS,
    localPos[1] / EARTH_RADIUS,
    localPos[2] / EARTH_RADIUS,
  ];
  const lift = sampleSurfaceLift(localUnit);
  const k = (FEET_SHELL_RADIUS + lift) / r;
  return [
    pose.center[0] + dx * k,
    pose.center[1] + dy * k,
    pose.center[2] + dz * k,
  ];
}

class BuilderBlockEngine {
  private blocks = new Map<string, BuilderBlock>();
  private listeners = new Set<Listener>();
  private tickCounter = 0;
  private tickUnsub: (() => void) | null = null;

  /** Subscribe to physics ticks once the first block is placed so support
   *  basins are continuously re-issued at the live Earth-derived world
   *  position. Lazy because tests/SSR may construct the engine without a
   *  running physics loop. */
  private ensureTickHook(): void {
    if (this.tickUnsub) return;
    const physics = getBrainPhysics();
    this.tickUnsub = physics.subscribe(() => this.restampAll());
  }

  private restampAll(): void {
    if (this.blocks.size === 0) return;
    const physics = getBrainPhysics();
    for (const block of this.blocks.values()) {
      const newPos = computeWorldPos(block);
      const body = physics.getBody(block.bodyId);
      if (body) {
        body.pos[0] = newPos[0];
        body.pos[1] = newPos[1];
        body.pos[2] = newPos[2];
        body.vel[0] = 0; body.vel[1] = 0; body.vel[2] = 0;
      }
      // Volumetric basin co-moves with Earth — clear the previous stamp
      // and write a fresh one centred on the live world position.
      physics.unpinSupportBasin(block.support);
      block.support = physics.pinSupportBasin(newPos, block.basin, 0.6);
    }
  }

  placeBlock(spec: BuilderBlockSpec): BuilderBlock {
    const filled = {
      id: spec.id,
      kind: spec.kind,
      anchorPeerId: spec.anchorPeerId,
      rightOffset: spec.rightOffset ?? 0,
      forwardOffset: spec.forwardOffset ?? 0,
      yaw: spec.yaw ?? 0,
      mass: spec.mass ?? 8,
      basin: spec.basin ?? 0.25,
      meta: { ...(spec.meta ?? {}) },
    };
    const bodyId = `${filled.kind}:${filled.id}`;
    if (this.blocks.has(bodyId)) {
      // Idempotent re-place — return existing handle without touching physics.
      return this.blocks.get(bodyId)!;
    }
    const physics = getBrainPhysics();
    const worldPos = computeWorldPos(filled);
    physics.addBody({
      id: bodyId,
      kind: 'piece',
      pos: [...worldPos] as [number, number, number],
      vel: [0, 0, 0],
      mass: filled.mass,
      trust: 1,
      meta: {
        attachedTo: 'earth-surface',
        structure: filled.kind,
        anchorPeerId: filled.anchorPeerId,
        ...filled.meta,
      },
    });
    // Volumetric basin written into the field — the support comes from
    // the local geometric region, not a single-cell pin.
    const support = physics.pinSupportBasin(worldPos, filled.basin, 0.6);
    const block: BuilderBlock = {
      bodyId,
      ...filled,
      support,
      placedAt: ++this.tickCounter,
    };
    this.blocks.set(bodyId, block);
    this.ensureTickHook();
    this.emit({ type: 'place', block });
    return block;
  }

  removeBlock(id: string, kind?: string): void {
    const bodyId = kind ? `${kind}:${id}` : id;
    // Allow callers to pass either the bare id (when kind known) or the bodyId.
    const block = this.blocks.get(bodyId) ?? this.findByBareId(id);
    if (!block) return;
    const physics = getBrainPhysics();
    try { physics.unpinSupportBasin(block.support); } catch { /* ignore */ }
    physics.removeBody(block.bodyId);
    this.blocks.delete(block.bodyId);
    this.emit({ type: 'remove', block });
  }

  /**
   * Re-pin a block with a new basin / mass / kind. Used by biology for
   * lifecycle transitions (seed → sapling → tree). Position can also be
   * updated via `rightOffset` / `forwardOffset` for slow movement.
   */
  upgradeBlock(id: string, patch: Partial<Pick<BuilderBlockSpec,
    'kind' | 'mass' | 'basin' | 'yaw' | 'rightOffset' | 'forwardOffset' | 'meta'>>): BuilderBlock | null {
    const block = this.blocks.get(id) ?? this.findByBareId(id);
    if (!block) return null;
    const physics = getBrainPhysics();
    if (patch.kind !== undefined) block.kind = patch.kind;
    if (patch.mass !== undefined) block.mass = patch.mass;
    if (patch.yaw !== undefined) block.yaw = patch.yaw;
    if (patch.rightOffset !== undefined) block.rightOffset = patch.rightOffset;
    if (patch.forwardOffset !== undefined) block.forwardOffset = patch.forwardOffset;
    if (patch.meta) block.meta = { ...block.meta, ...patch.meta };

    const needsRepin = patch.basin !== undefined
      || patch.rightOffset !== undefined
      || patch.forwardOffset !== undefined;
    if (needsRepin) {
      const newBasin = patch.basin ?? block.basin;
      const newPos = computeWorldPos(block);
      try { physics.unpinSupportBasin(block.support); } catch { /* ignore */ }
      const body = physics.getBody(block.bodyId);
      if (body) {
        body.pos[0] = newPos[0];
        body.pos[1] = newPos[1];
        body.pos[2] = newPos[2];
        if (patch.mass !== undefined) body.mass = patch.mass;
        if (patch.kind !== undefined && body.meta) {
          (body.meta as Record<string, unknown>).structure = patch.kind;
        }
      }
      block.support = physics.pinSupportBasin(newPos, newBasin, 0.6);
      block.basin = newBasin;
    }
    block.placedAt = ++this.tickCounter;
    this.emit({ type: 'upgrade', block });
    return block;
  }

  getBlock(idOrBodyId: string): BuilderBlock | undefined {
    return this.blocks.get(idOrBodyId) ?? this.findByBareId(idOrBodyId) ?? undefined;
  }

  listBlocks(filter?: (b: BuilderBlock) => boolean): BuilderBlock[] {
    const all = Array.from(this.blocks.values());
    return filter ? all.filter(filter) : all;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(event: Parameters<Listener>[0]): void {
    this.listeners.forEach((fn) => {
      try { fn(event); } catch (err) { console.warn('[builderBlockEngine] listener error', err); }
    });
  }

  private findByBareId(id: string): BuilderBlock | undefined {
    for (const b of this.blocks.values()) if (b.id === id) return b;
    return undefined;
  }
}

let singleton: BuilderBlockEngine | null = null;

export function getBuilderBlockEngine(): BuilderBlockEngine {
  if (!singleton) singleton = new BuilderBlockEngine();
  return singleton;
}

export type { BuilderBlockEngine };