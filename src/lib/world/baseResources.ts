/**
 * baseResources — deterministic resource clusters on Earth surface.
 *
 * Phase 7 scaffolding: water / wood / animal sites are seeded once per
 * session from a string seed (no Math.random — uses a simple FNV hash
 * fanout). They expose `tx, tz` Earth-tangent offsets that any caller
 * can resolve to a live world position via `anchorOnEarth(...)`.
 *
 * Read-only — never writes the field, never touches builderBlockEngine.
 * Consumed by NPC verbs (gather/hunt/drink) and the NpcSwarmLayer
 * presentation layer.
 */

export type ResourceKind = 'water' | 'wood' | 'animal';

export interface ResourceSite {
  id: string;
  kind: ResourceKind;
  /** Tangent-plane offset from the shared village anchor (metres). */
  tx: number;
  tz: number;
}

const SEED_DEFAULT = 'swarm-shared-village/base-resources/v1';

function fnv1a(input: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function unitFrom(hash: number): number {
  return (hash >>> 0) / 0x100000000;
}

interface ClusterSpec {
  kind: ResourceKind;
  count: number;
  /** Inner / outer radius band, metres from village. */
  rMin: number;
  rMax: number;
}

const CLUSTERS: ClusterSpec[] = [
  { kind: 'water',  count: 3, rMin: 14, rMax: 22 },
  { kind: 'wood',   count: 5, rMin: 10, rMax: 28 },
  { kind: 'animal', count: 4, rMin: 16, rMax: 30 },
];

let _sites: ResourceSite[] | null = null;

/** Deterministic resource site list (cached). */
export function listResourceSites(seed: string = SEED_DEFAULT): ResourceSite[] {
  if (_sites) return _sites;
  const out: ResourceSite[] = [];
  for (const spec of CLUSTERS) {
    for (let i = 0; i < spec.count; i++) {
      const h1 = fnv1a(`${seed}:${spec.kind}:${i}:angle`);
      const h2 = fnv1a(`${seed}:${spec.kind}:${i}:radius`);
      const angle = unitFrom(h1) * Math.PI * 2;
      const radius = spec.rMin + unitFrom(h2) * (spec.rMax - spec.rMin);
      out.push({
        id: `${spec.kind}-${i}`,
        kind: spec.kind,
        tx: Math.cos(angle) * radius,
        tz: Math.sin(angle) * radius,
      });
    }
  }
  _sites = out;
  return out;
}

/** Test seam. */
export function _resetResourceSitesForTest(): void {
  _sites = null;
}