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
  /** Remaining yield (units). When 0 the site is depleted until regrowth. */
  yieldLeft: number;
  /** Max yield — restored by regrowth tick. */
  yieldMax: number;
  /** Wall-ms timestamp of last successful harvest, or 0 if untouched. */
  lastHarvestedAt: number;
  /** Wall-seconds between regrowth +1 ticks. */
  regrowSeconds: number;
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
  yieldMax: number;
  regrowSeconds: number;
}

const CLUSTERS: ClusterSpec[] = [
  { kind: 'water',  count: 3, rMin: 14, rMax: 22, yieldMax: 12, regrowSeconds: 6 },
  { kind: 'wood',   count: 5, rMin: 10, rMax: 28, yieldMax: 6,  regrowSeconds: 25 },
  { kind: 'animal', count: 4, rMin: 16, rMax: 30, yieldMax: 3,  regrowSeconds: 40 },
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
        yieldLeft: spec.yieldMax,
        yieldMax: spec.yieldMax,
        lastHarvestedAt: 0,
        regrowSeconds: spec.regrowSeconds,
      });
    }
  }
  _sites = out;
  return out;
}

/** Consume one unit from a site. Returns true iff yield was available. */
export function harvestSite(siteId: string, now = Date.now()): boolean {
  const sites = listResourceSites();
  const s = sites.find((x) => x.id === siteId);
  if (!s || s.yieldLeft <= 0) return false;
  s.yieldLeft -= 1;
  s.lastHarvestedAt = now;
  return true;
}

/**
 * Restore yield based on elapsed wall-time. Called by the NPC tick;
 * cheap, idempotent, runs over every site each call.
 */
export function tickRegrowth(now = Date.now()): void {
  if (!_sites) return;
  for (const s of _sites) {
    if (s.yieldLeft >= s.yieldMax) continue;
    const ref = s.lastHarvestedAt || now;
    const elapsed = (now - ref) / 1000;
    const gained = Math.floor(elapsed / s.regrowSeconds);
    if (gained <= 0) continue;
    s.yieldLeft = Math.min(s.yieldMax, s.yieldLeft + gained);
    s.lastHarvestedAt = ref + gained * s.regrowSeconds * 1000;
  }
}

/** Test seam. */
export function _resetResourceSitesForTest(): void {
  _sites = null;
}