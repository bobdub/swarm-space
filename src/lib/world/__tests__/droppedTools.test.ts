import { describe, it, expect, beforeEach, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: 'dropper' }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => session }));
vi.mock('@/lib/brain/builderBlockEngine', () => ({
  getBuilderBlockEngine: () => ({ removeBlock: () => {}, placeBlock: () => {} }),
}));
vi.mock('@/lib/world/placementController', () => ({
  placePrefabAtHit: () => null,
  poseTimeFromCreatedAt: (t: number) => t,
}));

import {
  acceptPeerPlacement,
  attachPlacementDeleteGossip,
  buildGlobalPlacementSnapshot,
  buildGlobalTombstoneSnapshot,
  listPlacements,
  mergePlacementSnapshot,
  setActiveUniverse,
  _resetWorldPlacementsForTest,
} from '@/lib/world/worldPlacementsStore';
import {
  acceptPeerDroppedToolFact,
  attachDroppedToolGossip,
  getDroppedToolFact,
  mergeDroppedToolFacts,
  recordDroppedToolFact,
  toolsOwnedByNpc,
  UNWANTED_TOOL_TTL_MS,
  _resetDroppedToolsForTest,
  type DroppedToolFact,
} from '@/lib/world/droppedToolsStore';
import {
  ownedToolKinds,
  pickToolToFetch,
  pickUpTool,
  toolKindOf,
  unwantedTools,
  vanishUnwantedTools,
  villageTangentOf,
  type LooseTool,
  type NpcToolKind,
} from '@/lib/brain/npc/npcTools';
import { EARTH_RADIUS, getEarthLocalSiteFrame, type Vec3 } from '@/lib/brain/earth';
import { interact } from '@/lib/world/wetWork';
import { onWorldMutation } from '@/lib/world/world.bus';
import { _resetResourceSitesForTest, type ResourceSite } from '@/lib/world/baseResources';
import { getInventory, initChemistry, _resetChemistryForTest } from '@/lib/brain/npc/npcChemistry';
import type { Npc } from '@/lib/brain/npc/npcTypes';

const NOW = 1_800_000_000_000;

const axeDrop = (id = 'axe-1', createdAt = NOW - 10_000) => ({
  placementId: id,
  anchorId: `anchor:${id}`,
  prefabId: 'tool_axe_stone',
  actorId: 'dropper',
  hitPoint: [0, 0, 0] as [number, number, number],
  placedAtPoseTime: 0,
  yaw: 0,
  createdAt,
  universeKey: 'global',
});

const pickup = (npcName: string, at: number, by = 'peer-a', placementId = 'axe-1'): DroppedToolFact => ({
  placementId,
  prefabId: 'tool_axe_stone',
  universeKey: 'global',
  outcome: 'pickup',
  npcName,
  by,
  at,
});

const loose = (over: Partial<LooseTool> = {}): LooseTool => ({
  placementId: 'axe-1',
  prefabId: 'tool_axe_stone',
  universeKey: 'global',
  kind: 'chop',
  createdAt: NOW - 10_000,
  tx: 5,
  tz: 0,
  ...over,
});

describe('dropped tools and village NPCs', () => {
  beforeEach(() => {
    vi.useRealTimers();
    session.id = 'dropper';
    _resetWorldPlacementsForTest();
    _resetDroppedToolsForTest();
    setActiveUniverse('global');
    try { localStorage.clear(); } catch { /* noop */ }
  });

  it('knows which prefabs are tools NPCs collect', () => {
    expect(toolKindOf('tool_axe_stone')).toBe('chop');
    expect(toolKindOf('tool_knife_stone')).toBe('whittle');
    expect(toolKindOf('tool_shovel_stone')).toBe('dig');
    expect(toolKindOf('tool_pick_stone')).toBe('mine');
    expect(toolKindOf('tool_bucket_wood')).toBe('carry');
    expect(toolKindOf('tool_boundary_marker')).toBeNull();
    expect(toolKindOf('fire_pit_stone')).toBeNull();
    expect(toolKindOf('wall-oak')).toBeNull();
  });

  it('a pickup takes the tool out of the world and gives it to the NPC', () => {
    acceptPeerPlacement(axeDrop());
    expect(listPlacements()).toHaveLength(1);

    expect(pickUpTool({ name: 'Aria' }, loose(), 'peer-a', NOW)).toBe(true);
    expect(listPlacements()).toEqual([]);
    expect(toolsOwnedByNpc('Aria')).toEqual(['tool_axe_stone']);
    expect(ownedToolKinds('Aria').has('chop')).toBe(true);

    // Not seeded any more, and the removal itself is shared.
    expect(buildGlobalPlacementSnapshot()).toEqual([]);
    expect(buildGlobalTombstoneSnapshot().map((t) => t.placementId)).toEqual(['axe-1']);
    // A stale copy from a peer can't bring it back.
    mergePlacementSnapshot([axeDrop()]);
    acceptPeerPlacement(axeDrop());
    expect(listPlacements()).toEqual([]);
  });

  it('two peers claiming the same tool agree on one NPC', () => {
    // Peer B's NPC grabbed it a moment later, and B heard first.
    expect(recordDroppedToolFact(pickup('Bren', NOW + 20, 'peer-b'), NOW + 20)?.npcName).toBe('Bren');
    expect(toolsOwnedByNpc('Bren')).toEqual(['tool_axe_stone']);

    // Peer A's earlier claim arrives: it wins, and Bren no longer owns it.
    expect(acceptPeerDroppedToolFact(pickup('Aria', NOW + 10, 'peer-a'), NOW + 30)).toBe(true);
    expect(getDroppedToolFact('axe-1')?.npcName).toBe('Aria');
    expect(toolsOwnedByNpc('Aria')).toEqual(['tool_axe_stone']);
    expect(toolsOwnedByNpc('Bren')).toEqual([]);

    // The later claim, arriving afterwards, changes nothing.
    expect(acceptPeerDroppedToolFact(pickup('Bren', NOW + 20, 'peer-b'), NOW + 30)).toBe(false);
    // A local NPC reaching it now is told it lost.
    expect(pickUpTool({ name: 'Cai' }, loose(), 'peer-c', NOW + 40)).toBe(false);
    expect(toolsOwnedByNpc('Cai')).toEqual([]);
  });

  it('breaks exact ties the same way on every peer', () => {
    const a = pickup('Cleo', NOW, 'peer-z');
    const b = pickup('Ash', NOW, 'peer-y');
    recordDroppedToolFact(a, NOW);
    acceptPeerDroppedToolFact(b, NOW);
    expect(getDroppedToolFact('axe-1')?.npcName).toBe('Ash');

    _resetDroppedToolsForTest();
    recordDroppedToolFact(b, NOW);
    acceptPeerDroppedToolFact(a, NOW);
    expect(getDroppedToolFact('axe-1')?.npcName).toBe('Ash');
  });

  it('refuses facts from the future and malformed ones', () => {
    expect(acceptPeerDroppedToolFact(pickup('Aria', NOW + 10 * 60_000), NOW)).toBe(false);
    expect(acceptPeerDroppedToolFact({ ...pickup('Aria', NOW), npcName: '' }, NOW)).toBe(false);
    expect(acceptPeerDroppedToolFact({ ...pickup('Aria', NOW), outcome: 'burn' }, NOW)).toBe(false);
    expect(getDroppedToolFact('axe-1')).toBeNull();
  });

  it('NPCs go for the nearest tool of a kind they lack', () => {
    const tools = [
      loose({ placementId: 'far', tx: 40, tz: 0 }),
      loose({ placementId: 'near', tx: 3, tz: 0 }),
      loose({ placementId: 'knife', kind: 'whittle', prefabId: 'tool_knife_stone', tx: 1, tz: 0 }),
      loose({ placementId: 'away', tx: null, tz: null }),
    ];
    const npc = { tx: 0, tz: 0 };
    expect(pickToolToFetch(npc, tools, new Set<NpcToolKind>(), new Set())?.placementId).toBe('knife');
    expect(pickToolToFetch(npc, tools, new Set<NpcToolKind>(['whittle']), new Set())?.placementId).toBe('near');
    // Another local NPC is already walking to the near axe.
    expect(pickToolToFetch(npc, tools, new Set<NpcToolKind>(['whittle']), new Set(['near']))?.placementId).toBe('far');
    expect(pickToolToFetch(npc, tools, new Set<NpcToolKind>(['whittle', 'chop']), new Set())).toBeNull();
  });

  it('places dropped tools in the village tangent frame', () => {
    const lf = getEarthLocalSiteFrame('swarm-shared-village');
    const at = (tx: number, tz: number): Vec3 => {
      const p: Vec3 = [
        lf.normal[0] * EARTH_RADIUS + lf.right[0] * tx + lf.forward[0] * tz,
        lf.normal[1] * EARTH_RADIUS + lf.right[1] * tx + lf.forward[1] * tz,
        lf.normal[2] * EARTH_RADIUS + lf.right[2] * tx + lf.forward[2] * tz,
      ];
      const r = Math.hypot(...p);
      return [p[0] / r, p[1] / r, p[2] / r];
    };
    const pos = villageTangentOf(at(12, -7), 'swarm-shared-village');
    expect(pos?.tx).toBeCloseTo(12, 0);
    expect(pos?.tz).toBeCloseTo(-7, 0);
    expect(villageTangentOf(at(500, 0), 'swarm-shared-village')).toBeNull();
  });

  it('an unwanted tool vanishes a minute after the drop, only when every NPC owns that kind', () => {
    const roster = [{ name: 'Aria' }, { name: 'Bren' }];
    const owns = (kinds: Record<string, NpcToolKind[]>) => (name: string) => new Set(kinds[name] ?? []);
    const tool = loose({ createdAt: NOW });

    // Bren has no axe: keep it for him.
    expect(unwantedTools([tool], roster, owns({ Aria: ['chop'] }), NOW + UNWANTED_TOOL_TTL_MS)).toEqual([]);
    // Everyone has one, but it was only just dropped.
    expect(unwantedTools([tool], roster, owns({ Aria: ['chop'], Bren: ['chop'] }), NOW + 59_000)).toEqual([]);
    expect(unwantedTools([tool], roster, owns({ Aria: ['chop'], Bren: ['chop'] }), NOW + 60_000)).toEqual([tool]);
    // No village yet: nothing vanishes.
    expect(unwantedTools([tool], [], owns({}), NOW + 10 * 60_000)).toEqual([]);
  });

  it('a vanish removes the tool here and tells peers, stamped the same on every device', () => {
    const sent: DroppedToolFact[] = [];
    const tombs: string[] = [];
    attachDroppedToolGossip((f) => sent.push(f));
    attachPlacementDeleteGossip((t) => tombs.push(t.placementId));

    // Aria and Bren each already hold an axe from earlier drops.
    recordDroppedToolFact(pickup('Aria', NOW - 50_000, 'peer-a', 'old-1'), NOW);
    recordDroppedToolFact(pickup('Bren', NOW - 50_000, 'peer-a', 'old-2'), NOW);
    sent.length = 0;

    acceptPeerPlacement(axeDrop('axe-9', NOW));
    const tools = [loose({ placementId: 'axe-9', createdAt: NOW })];
    const roster = [{ name: 'Aria' }, { name: 'Bren' }];
    expect(vanishUnwantedTools(tools, roster, 'peer-a', NOW + 30_000)).toBe(0);
    expect(listPlacements()).toHaveLength(1);

    expect(vanishUnwantedTools(tools, roster, 'peer-a', NOW + 61_000)).toBe(1);
    expect(listPlacements()).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ placementId: 'axe-9', outcome: 'vanish', at: NOW + UNWANTED_TOOL_TTL_MS });
    // The dropper's device also relays the plain tombstone.
    expect(tombs).toEqual(['axe-9']);

    // A second peer deciding the same thing sends nothing new.
    expect(acceptPeerDroppedToolFact({ ...sent[0], by: 'peer-b' }, NOW + 62_000)).toBe(false);
  });

  it('a pickup made before the minute was up beats a vanish', () => {
    const vanish: DroppedToolFact = {
      placementId: 'axe-1', prefabId: 'tool_axe_stone', universeKey: 'global',
      outcome: 'vanish', by: 'peer-b', at: NOW + UNWANTED_TOOL_TTL_MS,
    };
    acceptPeerDroppedToolFact(vanish, NOW + 70_000);
    expect(acceptPeerDroppedToolFact(pickup('Dawn', NOW + 30_000), NOW + 70_000)).toBe(true);
    expect(toolsOwnedByNpc('Dawn')).toEqual(['tool_axe_stone']);

    // ...and a same-instant tie goes to the pickup too.
    _resetDroppedToolsForTest();
    acceptPeerDroppedToolFact(vanish, NOW + 70_000);
    expect(acceptPeerDroppedToolFact(pickup('Eve', NOW + UNWANTED_TOOL_TTL_MS), NOW + 70_000)).toBe(true);
  });

  it('newcomer backfill converges on the same outcome', () => {
    acceptPeerPlacement(axeDrop());
    expect(mergeDroppedToolFacts([pickup('Bren', NOW + 20), pickup('Aria', NOW + 10), { junk: true }], NOW + 30)).toBe(1);
    expect(getDroppedToolFact('axe-1')?.npcName).toBe('Aria');
    expect(listPlacements()).toEqual([]);
  });
});

describe('NPCs work with the tools they own', () => {
  const npc = { id: 'npc-1', name: 'Aria', skills: { hunt: 0.2 }, body: [] } as unknown as Npc;
  const site = (kind: ResourceSite['kind']): ResourceSite => ({
    id: `${kind}-0`, kind, tx: 0, tz: 0, yieldLeft: 6, yieldMax: 6, lastHarvestedAt: 0, regrowSeconds: 25,
  });

  beforeEach(() => {
    _resetResourceSitesForTest();
    _resetChemistryForTest();
    initChemistry(npc);
  });

  it('an axe fells more wood without changing the labour weight', () => {
    const weights: number[] = [];
    const off = onWorldMutation((evt) => weights.push(evt.laborWeight));
    const bare = interact(npc, 'gather', site('wood'));
    const withAxe = interact(npc, 'gather', site('wood'), new Set<NpcToolKind>(['chop']));
    off();
    expect(bare.gained?.qty).toBe(1);
    expect(withAxe.gained?.qty).toBe(2);
    expect(withAxe.usedTool).toBe('chop');
    expect(weights[0]).toBe(weights[1]);
    expect(getInventory('npc-1').wood).toBe(3);
  });

  it('a knife dresses a full catch and a bucket carries more water', () => {
    expect(interact(npc, 'hunt', site('animal')).gained?.qty).toBe(1);
    expect(interact(npc, 'hunt', site('animal'), new Set<NpcToolKind>(['whittle'])).gained?.qty).toBe(2);
    expect(interact(npc, 'drink', site('water'), new Set<NpcToolKind>(['carry'])).gained?.qty).toBe(2);
    // A tool for other work changes nothing here.
    expect(interact(npc, 'drink', site('water'), new Set<NpcToolKind>(['chop'])).gained?.qty).toBe(1);
  });
});
