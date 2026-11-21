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
import { getCachedPrivateKey, getCurrentUser } from '@/lib/auth';
import {
  BOX_PRICE_SWARM,
  getPlotAtCell,
  loadLegacyLandPlots,
  plotKind,
  replaceLegacyLandPlots,
  type LandPlot,
} from '@/lib/world/landPlots';
import {
  LAND_CLAIM_TYPE,
  getLandClaim,
  recordLocalLandClaims,
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

export type BlockStatus = 'free' | 'own' | 'foreign' | 'commons';

/** Who holds a block, from `actorId`'s point of view. */
export function blockStatus(cx: number, cz: number, actorId: string): { status: BlockStatus; plot: LandPlot | null } {
  const plot = getPlotAtCell(cx, cz);
  if (!plot) return { status: 'free', plot: null };
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
  const { status } = blockStatus(cx, cz, ownerId);
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
  const kept = recordLocalLandClaims([claim], deps.now());
  if (kept.length === 0) return { ok: false, reason: 'Someone just claimed this block.' };
  return { ok: true, claim: kept[0] };
}

/** Largest legacy plot carried into block claims in one go. */
const MAX_MIGRATE_CELLS_PER_PLOT = 4096;

/**
 * Carry this member's own private walk-claimed plots into signed block
 * claims so they sync to peers like any new claim. Already paid for, so
 * the blocks record their share of the original price and nothing is
 * charged. Migrated plots leave the legacy list (a backup copy stays in
 * localStorage). Commons and other owners' plots are left alone. Safe
 * to call repeatedly; a locked key just means "try again later".
 */
export async function migrateLegacyPlots(
  ownerId: string,
  deps: ClaimDeps = defaultDeps,
): Promise<number> {
  if (!ownerId) return 0;
  const legacy = loadLegacyLandPlots();
  const mine = legacy.filter((p) => p.ownerId === ownerId && plotKind(p) === 'private');
  if (mine.length === 0) return 0;

  const migrated = new Set<string>();
  let cells = 0;
  for (const plot of mine) {
    const { cx0, cz0, cx1, cz1 } = plot.cellRect;
    const count = Math.max(0, cx1 - cx0) * Math.max(0, cz1 - cz0);
    if (count === 0 || count > MAX_MIGRATE_CELLS_PER_PLOT) continue;
    const share = (plot.priceSwarm || 0) / count;
    const unsigned: Array<{ cx: number; cz: number; claimedAt: number; priceSwarm: number }> = [];
    for (let cz = cz0; cz < cz1; cz++) {
      for (let cx = cx0; cx < cx1; cx++) {
        const held = getLandClaim(cx, cz);
        if (held && held.ownerId === ownerId) continue;
        unsigned.push({ cx, cz, claimedAt: plot.claimedAt || deps.now(), priceSwarm: share });
      }
    }
    const signed = await signAs(deps, ownerId, unsigned);
    if (!signed) return cells; // key locked — keep the rest for later
    recordLocalLandClaims(signed, deps.now());
    cells += signed.length;
    migrated.add(plot.id);
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
  return cells;
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
