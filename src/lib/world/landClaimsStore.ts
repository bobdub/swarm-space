/**
 * landClaimsStore — single-block land ownership, the same for every peer.
 *
 * A claim is one lattice cell (one WALL_PITCH × WALL_PITCH grid block,
 * the cell indices `landPlots.tangentToCell` produces) owned by one
 * identity. Claims are made with the Boundary marker tool
 * (`boundaryMarker.ts`): hold it, press and hold a block, pay
 * `BOX_PRICE_SWARM`, and the block is yours.
 *
 * Trust model:
 *   • Every claim is signed with the owner's identity P-256 key, and a
 *     peer only keeps it when `computeUserId(signerPublicKey) === ownerId`
 *     and the signature verifies, so nobody can claim land in someone
 *     else's name.
 *   • One owner per cell. When two claims for the same cell meet, the
 *     earlier `claimedAt` wins (ties broken by owner id, then signature),
 *     so every peer holding the same claims agrees on the same owner no
 *     matter what order they arrived in.
 *   • Claims from more than 5 minutes in the future are refused.
 *   • The SWARM fee is burned on the claimant's own device before the
 *     claim is published; peers do not re-check that burn.
 *
 * Gossip follows `fireStore`: each new claim is relayed to connected
 * peers (see `p2pPlacementBridge`), a newcomer is handed the full list,
 * and a peer forwards only claims it did not already hold, so the relay
 * stops by itself. Kept in localStorage so ownership survives a reload.
 */
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from '@/lib/crypto';
import { canonicalJsonBytes } from '@/lib/utils/canonicalJson';

export const LAND_CLAIM_TYPE = 'land_claim';
const STORAGE_KEY = 'brain-land-claims-v1';
/** Hard cap on stored claims (cells). */
export const MAX_LAND_CLAIMS = 50_000;
/** Claims this far in the future are refused. */
const FUTURE_SLACK_MS = 5 * 60_000;
/** Cell indices outside this range are refused (no runaway coordinates). */
const MAX_CELL_INDEX = 100_000;

export interface UnsignedLandClaim {
  type: typeof LAND_CLAIM_TYPE;
  /** Cell index along the lattice-origin right axis. */
  cx: number;
  /** Cell index along the lattice-origin forward axis. */
  cz: number;
  ownerId: string;
  /** When the block was claimed (ms). */
  claimedAt: number;
  /** SWARM paid for this block (0 for blocks carried over from old plots). */
  priceSwarm: number;
}

export interface LandClaim extends UnsignedLandClaim {
  signerPublicKey: string;
  signature: string;
}

export function landCellKey(cx: number, cz: number): string {
  return `${cx}:${cz}`;
}

type Listener = () => void;
type Gossip = (claim: LandClaim) => void;

const claims = new Map<string, LandClaim>();
const listeners = new Set<Listener>();
let gossip: Gossip | null = null;
let validator: ((c: UnsignedLandClaim) => boolean) | null = null;
let hydrated = false;
let version = 0;

// ── Signing ─────────────────────────────────────────────────────────────

function signingPayload(c: UnsignedLandClaim): Uint8Array {
  return canonicalJsonBytes({
    type: LAND_CLAIM_TYPE,
    cx: c.cx,
    cz: c.cz,
    ownerId: c.ownerId,
    claimedAt: c.claimedAt,
    priceSwarm: c.priceSwarm,
  });
}

function toBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/** Sign with the identity key (base64 PKCS#8 P-256) and its public key (base64). */
export async function signLandClaim(
  unsigned: UnsignedLandClaim,
  privateKey: string,
  publicKey: string,
): Promise<LandClaim> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    toBuffer(signingPayload(unsigned)),
  );
  return { ...unsigned, signerPublicKey: publicKey, signature: arrayBufferToBase64(signature) };
}

async function importVerifyKey(publicKey: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(publicKey);
  try {
    return await crypto.subtle.importKey('spki', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch {
    // Accounts recovered from a private key store the raw point form.
    return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  }
}

function isShortString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** Shape check only; does not verify the signature. */
export function isLandClaimShape(v: unknown): v is LandClaim {
  const c = v as LandClaim | null;
  return !!c
    && c.type === LAND_CLAIM_TYPE
    && Number.isInteger(c.cx) && Math.abs(c.cx) <= MAX_CELL_INDEX
    && Number.isInteger(c.cz) && Math.abs(c.cz) <= MAX_CELL_INDEX
    && isShortString(c.ownerId, 200)
    && Number.isFinite(c.claimedAt) && c.claimedAt > 0
    && Number.isFinite(c.priceSwarm) && c.priceSwarm >= 0
    && isShortString(c.signerPublicKey, 1024)
    && isShortString(c.signature, 1024);
}

/** A claim is valid when its key hashes to the owner id and the signature verifies. */
export async function verifyLandClaim(value: unknown): Promise<boolean> {
  if (!isLandClaimShape(value)) return false;
  try {
    if ((await computeUserId(value.signerPublicKey)) !== value.ownerId) return false;
    const key = await importVerifyKey(value.signerPublicKey);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64ToArrayBuffer(value.signature),
      toBuffer(signingPayload(value)),
    );
  } catch {
    return false;
  }
}

// ── Ordering ────────────────────────────────────────────────────────────

/** True when claim `a` beats claim `b` for the same cell. */
export function claimBeats(a: LandClaim, b: LandClaim): boolean {
  if (a.claimedAt !== b.claimedAt) return a.claimedAt < b.claimedAt;
  if (a.ownerId !== b.ownerId) return a.ownerId < b.ownerId;
  return a.signature < b.signature;
}

// ── Storage ─────────────────────────────────────────────────────────────

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    // Stored claims were verified when they arrived; shape-check only.
    for (const c of list) {
      if (!isLandClaimShape(c)) continue;
      if (!passesRules(c)) continue;
      const k = landCellKey(c.cx, c.cz);
      const prev = claims.get(k);
      if (!prev || claimBeats(c, prev)) claims.set(k, c);
    }
  } catch { /* storage blocked or corrupt */ }
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...claims.values()]));
  } catch { /* storage blocked or full */ }
}

function notify(): void {
  version += 1;
  for (const fn of listeners) {
    try { fn(); } catch { /* noop */ }
  }
}

/**
 * World rule every peer applies to a claim (e.g. "never water"). Set once
 * at boot by `boundaryMarker.installLandClaimRules`; a claim that breaks
 * it is refused locally and from peers alike.
 */
export function setLandClaimValidator(fn: ((c: UnsignedLandClaim) => boolean) | null): void {
  validator = fn;
  if (!fn) return;
  // Claims stored or accepted before the rule existed must obey it too,
  // or this peer would keep (and backfill) land that others refuse.
  hydrate();
  let dropped = 0;
  for (const [k, c] of claims) {
    if (!passesRules(c)) { claims.delete(k); dropped += 1; }
  }
  if (dropped > 0) {
    persist();
    notify();
  }
}

function passesRules(c: LandClaim): boolean {
  if (!validator) return true;
  try { return validator(c); } catch { return false; }
}

/** Would `c` be kept? (Not already held, not beaten, not from the future.) */
function wouldKeep(c: LandClaim, now: number): boolean {
  if (c.claimedAt - now > FUTURE_SLACK_MS) return false;
  if (!passesRules(c)) return false;
  const prev = claims.get(landCellKey(c.cx, c.cz));
  if (!prev) return claims.size < MAX_LAND_CLAIMS;
  if (prev.signature === c.signature && prev.ownerId === c.ownerId) return false;
  return claimBeats(c, prev);
}

function store(c: LandClaim): void {
  claims.set(landCellKey(c.cx, c.cz), c);
}

function copyClaim(c: LandClaim): LandClaim {
  return {
    type: LAND_CLAIM_TYPE,
    cx: c.cx,
    cz: c.cz,
    ownerId: c.ownerId,
    claimedAt: c.claimedAt,
    priceSwarm: c.priceSwarm,
    signerPublicKey: c.signerPublicKey,
    signature: c.signature,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/** The winning claim on a cell, or null. */
export function getLandClaim(cx: number, cz: number): LandClaim | null {
  hydrate();
  return claims.get(landCellKey(cx, cz)) ?? null;
}

export function listLandClaims(): LandClaim[] {
  hydrate();
  return [...claims.values()];
}

/** Bumps on every change; lets derived views cache cheaply. */
export function landClaimsVersion(): number {
  hydrate();
  return version;
}

/**
 * Record a claim made on this device (already signed and verified by
 * the caller) and tell the other peers. Returns false when the cell is
 * already held by an earlier claim.
 */
export function recordLocalLandClaims(list: LandClaim[], now = Date.now()): LandClaim[] {
  hydrate();
  const fresh: LandClaim[] = [];
  for (const raw of list) {
    if (!isLandClaimShape(raw)) continue;
    const c = copyClaim(raw);
    if (!wouldKeep(c, now)) continue;
    store(c);
    fresh.push(c);
  }
  if (fresh.length > 0) {
    persist();
    notify();
    for (const c of fresh) {
      try { gossip?.(c); } catch { /* noop */ }
    }
  }
  return fresh;
}

/** A claim from another peer. Returns true if it was new and kept. */
export async function acceptPeerLandClaim(payload: unknown, now = Date.now()): Promise<boolean> {
  hydrate();
  if (!isLandClaimShape(payload)) return false;
  const c = copyClaim(payload);
  if (!wouldKeep(c, now)) return false;
  if (!(await verifyLandClaim(c))) return false;
  // Re-check: another claim for the cell may have landed while verifying.
  if (!wouldKeep(c, now)) return false;
  store(c);
  persist();
  notify();
  try { gossip?.(c); } catch { /* noop */ }
  return true;
}

/** Merge a peer's full list (newcomer backfill). Returns how many were new. */
export async function mergeLandClaims(payload: unknown, now = Date.now()): Promise<number> {
  hydrate();
  if (!Array.isArray(payload)) return 0;
  const fresh: LandClaim[] = [];
  for (const raw of payload.slice(0, MAX_LAND_CLAIMS)) {
    if (!isLandClaimShape(raw)) continue;
    const c = copyClaim(raw);
    if (!wouldKeep(c, now)) continue;
    if (!(await verifyLandClaim(c))) continue;
    if (!wouldKeep(c, now)) continue;
    store(c);
    fresh.push(c);
  }
  if (fresh.length > 0) {
    persist();
    notify();
    for (const c of fresh) {
      try { gossip?.(c); } catch { /* noop */ }
    }
  }
  return fresh.length;
}

export function attachLandClaimGossip(fn: Gossip): void {
  gossip = fn;
}

export function subscribeLandClaims(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetLandClaimsForTest(): void {
  claims.clear();
  listeners.clear();
  gossip = null;
  validator = null;
  hydrated = true;
  version += 1;
}
