import { describe, it, expect, beforeEach } from 'vitest';
import { arrayBufferToBase64, computeUserId } from '@/lib/crypto';
import {
  LAND_CLAIM_TYPE,
  _resetLandClaimsForTest,
  acceptPeerLandClaim,
  attachLandClaimGossip,
  getLandClaim,
  listLandClaims,
  mergeLandClaims,
  recordLocalLandClaims,
  signLandClaim,
  verifyLandClaim,
  type LandClaim,
} from '../landClaimsStore';
import {
  BOX_PRICE_SWARM,
  canBuildAtCell,
  claimsToPlots,
  clearLandPlotsCache,
  getPlotAtCell,
  loadLandPlots,
  loadLegacyLandPlots,
  replaceLegacyLandPlots,
  type LandPlot,
} from '../landPlots';
import { tangentToSurfaceLocal } from '../landPermissions';
import {
  BLOCK_PRICE_SWARM,
  claimBlockWithMarker,
  installLandClaimRules,
  loadDeeds,
  migrateLegacyPlots,
  reconcileDeeds,
  type ClaimDeps,
} from '../boundaryMarker';

interface Identity { id: string; publicKey: string; privateKey: string }

async function makeIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = arrayBufferToBase64(await crypto.subtle.exportKey('spki', pair.publicKey));
  const privateKey = arrayBufferToBase64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { id: await computeUserId(publicKey), publicKey, privateKey };
}

function claimFor(who: Identity, cx: number, cz: number, claimedAt: number): Promise<LandClaim> {
  return signLandClaim(
    { type: LAND_CLAIM_TYPE, cx, cz, ownerId: who.id, claimedAt, priceSwarm: BOX_PRICE_SWARM },
    who.privateKey,
    who.publicKey,
  );
}

function depsFor(who: Identity, balance = 100): ClaimDeps & { burned: number[] } {
  const burned: number[] = [];
  let bal = balance;
  return {
    burned,
    getUser: () => ({ id: who.id, publicKey: who.publicKey }),
    getPrivateKey: async () => who.privateKey,
    getBalance: async () => bal,
    burn: async ({ amount }) => {
      if (bal < amount) throw new Error('Insufficient SWARM balance to burn');
      bal -= amount;
      burned.push(amount);
    },
    now: () => 1_700_000_000_000,
    isWater: () => false,
  };
}

let alice: Identity;
let bob: Identity;

beforeEach(async () => {
  _resetLandClaimsForTest();
  clearLandPlotsCache();
  localStorage.clear();
  alice ??= await makeIdentity();
  bob ??= await makeIdentity();
});

describe('land claims — signatures', () => {
  it('verifies a claim signed by its owner', async () => {
    const c = await claimFor(alice, 1, 2, 1000);
    expect(await verifyLandClaim(c)).toBe(true);
  });

  it('rejects a claim made in someone else\'s name', async () => {
    const c = await claimFor(alice, 1, 2, 1000);
    expect(await verifyLandClaim({ ...c, ownerId: bob.id })).toBe(false);
  });

  it('rejects a tampered cell', async () => {
    const c = await claimFor(alice, 1, 2, 1000);
    expect(await verifyLandClaim({ ...c, cx: 9 })).toBe(false);
    expect(await acceptPeerLandClaim({ ...c, cx: 9 }, 2000)).toBe(false);
    expect(getLandClaim(9, 2)).toBeNull();
  });
});

describe('land claims — sync', () => {
  it('accepts a peer claim, forwards it once, and ignores repeats', async () => {
    const sent: LandClaim[] = [];
    attachLandClaimGossip((c) => sent.push(c));
    const c = await claimFor(bob, 3, 3, 1000);
    expect(await acceptPeerLandClaim(c, 2000)).toBe(true);
    expect(await acceptPeerLandClaim(c, 2000)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(getLandClaim(3, 3)?.ownerId).toBe(bob.id);
  });

  it('earliest claim wins whatever order peers see them in', async () => {
    const early = await claimFor(alice, 0, 0, 1000);
    const late = await claimFor(bob, 0, 0, 2000);

    await acceptPeerLandClaim(late, 5000);
    await acceptPeerLandClaim(early, 5000);
    expect(getLandClaim(0, 0)?.ownerId).toBe(alice.id);

    _resetLandClaimsForTest();
    await acceptPeerLandClaim(early, 5000);
    await acceptPeerLandClaim(late, 5000);
    expect(getLandClaim(0, 0)?.ownerId).toBe(alice.id);
  });

  it('refuses claims from the future', async () => {
    const c = await claimFor(bob, 4, 4, 10 * 60_000);
    expect(await acceptPeerLandClaim(c, 0)).toBe(false);
  });

  it('merges a backfill list and survives a reload', async () => {
    const list = [await claimFor(bob, 5, 5, 1000), await claimFor(bob, 6, 5, 1000)];
    expect(await mergeLandClaims(list, 2000)).toBe(2);
    expect(await mergeLandClaims(list, 2000)).toBe(0);
    const stored = localStorage.getItem('brain-land-claims-v1');
    expect(stored && JSON.parse(stored)).toHaveLength(2);
  });
});

describe('block claims as plots', () => {
  it('folds a filled rectangle into one plot', async () => {
    const cells: LandClaim[] = [];
    for (let cz = 0; cz < 2; cz++) for (let cx = 0; cx < 3; cx++) cells.push(await claimFor(alice, cx, cz, 1000));
    const plots = claimsToPlots(cells);
    expect(plots).toHaveLength(1);
    expect(plots[0].cellRect).toEqual({ cx0: 0, cz0: 0, cx1: 3, cz1: 2 });
    expect(plots[0].priceSwarm).toBe(6 * BOX_PRICE_SWARM);
  });

  it('keeps an L-shape as separate rects that cover every cell exactly once', async () => {
    const coords: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [0, 2], [5, 2]];
    const cells = await Promise.all(coords.map(([x, z]) => claimFor(alice, x, z, 1000)));
    const plots = claimsToPlots(cells);
    const covered = plots.reduce((n, p) => n + (p.cellRect.cx1 - p.cellRect.cx0) * (p.cellRect.cz1 - p.cellRect.cz0), 0);
    expect(covered).toBe(coords.length);
  });

  it('gates building by block owner', async () => {
    recordLocalLandClaims([await claimFor(alice, 7, 7, 1000)], 2000);
    expect(canBuildAtCell(7, 7, alice.id).ok).toBe(true);
    expect(canBuildAtCell(7, 7, bob.id).ok).toBe(false);
    expect(canBuildAtCell(8, 7, bob.id).ok).toBe(true);
  });
});

describe('claimBlockWithMarker', () => {
  it('claims one free block for one block\'s price', async () => {
    const deps = depsFor(alice);
    const res = await claimBlockWithMarker({ cx: 2, cz: -1, ownerId: alice.id }, deps);
    expect(res.ok).toBe(true);
    expect(deps.burned).toEqual([BLOCK_PRICE_SWARM]);
    expect(getPlotAtCell(2, -1)?.ownerId).toBe(alice.id);
    expect(getPlotAtCell(3, -1)).toBeNull();
    expect(listLandClaims()).toHaveLength(1);
  });

  it('refuses a block someone else owns, without charging', async () => {
    recordLocalLandClaims([await claimFor(bob, 2, 2, 1000)], 2000);
    const deps = depsFor(alice);
    const res = await claimBlockWithMarker({ cx: 2, cz: 2, ownerId: alice.id }, deps);
    expect(res.ok).toBe(false);
    expect(deps.burned).toEqual([]);
  });

  it('refuses when SWARM is short, without claiming', async () => {
    const deps = depsFor(alice, BLOCK_PRICE_SWARM - 1);
    const res = await claimBlockWithMarker({ cx: 0, cz: 9, ownerId: alice.id }, deps);
    expect(res.ok).toBe(false);
    expect(getPlotAtCell(0, 9)).toBeNull();
  });

  it('refuses when the key is locked, without charging', async () => {
    const deps = { ...depsFor(alice), getPrivateKey: async () => null };
    const res = await claimBlockWithMarker({ cx: 0, cz: 8, ownerId: alice.id }, deps);
    expect(res.ok).toBe(false);
    expect(getPlotAtCell(0, 8)).toBeNull();
  });

  it('refuses legacy commons', async () => {
    const commons: LandPlot = {
      id: 'plot:road', ownerId: bob.id, cellRect: { cx0: 0, cz0: 20, cx1: 4, cz1: 21 },
      anchorId: 'swarm-shared-village', priceSwarm: 0, claimedAt: 1, unlocksLandmarks: false,
      kind: 'commons', label: 'Main Road',
    };
    replaceLegacyLandPlots([commons]);
    const res = await claimBlockWithMarker({ cx: 1, cz: 20, ownerId: alice.id }, depsFor(alice));
    expect(res.ok).toBe(false);
  });
});

describe('migrateLegacyPlots', () => {
  it('carries own private plots into signed block claims and keeps commons', async () => {
    const own: LandPlot = {
      id: 'plot:mine', ownerId: alice.id, cellRect: { cx0: 10, cz0: 10, cx1: 12, cz1: 11 },
      anchorId: 'swarm-shared-village', priceSwarm: 6, claimedAt: 500, unlocksLandmarks: true, kind: 'private',
    };
    const road: LandPlot = { ...own, id: 'plot:road', kind: 'commons', cellRect: { cx0: 0, cz0: 30, cx1: 2, cz1: 31 } };
    replaceLegacyLandPlots([own, road]);

    const sent: LandClaim[] = [];
    attachLandClaimGossip((c) => sent.push(c));
    const n = await migrateLegacyPlots(alice.id, depsFor(alice));
    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    expect(getLandClaim(10, 10)?.claimedAt).toBe(500);
    expect(getLandClaim(11, 10)?.ownerId).toBe(alice.id);
    expect(loadLegacyLandPlots().map((p) => p.id)).toEqual(['plot:road']);
    // Still owned, and still exactly one plot covering the old rect.
    expect(loadLandPlots().filter((p) => p.ownerId === alice.id && p.kind === 'private')).toHaveLength(1);
    expect(await migrateLegacyPlots(alice.id, depsFor(alice))).toBe(0);
  });

  it('waits when the key is locked', async () => {
    const own: LandPlot = {
      id: 'plot:mine', ownerId: alice.id, cellRect: { cx0: 0, cz0: 0, cx1: 1, cz1: 1 },
      anchorId: 'swarm-shared-village', priceSwarm: 3, claimedAt: 500, unlocksLandmarks: true, kind: 'private',
    };
    replaceLegacyLandPlots([own]);
    const n = await migrateLegacyPlots(alice.id, { ...depsFor(alice), getPrivateKey: async () => null });
    expect(n).toBe(0);
    expect(loadLegacyLandPlots()).toHaveLength(1);
    expect(getPlotAtCell(0, 0)?.ownerId).toBe(alice.id);
  });
});

describe('migrateLegacyPlots with a rival on one cell', () => {
  it('lets the earlier claim keep its block and moves ours to the nearest free block', async () => {
    recordLocalLandClaims([await claimFor(bob, 41, 40, 100)], 2000);
    const own: LandPlot = {
      id: 'plot:contested', ownerId: alice.id, cellRect: { cx0: 40, cz0: 40, cx1: 42, cz1: 41 },
      anchorId: 'swarm-shared-village', priceSwarm: 6, claimedAt: 500, unlocksLandmarks: true, kind: 'private',
    };
    replaceLegacyLandPlots([own]);
    await migrateLegacyPlots(alice.id, depsFor(alice));
    expect(getLandClaim(40, 40)?.ownerId).toBe(alice.id);
    expect(getLandClaim(41, 40)?.ownerId).toBe(bob.id);
    expect(canBuildAtCell(41, 40, bob.id).ok).toBe(true);
    expect(canBuildAtCell(41, 40, alice.id).ok).toBe(false);
    // Both paid blocks are held, so the legacy record can go.
    expect(listLandClaims().filter((c) => c.ownerId === alice.id)).toHaveLength(2);
    expect(loadLegacyLandPlots()).toEqual([]);
  });

  it('keeps the legacy plot while the key is locked', async () => {
    recordLocalLandClaims([await claimFor(bob, 41, 40, 100)], 2000);
    const own: LandPlot = {
      id: 'plot:contested', ownerId: alice.id, cellRect: { cx0: 40, cz0: 40, cx1: 42, cz1: 41 },
      anchorId: 'swarm-shared-village', priceSwarm: 6, claimedAt: 500, unlocksLandmarks: true, kind: 'private',
    };
    replaceLegacyLandPlots([own]);
    await migrateLegacyPlots(alice.id, { ...depsFor(alice), getPrivateKey: async () => null });
    expect(loadLegacyLandPlots().map((p) => p.id)).toEqual(['plot:contested']);
    // The signed claim, not the kept legacy record, decides that cell.
    expect(getPlotAtCell(41, 40)?.ownerId).toBe(bob.id);
  });
});

describe('water', () => {
  const water = (cx: number) => cx >= 90;

  it('refuses to claim a water block, without charging', async () => {
    const deps = { ...depsFor(alice), isWater: water };
    const res = await claimBlockWithMarker({ cx: 95, cz: 0, ownerId: alice.id }, deps);
    expect(res.ok).toBe(false);
    expect(deps.burned).toEqual([]);
  });

  it('every peer refuses water claims', async () => {
    installLandClaimRules(water);
    expect(await acceptPeerLandClaim(await claimFor(bob, 95, 0, 1000), 2000)).toBe(false);
    expect(await acceptPeerLandClaim(await claimFor(bob, 5, 0, 1000), 2000)).toBe(true);
  });
});

describe('displaced blocks move to the next free land block', () => {
  it('an earlier owner coming online keeps the block; the later buyer is moved, not charged again', async () => {
    // A and B are online; A buys (5, 5).
    const deps = depsFor(alice);
    expect((await claimBlockWithMarker({ cx: 5, cz: 5, ownerId: alice.id }, deps)).ok).toBe(true);
    // C (bob here) comes online with an older claim on the same block.
    expect(await acceptPeerLandClaim(await claimFor(bob, 5, 5, 500))).toBe(true);
    expect(getLandClaim(5, 5)?.ownerId).toBe(bob.id);

    const { moved } = await reconcileDeeds(alice.id, deps);
    expect(moved).toBe(1);
    const mine = listLandClaims().filter((c) => c.ownerId === alice.id);
    expect(mine).toHaveLength(1);
    expect(Math.max(Math.abs(mine[0].cx - 5), Math.abs(mine[0].cz - 5))).toBe(1);
    expect(loadDeeds(alice.id)[0]).toMatchObject({ cx: mine[0].cx, cz: mine[0].cz, moves: 1 });
    expect(deps.burned).toEqual([BLOCK_PRICE_SWARM]);
    // Nothing left to do.
    expect((await reconcileDeeds(alice.id, deps)).moved).toBe(0);
  });

  it('never moves a block onto water or someone else\'s land', async () => {
    const isWater = (cx: number, cz: number) => cz === 4; // the row "behind" (5, 5)
    const deps = { ...depsFor(alice), isWater };
    await claimBlockWithMarker({ cx: 5, cz: 5, ownerId: alice.id }, deps);
    recordLocalLandClaims([await claimFor(bob, 4, 5, 400)], Date.now());
    await acceptPeerLandClaim(await claimFor(bob, 5, 5, 500));
    await reconcileDeeds(alice.id, deps);
    const [spot] = listLandClaims().filter((c) => c.ownerId === alice.id);
    expect(isWater(spot.cx, spot.cz)).toBe(false);
    expect(spot).not.toMatchObject({ cx: 4, cz: 5 });
  });
});

describe('land grid projection', () => {
  it('draws a block exactly where ownership reads it, far from the origin', () => {
    const ref = {
      normal: [0, 1, 0] as [number, number, number],
      right: [1, 0, 0] as [number, number, number],
      forward: [0, 0, 1] as [number, number, number],
    };
    for (const [tx, tz] of [[0, 0], [37.5, -12.5], [1000, 0], [-640, 820]]) {
      const p = tangentToSurfaceLocal(tx, tz, 0.05, ref);
      expect(p[0]).toBeCloseTo(tx, 6);
      expect(p[2]).toBeCloseTo(tz, 6);
    }
  });
});

describe('deeds survive interruptions', () => {
  it('keeps finished moves when the key locks midway, so a retry never claims extra blocks', async () => {
    const deps = depsFor(alice);
    await claimBlockWithMarker({ cx: 20, cz: 20, ownerId: alice.id }, deps);
    await claimBlockWithMarker({ cx: 30, cz: 30, ownerId: alice.id }, deps);
    await acceptPeerLandClaim(await claimFor(bob, 20, 20, 500));
    await acceptPeerLandClaim(await claimFor(bob, 30, 30, 500));

    // Deed 1: restore attempt + move = 2 signatures; then the key locks.
    let calls = 0;
    const flaky = { ...deps, getPrivateKey: async () => (++calls <= 2 ? alice.privateKey : null) };
    expect((await reconcileDeeds(alice.id, flaky)).moved).toBe(1);
    await reconcileDeeds(alice.id, deps);
    expect(listLandClaims().filter((c) => c.ownerId === alice.id)).toHaveLength(2);
  });

  it('keeps a deed bought while a reconcile is waiting on the key', async () => {
    const deps = depsFor(alice);
    await claimBlockWithMarker({ cx: 50, cz: 50, ownerId: alice.id }, deps);
    await acceptPeerLandClaim(await claimFor(bob, 50, 50, 500));
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const slow = { ...deps, getPrivateKey: async () => { await gate; return alice.privateKey; } };
    const pending = reconcileDeeds(alice.id, slow);
    await claimBlockWithMarker({ cx: 60, cz: 60, ownerId: alice.id }, deps);
    release();
    await pending;
    expect(loadDeeds(alice.id)).toHaveLength(2);
  });
});

describe('water rule on claims already stored', () => {
  it('drops stored water claims when the rule is installed', async () => {
    recordLocalLandClaims([await claimFor(bob, 95, 1, 1000), await claimFor(bob, 5, 1, 1000)], 2000);
    installLandClaimRules((cx) => cx >= 90);
    expect(getLandClaim(95, 1)).toBeNull();
    expect(getLandClaim(5, 1)?.ownerId).toBe(bob.id);
    expect(JSON.parse(localStorage.getItem('brain-land-claims-v1') ?? '[]')).toHaveLength(1);
  });
});
