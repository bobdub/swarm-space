/**
 * npcTools — village NPCs collect tools players dropped, and use them.
 *
 * A tool lying on the ground is a world placement of a holdable tool
 * prefab. An NPC that does not own that kind of tool yet walks over and
 * picks it up; the pickup is a shared fact (droppedToolsStore), so only
 * one NPC across all peers ends up with it. From then on the NPC carries
 * it and works with it (see wetWork: an axe fells more wood, a knife
 * dresses more game, a bucket carries more water).
 *
 * When every NPC already owns that kind, nobody wants the tool, so it
 * vanishes one minute after it was dropped — for this device and, through
 * the same fact, for every peer, which then stop seeding it.
 *
 * Positions use the village tangent plane (tx along the anchor's right,
 * tz along its forward), the same frame NPCs and resource sites use.
 */
import {
  EARTH_RADIUS,
  getEarthLocalSiteFrame,
  getEarthPoseAt,
  worldPosToLocalNormal,
  type Vec3,
} from '@/lib/brain/earth';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { FIRE_PIT_ID, getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { listPlacements, type PlacementRecord } from '@/lib/world/worldPlacementsStore';
import {
  getDroppedToolFact,
  recordDroppedToolFact,
  toolsOwnedByNpc,
  UNWANTED_TOOL_TTL_MS,
} from '@/lib/world/droppedToolsStore';
import type { Npc } from './npcTypes';

/** What a tool is for, as far as village work is concerned. */
export type NpcToolKind = 'chop' | 'whittle' | 'dig' | 'mine' | 'carry';

/** NPCs only go after tools lying within this distance of the village. */
export const TOOL_FETCH_RADIUS_M = 80;
/** Inside this distance the NPC is close enough to pick the tool up. */
export const TOOL_PICKUP_RADIUS_M = 1.2;

export interface LooseTool {
  placementId: string;
  prefabId: string;
  universeKey: string;
  kind: NpcToolKind;
  createdAt: number;
  /** Village tangent position, or null when the tool lies far away. */
  tx: number | null;
  tz: number | null;
}

/**
 * The kind of a holdable tool prefab, or null for anything NPCs leave
 * alone (the Boundary Marker claims land, the fire pit is built, not
 * carried, and blocks are not tools).
 */
export function toolKindOf(prefabId: string): NpcToolKind | null {
  if (prefabId === FIRE_PIT_ID) return null;
  const tool = getToolAny(prefabId);
  if (tool) {
    if (tool.actionKind === 'claim') return null;
    return tool.actionKind;
  }
  if (prefabId.startsWith('tool_bucket')) return 'carry';
  return null;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function localNormalOf(rec: PlacementRecord): Vec3 | null {
  if (rec.localNormal) return rec.localNormal;
  try {
    return worldPosToLocalNormal(rec.hitPoint, getEarthPoseAt(rec.placedAtPoseTime ?? 0));
  } catch {
    return null;
  }
}

/** Village tangent position of a point on Earth, or null if it is far. */
export function villageTangentOf(localNormal: Vec3, anchorId: string): { tx: number; tz: number } | null {
  const lf = getEarthLocalSiteFrame(anchorId);
  // Only the near side of the village frame projects meaningfully.
  if (dot(localNormal, lf.normal) < 0.95) return null;
  const tx = dot(localNormal, lf.right) * EARTH_RADIUS;
  const tz = dot(localNormal, lf.forward) * EARTH_RADIUS;
  if (Math.hypot(tx, tz) > TOOL_FETCH_RADIUS_M) return null;
  return { tx, tz };
}

/** Tools lying on the ground in the current Brain that nobody has taken. */
export function listLooseTools(anchorId: string): LooseTool[] {
  const out: LooseTool[] = [];
  for (const rec of listPlacements()) {
    const kind = toolKindOf(rec.prefabId);
    if (!kind || getPrefab(rec.prefabId) === undefined) continue;
    if (getDroppedToolFact(rec.placementId)) continue;
    const n = localNormalOf(rec);
    const pos = n ? villageTangentOf(n, anchorId) : null;
    out.push({
      placementId: rec.placementId,
      prefabId: rec.prefabId,
      universeKey: rec.universeKey || 'global',
      kind,
      createdAt: rec.createdAt,
      tx: pos?.tx ?? null,
      tz: pos?.tz ?? null,
    });
  }
  return out;
}

/** Kinds of tool this NPC owns. */
export function ownedToolKinds(npcName: string): Set<NpcToolKind> {
  const out = new Set<NpcToolKind>();
  for (const prefabId of toolsOwnedByNpc(npcName)) {
    const kind = toolKindOf(prefabId);
    if (kind) out.add(kind);
  }
  return out;
}

/** The prefab of the tool this NPC owns for `kind`, if any (first picked up). */
export function ownedToolFor(npcName: string, kind: NpcToolKind): string | null {
  for (const prefabId of toolsOwnedByNpc(npcName)) {
    if (toolKindOf(prefabId) === kind) return prefabId;
  }
  return null;
}

/**
 * The nearest loose tool this NPC wants: a kind it does not own yet,
 * lying near the village, and not already being fetched by another NPC
 * on this device. Pure; the caller supplies the claims.
 */
export function pickToolToFetch(
  npc: Pick<Npc, 'tx' | 'tz'>,
  tools: LooseTool[],
  owned: ReadonlySet<NpcToolKind>,
  takenByOthers: ReadonlySet<string>,
): LooseTool | null {
  let best: LooseTool | null = null;
  let bestD = Infinity;
  for (const t of tools) {
    if (t.tx === null || t.tz === null) continue;
    if (owned.has(t.kind)) continue;
    if (takenByOthers.has(t.placementId)) continue;
    const d = Math.hypot(t.tx - npc.tx, t.tz - npc.tz);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * Loose tools nobody wants: every NPC in `roster` already owns that kind
 * and the tool has lain for a minute. An empty roster wants everything
 * (the village may just not have booted yet), so nothing vanishes.
 */
export function unwantedTools(
  tools: LooseTool[],
  roster: Array<Pick<Npc, 'name'>>,
  ownedFor: (npcName: string) => ReadonlySet<NpcToolKind>,
  now: number,
): LooseTool[] {
  if (roster.length === 0) return [];
  const owned = roster.map((n) => ownedFor(n.name));
  return tools.filter((t) =>
    now - t.createdAt >= UNWANTED_TOOL_TTL_MS && owned.every((set) => set.has(t.kind)));
}

/**
 * Pick the tool up for `npc`. Returns true when this NPC holds it now;
 * false when another NPC (here or on a peer) got there first, or it had
 * already vanished.
 */
export function pickUpTool(npc: Pick<Npc, 'name'>, tool: LooseTool, by: string, now = Date.now()): boolean {
  const standing = recordDroppedToolFact({
    placementId: tool.placementId,
    prefabId: tool.prefabId,
    universeKey: tool.universeKey,
    outcome: 'pickup',
    npcName: npc.name,
    by,
    at: now,
  }, now);
  return standing?.outcome === 'pickup' && standing.npcName === npc.name;
}

/**
 * Let unwanted tools vanish. The fact is stamped one minute after the
 * drop, so every peer that decides the same records the same moment.
 */
export function vanishUnwantedTools(
  tools: LooseTool[],
  roster: Array<Pick<Npc, 'name'>>,
  by: string,
  now = Date.now(),
): number {
  let n = 0;
  for (const t of unwantedTools(tools, roster, ownedToolKinds, now)) {
    const standing = recordDroppedToolFact({
      placementId: t.placementId,
      prefabId: t.prefabId,
      universeKey: t.universeKey,
      outcome: 'vanish',
      by,
      at: t.createdAt + UNWANTED_TOOL_TTL_MS,
    }, now);
    if (standing?.outcome === 'vanish') n += 1;
  }
  return n;
}
