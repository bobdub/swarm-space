import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { blockOffsetInFrame } from '@/lib/brain/blockFrame';
import { beePoseAt, nearestFlowers, type V3 } from '@/lib/brain/nature/beeFlight';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { seedDefaultBiome } from '@/lib/brain/nature/natureSeed';
import { hiveBuildProgress, HUSK_MS } from '@/lib/brain/nature/hiveRehome';
import { syncNatureWorld } from '@/lib/brain/nature/natureWorld';
import { subscribeNatureEvents } from '@/lib/world/natureEventsStore';
import {
  flowerBloom,
  fruitAt,
  isFruitPicked,
  treeGrowth,
  treeVigour,
  SEED_FALL_MS,
} from '@/lib/brain/nature/natureGrowth';
import { seedMountains } from '@/lib/brain/nature/mountainSeed';
import { seedVolcanoes } from '@/lib/brain/nature/volcanoSeed';
import { NATURE_CATALOG, type NatureKind } from '@/lib/brain/nature/natureCatalog';
import {
  getVolcanoOrgan,
  SHARED_VOLCANO_ANCHOR_ID,
} from '@/lib/brain/volcanoOrgan';
import { EARTH_RADIUS, getEarthPose, quatRotate } from '@/lib/brain/earth';
import {
  getTreeChop,
  TOPPLE_MS,
  STUMP_FADE_MS,
} from '@/lib/world/treeChopStore';
import { getStoneMine, HITS_TO_BREAK, BREAK_MS } from '@/lib/world/stoneMineStore';
import { buildBoulderGeometry } from '@/lib/brain/nature/boulderGeometry';

import { VolcanoLavaPool } from '@/components/brain/VolcanoLavaPool';
import { VolcanoAshPlume } from '@/components/brain/VolcanoAshPlume';
import { volcanoLavaRadius } from '@/lib/brain/volcanoEffects';

/**
 * Phase 2 — NatureLayer
 *
 * Mounts on `/brain`, calls `seedDefaultBiome` once, then renders every
 * biome block through the BuilderBlockView contract. No behavior here:
 * pieces are static. Phase 3 (BiologyEngine) will animate / breed them.
 */
export function NatureLayer({ anchorPeerId }: { anchorPeerId: string }) {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const [, force] = useState(0);

  useEffect(() => {
    seedDefaultBiome(anchorPeerId);
    // Phase 3 — Mountains: uplift at convergent plate seams near the
    // village anchor. Idempotent; safe to call alongside the biome seed.
    seedMountains(anchorPeerId);
    // Phase 4 — Volcanoes: deterministic vents at convergent seam
    // midpoints. They render the pressure the mantle releases instead of
    // letting that release leak into ground tremor.
    seedVolcanoes(anchorPeerId);
    // Re-render when blocks are added/removed/upgraded by anyone.
    const unsub = engine.subscribe(() => force((n) => (n + 1) & 0xfff));
    // Seedlings, new flowers, old trees dying back, trees felled by anyone
    // and where the hive hangs all follow the shared clock and the shared
    // nature events; check every couple of seconds and on every new event.
    syncNatureWorld(anchorPeerId);
    const growTimer = window.setInterval(() => syncNatureWorld(anchorPeerId), 2000);
    const unsubEvents = subscribeNatureEvents(() => syncNatureWorld(anchorPeerId));
    return () => {
      unsub();
      unsubEvents();
      window.clearInterval(growTimer);
    };
  }, [anchorPeerId, engine]);

  // Only render biome-tagged blocks — leaves room for one-off pieces
  // (SurfaceApartment, SurfaceTree) to keep their own renderers.
  const blocks = engine.listBlocks((b) => b.meta?.biome === 'nature.biome.v1');

  return (
    <>
      {blocks.map((b) => (
        <BuilderBlockView key={b.bodyId} bodyId={b.bodyId}>
          {(block) => <NaturePiece block={block} />}
        </BuilderBlockView>
      ))}
      {/* Single shared volcano overlay — crater glow, plume, and a soft
          point light. The CONE itself is Earth geometry now (vertex
          displacement in EarthBody). This overlay only adds the bits
          that belong above the crater. */}
      <VolcanoOverlay anchorPeerId={anchorPeerId} />
    </>
  );
}

/** Dispatch by kind. Geometry is intentionally minimal in Phase 2. */
function NaturePiece({ block }: { block: BuilderBlock }) {
  if (block.kind === 'hive_husk') return <HiveHusk block={block} />;
  const kind = block.kind as NatureKind;
  const spec = NATURE_CATALOG[kind];
  const color = spec?.color ?? '#888';
  switch (kind) {
    case 'water': return <Water color={color} />;
    case 'grass': return <Grass color={color} />;
    case 'flower': return <Flower color={color} block={block} />;
    case 'tree': return <Tree color={color} block={block} />;
    case 'fish': return <Fish color={color} sex={(block.meta?.sex as string) ?? 'female'} />;
    // Keyed by host tree so a hive that moved house starts fresh.
    case 'hive': return <Hive key={String(block.meta?.treeId ?? '')} color={color} block={block} />;
    // Bees are drawn by the hive's swarm (flying between hive and
    // flowers); the queen stays at the hive. Their blocks remain the
    // gameplay record, so nothing is drawn standing on the grass here.
    case 'queen_bee': return null;
    case 'bee': return null;
    case 'stone':
      return (
        <Boulder
          color={color}
          blockId={block.bodyId}
          size={(block.meta?.size as number) ?? 0.8}
          shapeSeed={(block.meta?.shapeSeed as number) ?? 1}
        />
      );
    case 'mountain': return <Mountain color={color} height={(block.meta?.height as number) ?? 12} />;
    default: return null;
  }
}

function Water({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.02, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.6, 18]} />
      <meshStandardMaterial color={color} roughness={0.2} metalness={0.1} transparent opacity={0.85} />
    </mesh>
  );
}

function Grass({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.18, 0]} castShadow>
      <coneGeometry args={[0.08, 0.36, 5]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Flower({ color, block }: { color: string; block: BuilderBlock }) {
  // Flowers that grew from a seed spot bud up, bloom and wilt on the
  // shared clock; the starter flowers just bloom.
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const b = flowerBloom(block, Date.now());
    g.scale.set(Math.max(0.001, 0.3 + 0.7 * b), Math.max(0.001, b), Math.max(0.001, 0.3 + 0.7 * b));
    g.visible = b > 0.001;
  });
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color="#3a8a3a" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.45, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.6} emissive={color} emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

/** Where a grown tree hangs its fruit, under the lower canopy. */
const FRUIT_SPOTS: V3[] = [[1.05, 3.45, 0.35], [-0.6, 3.5, 0.9], [-0.3, 3.4, -1.0]];
const FRUIT_UNRIPE = new THREE.Color('#7fae3a');
const FRUIT_RIPE = new THREE.Color('#d8342b');

function Tree({ color, block }: { color: string; block: BuilderBlock }) {
  // Smaller, varied tree silhouette so the catalog tree reads as part of
  // a forest rather than competing with SurfaceTree's hero piece.
  const TR = 0.28, TH = 3.0;
  const blockId = block.bodyId;
  const groupRef = useRef<THREE.Group>(null);
  const seedRef = useRef<THREE.Group>(null);
  const fruitRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fruitMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  // A seedling's parent trunk, in this tree's local frame (+x is the site's left).
  const parent = useMemo<V3 | null>(() => {
    const r = block.meta?.parentRight;
    const f = block.meta?.parentForward;
    return typeof r === 'number' && typeof f === 'number' ? [-r, 0, f] : null;
  }, [block]);

  // Growth: a seed falls from the parent, sprouts and grows to a full
  // tree; an old one withers at the end of its life. Chopping is visible:
  // each accepted cut shakes the trunk, and the felling hit tips the whole
  // tree over before the stump fades out.
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const now = Date.now();
    const growth = treeGrowth(block, now);
    const size = (0.08 + 0.92 * growth * growth * (3 - 2 * growth)) * treeVigour(block, now);
    const sprouted = growth > 0;

    const seed = seedRef.current;
    if (seed) {
      const start = (block.meta?.growth as { start?: number } | undefined)?.start;
      seed.visible = !sprouted && typeof start === 'number';
      if (seed.visible && typeof start === 'number') {
        // Drop from the parent's canopy, tumbling, then lie in the grass.
        const t = Math.min(1, Math.max(0, (now - start) / SEED_FALL_MS));
        const from: V3 = parent ? [parent[0] * 0.7, 3.6, parent[2] * 0.7] : [0, 3.6, 0];
        const e = t * t;
        seed.position.set(from[0] * (1 - t), from[1] * (1 - e) + 0.05, from[2] * (1 - t));
        seed.rotation.set(t * 9, t * 5, 0);
      }
    }

    // Fruit on grown trees: swells green, ripens red, gone once picked.
    const fruit = fruitAt(blockId, now);
    const showFruit = growth >= 1 && !isFruitPicked(blockId, fruit.crop);
    for (let i = 0; i < FRUIT_SPOTS.length; i++) {
      const m = fruitRefs.current[i];
      if (m) {
        m.visible = showFruit;
        m.scale.setScalar(Math.max(0.001, 0.25 + 0.75 * fruit.size));
      }
      const mat = fruitMats.current[i];
      if (mat) mat.color.copy(fruit.ripe ? FRUIT_RIPE : FRUIT_UNRIPE);
    }

    const state = getTreeChop(blockId);
    if (!state) {
      g.rotation.set(0, 0, 0);
      g.scale.setScalar(sprouted ? Math.max(0.001, size) : 0.001);
      g.visible = sprouted && size > 0.002;
      return;
    }
    g.visible = true;
    if (state.toppledAt) {
      const t = Math.min(1, (now - state.toppledAt) / TOPPLE_MS);
      const e = t * t;
      g.rotation.set(0, 0, e * (Math.PI / 2) * 0.92);
      const fade = Math.max(0, 1 - Math.max(0, now - state.toppledAt - TOPPLE_MS) / STUMP_FADE_MS);
      g.scale.setScalar(Math.max(0.001, fade * size));
      return;
    }
    const since = now - state.lastHitAt;
    const shake = since < 420 ? Math.sin(since / 22) * 0.07 * (1 - since / 420) : 0;
    g.rotation.set(0, 0, shake);
    g.scale.setScalar(Math.max(0.001, size));
  });

  return (
    <>
      <group ref={seedRef} visible={false}>
        <mesh scale={[1, 0.7, 1.4]}>
          <sphereGeometry args={[0.09, 8, 6]} />
          <meshStandardMaterial color="#7a5230" roughness={0.8} />
        </mesh>
      </group>
      <group ref={groupRef}>
        <mesh position={[0, TH / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[TR * 0.8, TR, TH, 10]} />
          <meshStandardMaterial color="#6b4f2a" roughness={0.92} />
        </mesh>
        <mesh position={[0, TH + 0.8, 0]} castShadow>
          <coneGeometry args={[1.6, 2.2, 12]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        <mesh position={[0, TH + 2.0, 0]} castShadow>
          <coneGeometry args={[1.1, 1.6, 12]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        {FRUIT_SPOTS.map((p, i) => (
          <mesh key={i} position={p} ref={(el) => { fruitRefs.current[i] = el; }} visible={false} castShadow>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial
              ref={(el) => { fruitMats.current[i] = el; }}
              color={FRUIT_UNRIPE}
              roughness={0.45}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}


function Fish({ color, sex }: { color: string; sex: string }) {
  const accent = sex === 'male' ? '#3b82f6' : '#f472b6';
  return (
    <group position={[0, 0.18, 0]} rotation={[0, 0, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
      </mesh>
      {/* tail */}
      <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.18, 6]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Branch height where it leaves the trunk, and where it holds the hive (m). */
const BRANCH_Y_TRUNK = 2.3;
const BRANCH_Y_HIVE = 2.58;
const BRANCH_R = 0.075;
/** Hive body: a hanging teardrop of comb, top just under the branch. */
const HIVE_TOP = BRANCH_Y_HIVE - BRANCH_R * 0.6;
const HIVE_H = 1.06;
const HIVE_PROFILE: [number, number][] = [
  [0.07, 0], [0.2, -0.07], [0.34, -0.2], [0.42, -0.4], [0.43, -0.58],
  [0.37, -0.79], [0.24, -0.96], [0.08, -1.04], [0, -HIVE_H],
];
/** Height below the hive top of the entrance, and its depth into the wall. */
const ENTRANCE_DROP = 0.74;
const ENTRANCE_R = 0.4;

/** Size of the comb while the bees build it: a small knob growing to full. */
function hiveBuildScale(build: number): number {
  const e = build * build * (3 - 2 * build);
  return 0.15 + 0.85 * e;
}

function hiveRadiusAt(drop: number): number {
  for (let i = 1; i < HIVE_PROFILE.length; i++) {
    const [r0, y0] = HIVE_PROFILE[i - 1];
    const [r1, y1] = HIVE_PROFILE[i];
    if (-drop <= y0 && -drop >= y1) return r0 + ((r1 - r0) * (-drop - y0)) / (y1 - y0 || 1);
  }
  return 0;
}

/**
 * A wild honey hive hanging from a branch of its host tree, with the
 * hive's workers flying out to the flowers and back. Everything is built
 * here in code. If the host tree is felled the branch goes down with it
 * and the hive drops to the grass. Once the tree is cleared away the
 * colony moves to the nearest standing tree (see `hiveRehome`) and builds
 * a new comb there, growing from a small knob while the bees crowd round.
 */
function Hive({ color, block }: { color: string; block: BuilderBlock }) {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const treeId = (block.meta?.treeId as string | undefined) ?? '';
  // Where the host trunk stands in the hive's own frame. Measured from the
  // live tree block so the branch meets the trunk exactly; the seeded
  // right/forward offsets are the fallback.
  const [trunkR, trunkF] = useMemo(() => {
    const tree = treeId ? engine.getBlock(treeId) : undefined;
    if (tree) {
      const o = blockOffsetInFrame(block, tree);
      return [o[0], o[2]];
    }
    // The view's local +x is up × forward, i.e. the site's LEFT, so a
    // right offset maps to -x.
    return [
      -((block.meta?.trunkRight as number | undefined) ?? 0),
      (block.meta?.trunkForward as number | undefined) ?? 0,
    ];
  }, [engine, block, treeId]);
  const reach = Math.hypot(trunkR, trunkF);
  const hung = treeId !== '' && reach > 0.01;
  // Unit vector from trunk out to the hive, in the hive's local x/z.
  const ux = hung ? -trunkR / reach : 1;
  const uz = hung ? -trunkF / reach : 0;

  const wax = useMemo(() => new THREE.Color('#d39a2c').lerp(new THREE.Color(color), 0.18), [color]);
  const band = useMemo(() => wax.clone().multiplyScalar(0.72), [wax]);
  const geometry = useMemo(
    // Lathe points must run bottom → top for outward-facing walls.
    () => new THREE.LatheGeometry(HIVE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 18),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const entrance = useMemo<V3>(() => {
    const r = hiveRadiusAt(ENTRANCE_DROP);
    return [ux * (r + 0.05), HIVE_TOP - ENTRANCE_DROP, uz * (r + 0.05)];
  }, [ux, uz]);

  const hiveRef = useRef<THREE.Group>(null);
  const branchRef = useRef<THREE.Group>(null);
  /** How far the hive has dropped from its branch (m) — read by the swarm. */
  const dropRef = useRef(0);
  /** How far the comb is built, 0..1 — read by the swarm. */
  const buildRef = useRef(hiveBuildProgress(block.meta?.builtAt, Date.now()));

  useFrame(() => {
    const build = hiveBuildProgress(block.meta?.builtAt, Date.now());
    buildRef.current = build;
    const restDrop = HIVE_TOP - HIVE_H;
    let drop = 0;
    let branchTilt = 0;
    let branchScale = 1;
    if (!hung) {
      drop = restDrop;
      branchScale = 0;
    } else {
      const tree = engine.getBlock(treeId);
      const chop = getTreeChop(treeId);
      if (!tree) {
        drop = restDrop;
        branchScale = 0;
      } else if (chop?.toppledAt) {
        const since = Date.now() - chop.toppledAt;
        // The hive shakes loose a beat into the fall, then drops.
        const t = Math.min(1, Math.max(0, (since - 250) / 650));
        drop = restDrop * t * t;
        const tt = Math.min(1, since / TOPPLE_MS);
        branchTilt = tt * tt * (Math.PI / 2) * 0.92;
        branchScale = Math.max(0.001, 1 - Math.max(0, since - TOPPLE_MS) / STUMP_FADE_MS);
      } else if (treeVigour(tree, Date.now()) < 1) {
        // An old tree withering away: the branch shrinks with it and the
        // hive drops to the grass.
        const v = treeVigour(tree, Date.now());
        const t = Math.min(1, (1 - v) * 3);
        drop = restDrop * t * t;
        branchScale = Math.max(0.001, v);
      } else if (chop) {
        const since = Date.now() - chop.lastHitAt;
        branchTilt = since < 420 ? Math.sin(since / 22) * 0.07 * (1 - since / 420) : 0;
      }
    }
    dropRef.current = drop;
    if (hiveRef.current) {
      hiveRef.current.position.set(0, HIVE_TOP - drop, 0);
      // Hanging hives sway a touch in the breeze; a grounded one is still.
      const sway = drop > 0 ? 0 : Math.sin(Date.now() / 1400) * 0.025;
      hiveRef.current.rotation.set(sway * uz, 0, -sway * ux);
      // A new hive starts as a small knob of comb and grows to full size.
      hiveRef.current.scale.setScalar(hiveBuildScale(build));
    }
    if (branchRef.current) {
      // Same pivot and motion as the tree: about its base, in its frame.
      branchRef.current.rotation.set(0, 0, branchTilt);
      branchRef.current.scale.setScalar(branchScale);
      branchRef.current.visible = branchScale > 0.002;
    }
  });

  const branchLen = Math.hypot(reach + 0.25, BRANCH_Y_HIVE - BRANCH_Y_TRUNK);
  const branchYaw = Math.atan2(-uz, ux);
  const branchPitch = Math.atan2(BRANCH_Y_HIVE - BRANCH_Y_TRUNK, reach);

  return (
    <group>
      {hung && (
        // Pivot at the trunk's base so a falling tree takes the branch along.
        <group ref={branchRef} position={[trunkR, 0, trunkF]}>
          <group position={[0, BRANCH_Y_TRUNK, 0]} rotation={[0, branchYaw, branchPitch]}>
            <mesh position={[branchLen / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[BRANCH_R * 0.7, BRANCH_R * 1.25, branchLen, 7]} />
              <meshStandardMaterial color="#6b4f2a" roughness={0.92} />
            </mesh>
            {/* a short twig with a few leaves past the hive */}
            <mesh position={[branchLen * 0.82, 0.16, 0.12]} rotation={[0.5, 0, -0.6]}>
              <cylinderGeometry args={[0.02, 0.03, 0.45, 5]} />
              <meshStandardMaterial color="#6b4f2a" roughness={0.92} />
            </mesh>
            <mesh position={[branchLen + 0.05, 0.08, 0]} castShadow>
              <icosahedronGeometry args={[0.24, 0]} />
              <meshStandardMaterial color="#3f7a35" roughness={0.85} flatShading />
            </mesh>
          </group>
        </group>
      )}

      <group ref={hiveRef} position={[0, HIVE_TOP, 0]}>
        {/* stalk of comb fixing the hive to the branch */}
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.06, 0.09, 0.1, 8]} />
          <meshStandardMaterial color={band} roughness={0.8} />
        </mesh>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color={wax} roughness={0.7} emissive={wax} emissiveIntensity={0.08} />
        </mesh>
        {/* comb ridges */}
        {[0.2, 0.4, 0.6, 0.82].map((d) => (
          <mesh key={d} position={[0, -d, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[hiveRadiusAt(d) + 0.005, 0.03, 6, 18]} />
            <meshStandardMaterial color={band} roughness={0.8} />
          </mesh>
        ))}
        {/* entrance, facing away from the trunk */}
        <mesh
          position={[ux * (hiveRadiusAt(ENTRANCE_DROP) - 0.01), -ENTRANCE_DROP, uz * (hiveRadiusAt(ENTRANCE_DROP) - 0.01)]}
          rotation={[0, Math.atan2(ux, uz), 0]}
        >
          <circleGeometry args={[0.085, 12]} />
          <meshStandardMaterial color="#1c1206" roughness={1} side={THREE.DoubleSide} />
        </mesh>
        {/* the queen, resting on the lip of the entrance */}
        <group
          position={[ux * (ENTRANCE_R + 0.07), -ENTRANCE_DROP - 0.12, uz * (ENTRANCE_R + 0.07)]}
          rotation={[0, Math.atan2(ux, uz) + Math.PI / 2, 0]}
          scale={1.3}
        >
          <BeeModel queen />
        </group>
      </group>

      <BeeSwarm hive={block} entrance={entrance} dropRef={dropRef} buildRef={buildRef} />
    </group>
  );
}

/**
 * The broken comb a colony leaves behind when its tree is felled. It
 * starts where the fallen hive landed, rolls onto its side, and after a
 * while crumbles away into the grass.
 */
function HiveHusk({ block }: { block: BuilderBlock }) {
  const geometry = useMemo(
    () => new THREE.LatheGeometry(HIVE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 14),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const abandonedAt = (block.meta?.abandonedAt as number | undefined) ?? Date.now();
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const since = Date.now() - abandonedAt;
    const roll = Math.min(1, since / 1200);
    const tip = roll * roll * (Math.PI / 2) * 0.9;
    g.rotation.set(0, 0, tip);
    g.position.set(0, 0.36 * (tip / (Math.PI / 2)), 0);
    // Crumble over the last third of its time on the grass.
    const fade = Math.min(1, Math.max(0, (HUSK_MS - since) / (HUSK_MS / 3)));
    g.scale.setScalar(0.4 + 0.6 * fade);
    if (matRef.current) matRef.current.opacity = fade;
    g.visible = fade > 0.01;
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} position={[0, HIVE_H, 0]} castShadow receiveShadow>
        <meshStandardMaterial ref={matRef} color="#7a5a2a" roughness={0.95} transparent />
      </mesh>
    </group>
  );
}

const BEE_YELLOW = '#f7c21a';

/** One bee, nose along +z: striped body, dark head, flapping wings. */
function BeeModel({
  queen = false,
  wingL,
  wingR,
  pollen,
}: {
  queen?: boolean;
  wingL?: React.Ref<THREE.Group>;
  wingR?: React.Ref<THREE.Group>;
  pollen?: React.Ref<THREE.Group>;
}) {
  return (
    <group>
      <mesh scale={[0.78, 0.78, queen ? 1.6 : 1.3]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial
          color={queen ? '#e9a20f' : BEE_YELLOW}
          emissive={queen ? '#ffae00' : BEE_YELLOW}
          emissiveIntensity={queen ? 0.35 : 0.22}
          roughness={0.55}
        />
      </mesh>
      {[-0.035, 0.05].map((z) => (
        <mesh key={z} position={[0, 0, z]} scale={[1, 1, 0.55]}>
          <torusGeometry args={[0.083, 0.024, 6, 14]} />
          <meshStandardMaterial color="#141008" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.01, 0.15 * (queen ? 1.15 : 1)]}>
        <sphereGeometry args={[0.065, 8, 6]} />
        <meshStandardMaterial color="#141008" roughness={0.7} />
      </mesh>
      {/* wings hinge at the body so they flap, not spin */}
      {[1, -1].map((side) => (
        <group key={side} ref={side > 0 ? wingL : wingR} position={[side * 0.03, 0.075, 0.02]}>
          <mesh position={[side * 0.1, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.2, 0.11]} />
            <meshStandardMaterial color="#eaf6ff" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {pollen && (
        <group ref={pollen} visible={false}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.07, -0.06, -0.01]}>
              <sphereGeometry args={[0.035, 6, 5]} />
              <meshStandardMaterial color="#ffb300" emissive="#ff9500" emissiveIntensity={0.3} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/**
 * The hive's workers: one flying bee per worker block, foraging the
 * closest flowers on a shared clock so every peer sees the same flight.
 */
function BeeSwarm({
  hive,
  entrance,
  dropRef,
  buildRef,
}: {
  hive: BuilderBlock;
  entrance: V3;
  dropRef: React.MutableRefObject<number>;
  buildRef: React.MutableRefObject<number>;
}) {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const [flowers, setFlowers] = useState<V3[]>([]);
  const [workers, setWorkers] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const local = engine
        .listBlocks((b) => b.kind === 'flower' && b.meta?.biome === 'nature.biome.v1')
        .map((f) => {
          const o = blockOffsetInFrame(hive, f);
          return [o[0], o[1] + 0.47, o[2]] as V3; // the bloom, not the stem foot
        });
      setFlowers(nearestFlowers(entrance, local));
      setWorkers(engine.listBlocks((b) => b.kind === 'bee' && b.meta?.hiveId === hive.id).length);
    };
    refresh();
    return engine.subscribe((evt) => {
      if (evt.block.kind === 'flower' || evt.block.kind === 'bee') refresh();
    });
  }, [engine, hive, entrance]);

  const bees = useRef<(THREE.Group | null)[]>([]);
  const wingsL = useRef<(THREE.Group | null)[]>([]);
  const wingsR = useRef<(THREE.Group | null)[]>([]);
  const pollen = useRef<(THREE.Group | null)[]>([]);

  useFrame(() => {
    const now = Date.now() / 1000;
    const drop = dropRef.current;
    const build = buildRef.current;
    // While the comb is being built it is smaller, so its door sits closer in.
    const sc = hiveBuildScale(build);
    const door: V3 = [entrance[0] * sc, HIVE_TOP - (HIVE_TOP - entrance[1]) * sc - drop, entrance[2] * sc];
    // Builders crowd round the growing comb instead of foraging; near the
    // end of the build they ease out into their foraging loop.
    const combCentre: V3 = [0, HIVE_TOP - HIVE_H * 0.45 * sc - drop, 0];
    const k = build >= 1 ? 1 : Math.max(0, (build - 0.88) / 0.12);
    const ease = k * k * (3 - 2 * k);
    const poseAt = (i: number, t: number) => {
      const forage = beePoseAt(i, workers, t, door, flowers);
      if (ease >= 1) return forage;
      const crowd = beePoseAt(i, workers, t, combCentre, []);
      const pos: V3 = [
        crowd.pos[0] + (forage.pos[0] - crowd.pos[0]) * ease,
        crowd.pos[1] + (forage.pos[1] - crowd.pos[1]) * ease,
        crowd.pos[2] + (forage.pos[2] - crowd.pos[2]) * ease,
      ];
      return { pos, phase: ease > 0.5 ? forage.phase : crowd.phase, flower: forage.flower };
    };
    for (let i = 0; i < workers; i++) {
      const g = bees.current[i];
      if (!g) continue;
      const p = poseAt(i, now);
      const ahead = poseAt(i, now + 0.08).pos;
      g.position.set(p.pos[0], p.pos[1], p.pos[2]);
      const dx = ahead[0] - p.pos[0];
      const dy = ahead[1] - p.pos[1];
      const dz = ahead[2] - p.pos[2];
      const flat = Math.hypot(dx, dz);
      if (flat > 1e-4) {
        g.rotation.set(-Math.atan2(dy, flat) * 0.6, Math.atan2(dx, dz), 0);
      } else if (p.phase === 'rest') {
        // Resting at the door: face out, away from the hive.
        g.rotation.set(0, Math.atan2(entrance[0], entrance[2]), 0);
      }
      const flap = p.phase === 'rest' ? 0.15 : Math.sin(now * 90 + i) * 0.7;
      const wl = wingsL.current[i];
      const wr = wingsR.current[i];
      if (wl) wl.rotation.z = 0.25 + flap;
      if (wr) wr.rotation.z = -0.25 - flap;
      const pg = pollen.current[i];
      if (pg) pg.visible = p.phase === 'back' || p.phase === 'rest';
    }
  });

  return (
    <>
      {Array.from({ length: workers }, (_, i) => (
        <group key={i} ref={(el) => { bees.current[i] = el; }} position={entrance}>
          <BeeModel
            wingL={(el) => { wingsL.current[i] = el; }}
            wingR={(el) => { wingsR.current[i] = el; }}
            pollen={(el) => { pollen.current[i] = el; }}
          />
        </group>
      ))}
    </>
  );
}

function Boulder({
  color,
  blockId,
  size,
  shapeSeed,
}: {
  color: string;
  blockId: string;
  size: number;
  shapeSeed: number;
}) {
  // Procedural granite: a seeded, lumpy icosphere built in code — no
  // imported model. Each boulder's seed makes its silhouette unique.
  const geometry = useMemo(() => buildBoulderGeometry(shapeSeed), [shapeSeed]);
  // The blended element colour is oxygen-heavy (pinkish); weather it toward
  // granite grey so it reads as rock while keeping its feldspar warmth.
  const tint = useMemo(() => new THREE.Color(color).lerp(new THREE.Color('#8d8a86'), 0.72), [color]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const groupRef = useRef<THREE.Group>(null);

  // Mining is visible: each accepted bite jolts the boulder and chips it a
  // little smaller; the breaking bite shrinks it away into loose stone.
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const state = getStoneMine(blockId);
    if (!state) {
      g.position.set(0, 0, 0);
      g.scale.setScalar(1);
      return;
    }
    const now = Date.now();
    if (state.brokenAt) {
      const t = Math.min(1, (now - state.brokenAt) / BREAK_MS);
      g.position.set(0, 0, 0);
      g.scale.setScalar(Math.max(0.001, 1 - t * t));
      return;
    }
    const since = now - state.lastHitAt;
    const jolt = since < 300 ? Math.sin(since / 18) * 0.05 * (1 - since / 300) : 0;
    g.position.set(jolt, 0, -jolt);
    g.scale.setScalar(1 - 0.08 * Math.min(state.hits, HITS_TO_BREAK));
  });

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        position={[0, size * 0.42, 0]}
        scale={[size * 1.15, size * 0.78, size]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={tint} roughness={0.96} metalness={0.04} flatShading />
      </mesh>
    </group>
  );
}

function Mountain({ color, height }: { color: string; height: number }) {
  // Cone of rock with a snowy cap. Base radius scales with height so
  // tall mountains read as massive, not pencil-thin.
  const baseR = Math.max(2.5, height * 0.55);
  const capH = Math.max(1.0, height * 0.18);
  const capR = baseR * 0.35;
  const capY = height - capH * 0.5;
  return (
    <group>
      {/* main rock cone */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <coneGeometry args={[baseR, height, 14]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* snow cap */}
      <mesh position={[0, capY, 0]} castShadow>
        <coneGeometry args={[capR, capH, 14]} />
        <meshStandardMaterial color="hsl(0, 0%, 92%)" roughness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * Overlay anchored to the unified Volcano Organ. The cone itself is
 * Earth geometry (vertex displacement in `EarthBody`); this only renders
 * the bits that belong above the crater: a molten pool, an ash plume,
 * and a warm point light. Position is recomputed per-frame from the live
 * Earth pose so the overlay rotates with the planet.
 */
function VolcanoOverlay({ anchorPeerId: _anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const organ = useMemo(() => getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID), []);
  const lavaR = useMemo(() => volcanoLavaRadius(organ), [organ]);
  const localOrientation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(...organ.centerNormal),
  ), [organ]);
  const spin = useMemo(() => new THREE.Quaternion(), []);
  // Compute the local "up" tangent so the overlay points outward.
  useFrame(() => {
    if (!groupRef.current) return;
    const pose = getEarthPose();
    // Rotate Earth-local centre normal into world space.
    const worldN = quatRotate(pose.spinQuat, organ.centerNormal);
    // Actual baked crater floor + shallow melt depth, including land lift.
    const x = pose.center[0] + worldN[0] * lavaR;
    const y = pose.center[1] + worldN[1] * lavaR;
    const z = pose.center[2] + worldN[2] * lavaR;
    groupRef.current.position.set(x, y, z);
    // Orient local +Y to align with the outward world normal.
    spin.set(...pose.spinQuat);
    groupRef.current.quaternion.copy(spin).multiply(localOrientation);
  });
  const craterR = organ.craterRadius;
  return (
    <group ref={groupRef}>
      {/* Molten crater floor — pressure-reactive crust. */}
      <VolcanoLavaPool radius={craterR * 0.95} />
      {/* Heat comes from the molten crust; no hovering solid orange ball. */}
      <VolcanoAshPlume organ={organ} altitude={lavaR - EARTH_RADIUS} />
    </group>
  );
}
