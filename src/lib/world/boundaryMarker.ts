/**
 * boundaryMarker — claim land one grid block at a time.
 *
 * The Boundary marker is a held tool (`BOUNDARY_MARKER_ID`). With it in
 * hand the player presses and holds on a grid block; when the hold
 * completes (`CLAIM_HOLD_MS`) that one block is claimed for
 * `BOX_PRICE_SWARM` SWARM:
 *
 *   1. the block must be free (no block claim, no legacy plot, no commons);
 *   2. the claim is signed with the identity key (so it can sync);
 *   3. the SWARM fee is burned;
 *   4. the claim is recorded and gossiped (`landClaimsStore`).
 *
 * Signing happens before the burn, so a locked key never costs SWARM.
 *
 * The small hold store here is shared by the in-world layer (which picks
 * the block under the pointer) and the HUD (which offers the same hold
 * on a button for the block in front of the player).
 */
import { burnSwarm, getSwarmBalance } from '@/lib/blockchain/token';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import type { Vec3 } from '@/lib/brain/earth';
import { tangentToSurfaceLocal } from '@/lib/world/landPermissions';
import { getCachedPrivateKey, getCurrentUser } from '@/lib/auth';
import {
  BOX_PRICE_SWARM,
  PLOT_CELL,
  getPlotAtCell,
  loadLegacyLandPlots,
  plotKind,
  replaceLegacyLandPlots,
  type LandPlot,
} from '@/lib/world/landPlots';
import {
  LAND_CLAIM_TYPE,
  getLandClaim,
  listLandClaims,
  recordLocalLandClaims,
  setLandClaimValidator,
  signLandClaim,
  verifyLandClaim,
  type LandClaim,
} from '@/lib/world/landClaimsStore';

export const BOUNDARY_MARKER_ID = 'tool_boundary_marker';
/** How long the press must be held to claim a block. */
export const CLAIM_HOLD_MS = 1200;
export const BLOCK_PRICE_SWARM = BOX_PRICE_SWARM;

export function isBoundaryMarker(prefabId: string | null | undefined): boolean {
  return prefabId === BOUNDARY_MARKER_ID;
}

export type BlockStatus = 'free' | 'own' | 'foreign' | 'commons' | 'water';

function surfaceIsOcean(tx: number, tz: number): boolean {
  const p = tangentToSurfaceLocal(tx, tz);
  const len = Math.hypot(p[0], p[1], p[2]) || 1;
  const n: Vec3 = [p[0] / len, p[1] / len, p[2] / len];
  return sampleSurfaceClass(n) === 'ocean';
}

/**
 * True when any part of the block is open water: its centre or any of
 * its four corners samples as ocean. The terrain is the same pure
 * function on every peer, so every peer gives the same answer.
 */
export function isWaterBlock(cx: number, cz: number): boolean {
  try {
    const x0 = cx * PLOT_CELL, z0 = cz * PLOT_CELL;
    const pts: Array<[number, number]> = [
      [x0 + PLOT_CELL / 2, z0 + PLOT_CELL / 2],
      [x0, z0], [x0 + PLOT_CELL, z0], [x0, z0 + PLOT_CELL], [x0 + PLOT_CELL, z0 + PLOT_CELL],
    ];
    return pts.some(([tx, tz]) => surfaceIsOcean(tx, tz));
  } catch {
    return false;
  }
}

/** Apply the shared land rules to every claim, local or from peers. */
export function installLandClaimRules(isWater: (cx: number, cz: number) => boolean = isWaterBlock): void {
  setLandClaimValidator((c) => !isWater(c.cx, c.cz));
}

/** Who holds a block, from `actorId`'s point of view. */
export function blockStatus(
  cx: number,
  cz: number,
  actorId: string,
  isWater: (cx: number, cz: number) => boolean = isWaterBlock,
): { status: BlockStatus; plot: LandPlot | null } {
  const plot = getPlotAtCell(cx, cz);
  if (!plot) return isWater(cx, cz) ? { status: 'water', plot: null } : { status: 'free', plot: null };
  if (plotKind(plot) === 'commons') return { status: 'commons', plot };
  return { status: plot.ownerId === actorId ? 'own' : 'foreign', plot };
}

export type ClaimResult =
  | { ok: true; claim: LandClaim }
  | { ok: false; reason: string };

export interface ClaimDeps {
  getUser: () => { id: string; publicKey?: string } | null;
  getPrivateKey: () => Promise<string | null>;
  getBalance: (id: string) => Promise<number>;
  burn: (p: { from: string; amount: number; reason: string }) => Promise<unknown>;
  now: () => number;
  /** Is this block water? Defaults to the real terrain (`isWaterBlock`). */
  isWater?: (cx: number, cz: number) => boolean;
}

const defaultDeps: ClaimDeps = {
  getUser: () => getCurrentUser(),
  getPrivateKey: () => getCachedPrivateKey().catch(() => null),
  getBalance: (id) => getSwarmBalance(id),
  burn: (p) => burnSwarm(p),
  now: () => Date.now(),
};

async function signAs(
  deps: ClaimDeps,
  ownerId: string,
  unsigned: Omit<Parameters<typeof signLandClaim>[0], 'ownerId' | 'type'>[],
): Promise<LandClaim[] | null> {
  const user = deps.getUser();
  if (!user?.publicKey || user.id !== ownerId) return null;
  const key = await deps.getPrivateKey();
  if (!key) return null;
  const out: LandClaim[] = [];
  for (const u of unsigned) {
    const signed = await signLandClaim({ ...u, type: LAND_CLAIM_TYPE, ownerId }, key, user.publicKey);
    if (!(await verifyLandClaim(signed))) return null;
    out.push(signed);
  }
  return out;
}

/** Claim one grid block for `ownerId`, paying `BLOCK_PRICE_SWARM`. */
export async function claimBlockWithMarker(
  input: { cx: number; cz: number; ownerId: string },
  deps: ClaimDeps = defaultDeps,
): Promise<ClaimResult> {
  const { cx, cz, ownerId } = input;
  if (!ownerId) return { ok: false, reason: 'Sign in to claim land.' };
  const { status } = blockStatus(cx, cz, ownerId, deps.isWater ?? isWaterBlock);
  if (status === 'water') return { ok: false, reason: "Water can't be claimed." };
  if (status === 'own') return { ok: false, reason: 'You already own this block.' };
  if (status === 'foreign') return { ok: false, reason: 'This block belongs to another player.' };
  if (status === 'commons') return { ok: false, reason: 'This is communal land.' };

  const balance = await deps.getBalance(ownerId).catch(() => 0);
  if (balance < BLOCK_PRICE_SWARM) {
    return { ok: false, reason: `Claiming a block costs ${BLOCK_PRICE_SWARM} SWARM.` };
  }

  const signed = await signAs(deps, ownerId, [{
    cx, cz, claimedAt: deps.now(), priceSwarm: BLOCK_PRICE_SWARM,
  }]);
  if (!signed) return { ok: false, reason: 'Unlock your account to claim land.' };
  const claim = signed[0];

  // Re-check: a peer's claim may have arrived while signing.
  if (getPlotAtCell(cx, cz)) return { ok: false, reason: 'Someone just claimed this block.' };

  try {
    await deps.burn({ from: ownerId, amount: BLOCK_PRICE_SWARM, reason: 'land-block-claim' });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not charge SWARM.' };
  }
  // Paid for: remember the deed, so if an earlier owner surfaces later
  // the block is moved to the next free land block instead of lost.
  addDeeds(ownerId, [{
    id: `marker:${cx}:${cz}:${claim.claimedAt}`,
    cx, cz, claimedAt: claim.claimedAt, priceSwarm: BLOCK_PRICE_SWARM,
  }]);
  const kept = recordLocalLandClaims([claim], deps.now());
  if (kept.length === 0) {
    // Lost a race after paying: the deed relocates it on the next pass.
    void reconcileDeeds(ownerId, deps);
    return { ok: false, reason: 'Someone just claimed this block. Yours will be placed on the nearest free block.' };
  }
  return { ok: true, claim: kept[0] };
}

// ── Deeds: blocks this device's owner has paid for ──────────────────────

/**
 * A deed is a paid-for block that this owner must end up holding
 * somewhere. Claims can be displaced: an owner who was offline (or whose
 * old walk-claimed plot only now syncs) may hold an earlier claim on the
 * same block, and the earliest claim wins on every peer. When that
 * happens the loser's device moves the deed to the nearest free,
 * non-water block and signs a fresh claim there, at no extra cost.
 */
export interface LandDeed {
  id: string;
  /** Where the deed currently sits. */
  cx: number;
  cz: number;
  /** Claim time for this spot (original time, or the time it was moved). */
  claimedAt: number;
  priceSwarm: number;
  /** Legacy plot this deed came from, if any. */
  legacyPlotId?: string;
  /** Times this deed has been moved. */
  moves?: number;
}

const DEEDS_KEY = 'brain-land-deeds-v1';
/** How far (in blocks) to look for a free block when moving a deed. */
export const MAX_RELOCATE_RING = 48;

function deedsKey(ownerId: string): string { return `${DEEDS_KEY}:${ownerId}`; }

export function loadDeeds(ownerId: string): LandDeed[] {
  try {
    const raw = globalThis.localStorage?.getItem(deedsKey(ownerId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as LandDeed[]).filter((d) => d && Number.isInteger(d.cx) && Number.isInteger(d.cz)) : [];
  } catch {
    return [];
  }
}

function saveDeeds(ownerId: string, deeds: LandDeed[]): void {
  try { globalThis.localStorage?.setItem(deedsKey(ownerId), JSON.stringify(deeds)); } catch { /* storage blocked */ }
}

function addDeeds(ownerId: string, add: LandDeed[]): void {
  const deeds = loadDeeds(ownerId);
  const ids = new Set(deeds.map((d) => d.id));
  for (const d of add) if (!ids.has(d.id)) { deeds.push(d); ids.add(d.id); }
  saveDeeds(ownerId, deeds);
}

function heldBy(cx: number, cz: number, ownerId: string): boolean {
  return getLandClaim(cx, cz)?.ownerId === ownerId;
}

/**
 * Nearest block to (cx, cz), ring by ring, that nobody holds and is not
 * water. Fixed visiting order, so the same inputs pick the same block.
 */
export function nearestFreeLandBlock(
  cx: number,
  cz: number,
  isWater: (cx: number, cz: number) => boolean,
  taken: Set<string> = new Set(),
): { cx: number; cz: number } | null {
  for (let r = 1; r <= MAX_RELOCATE_RING; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (taken.has(`${x}:${z}`)) continue;
        if (getPlotAtCell(x, z)) continue;
        if (isWater(x, z)) continue;
        return { cx: x, cz: z };
      }
    }
  }
  return null;
}

let reconciling = false;

/**
 * Make sure every deed is held. For each deed not held by its owner:
 *   1. claim its own block again with its claim time (wins if no earlier
 *      claim exists there and it is not water), else
 *   2. move it to the nearest free land block and claim that, now.
 * Returns how many deeds were moved. A locked key just waits.
 */
export async function reconcileDeeds(
  ownerId: string,
  deps: ClaimDeps = defaultDeps,
): Promise<{ moved: number; restored: number }> {
  const out = { moved: 0, restored: 0 };
  if (!ownerId || reconciling) return out;
  reconciling = true;
  try {
    const isWater = deps.isWater ?? isWaterBlock;
    const deeds = loadDeeds(ownerId);
    const taken = new Set<string>();
    let changed = false;
    for (const deed of deeds) {
      if (heldBy(deed.cx, deed.cz, ownerId)) continue;
      // 1. Our own spot, at our own claim time.
      if (!isWater(deed.cx, deed.cz)) {
        const signed = await signAs(deps, ownerId, [{
          cx: deed.cx, cz: deed.cz, claimedAt: deed.claimedAt, priceSwarm: deed.priceSwarm,
        }]);
        if (!signed) return out; // key locked
        recordLocalLandClaims(signed, deps.now());
        if (heldBy(deed.cx, deed.cz, ownerId)) { out.restored += 1; continue; }
      }
      // 2. Displaced (or water): the next free land block.
      const spot = nearestFreeLandBlock(deed.cx, deed.cz, isWater, taken);
      if (!spot) continue;
      const at = deps.now();
      const signed = await signAs(deps, ownerId, [{ cx: spot.cx, cz: spot.cz, claimedAt: at, priceSwarm: deed.priceSwarm }]);
      if (!signed) return out;
      recordLocalLandClaims(signed, at);
      if (heldBy(spot.cx, spot.cz, ownerId)) {
        deed.cx = spot.cx;
        deed.cz = spot.cz;
        deed.claimedAt = at;
        deed.moves = (deed.moves ?? 0) + 1;
        taken.add(`${spot.cx}:${spot.cz}`);
        changed = true;
        out.moved += 1;
      }
    }
    if (changed) saveDeeds(ownerId, deeds);
    return out;
  } finally {
    reconciling = false;
  }
}

/** Largest legacy plot carried into block claims in one go. */
const MAX_MIGRATE_CELLS_PER_PLOT = 4096;

/**
 * Carry this member's own private walk-claimed plots into signed block
 * claims so they sync to peers like any new claim. Already paid for, so
 * each block becomes a deed with its share of the original price and the
 * plot's original claim time; nothing is charged. Blocks that are water,
 * or that an earlier claim already holds, are moved to the nearest free
 * land block (`reconcileDeeds`). A legacy plot leaves the legacy list
 * (a backup copy stays in localStorage) once every one of its deeds is
 * held. Commons and other owners' plots are left alone. Safe to call
 * repeatedly; a locked key just means "try again later".
 */
export async function migrateLegacyPlots(
  ownerId: string,
  deps: ClaimDeps = defaultDeps,
): Promise<number> {
  if (!ownerId) return 0;
  const legacy = loadLegacyLandPlots();
  const mine = legacy.filter((p) => p.ownerId === ownerId && plotKind(p) === 'private');
  if (mine.length === 0) return 0;

  const before = listLandClaimsCount(ownerId);
  for (const plot of mine) {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    const count = Math.max(0, cx1 - cx0) * Math.max(0, cz1 - cz0);
    if (count === 0 || count > MAX_MIGRATE_CELLS_PER_PLOT) continue;
    const share = (plot.priceSwarm || 0) / count;
    const add: LandDeed[] = [];
    for (let cz = cz0; cz < cz1; cz++) {
      for (let cx = cx0; cx < cx1; cx++) {
        add.push({
          id: `legacy:${plot.id}:${cx}:${cz}`,
          cx, cz,
          claimedAt: plot.claimedAt || deps.now(),
          priceSwarm: share,
          legacyPlotId: plot.id,
        });
      }
    }
    addDeeds(ownerId, add);
  }
  await reconcileDeeds(ownerId, deps);

  // A legacy plot is done once each of its deeds is held somewhere.
  const deeds = loadDeeds(ownerId);
  const migrated = new Set<string>();
  for (const plot of mine) {
    const own = deeds.filter((d) => d.legacyPlotId === plot.id);
    if (own.length > 0 && own.every((d) => heldBy(d.cx, d.cz, ownerId))) migrated.add(plot.id);
  }
  if (migrated.size > 0) {
    try {
      const backupKey = 'brain-land-plots-v1:migrated-backup';
      const prev = JSON.parse(globalThis.localStorage?.getItem(backupKey) ?? '[]') as LandPlot[];
      const moved = legacy.filter((p) => migrated.has(p.id));
      globalThis.localStorage?.setItem(backupKey, JSON.stringify([...prev, ...moved]));
    } catch { /* storage blocked */ }
    replaceLegacyLandPlots(legacy.filter((p) => !migrated.has(p.id)));
  }
  return listLandClaimsCount(ownerId) - before;
}

function listLandClaimsCount(ownerId: string): number {
  let n = 0;
  for (const c of listLandClaims()) if (c.ownerId === ownerId) n += 1;
  return n;
}

// ── Hold state (shared by the world layer and the HUD) ──────────────────

export interface MarkerHoldState {
  /** Block the marker is pointing at, if any. */
  target: { cx: number; cz: number } | null;
  /** Hold progress 0..1 (0 when not holding). */
  progress: number;
  /** True while the claim is being signed / paid. */
  busy: boolean;
  /** The HUD's hold button is pressed (claims the block in front of you). */
  hudPressed: boolean;
}

let hold: MarkerHoldState = { target: null, progress: 0, busy: false, hudPressed: false };
const holdListeners = new Set<(s: MarkerHoldState) => void>();

export function getMarkerHold(): MarkerHoldState { return hold; }

export function setMarkerHold(patch: Partial<MarkerHoldState>): void {
  const next = { ...hold, ...patch };
  if (
    next.progress === hold.progress
    && next.busy === hold.busy
    && next.hudPressed === hold.hudPressed
    && next.target?.cx === hold.target?.cx
    && next.target?.cz === hold.target?.cz
  ) return;
  hold = next;
  for (const fn of holdListeners) {
    try { fn(hold); } catch { /* noop */ }
  }
}

/** Clear everything (marker put away). */
export function resetMarkerHold(): void {
  setMarkerHold({ target: null, progress: 0, busy: false, hudPressed: false });
}

export function subscribeMarkerHold(fn: (s: MarkerHoldState) => void): () => void {
  holdListeners.add(fn);
  try { fn(hold); } catch { /* noop */ }
  return () => { holdListeners.delete(fn); };
}
