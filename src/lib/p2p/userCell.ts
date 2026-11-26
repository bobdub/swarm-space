/**
 * User Cells — User-owned private meshes.
 *
 * Thin wrapper over the archived Builder Mode engine. Each cell is an
 * on-demand, locally-persisted handle the user can create / enter / share.
 *
 * Created on first "Create Cell" click — no autoStart on boot.
 */

import {
  loadConnectionState,
  updateConnectionState,
} from './connectionState';
import { getCurrentUser } from '../auth';

export interface UserCell {
  cellId: string;
  name: string;
  /** Never-rotate identity anchor of the cell owner (sha256 of pubkey). */
  ownerUserId: string;
  /** Human-readable handle used for cross-mesh recall. */
  ownerUsername: string;
  /** Last-known peerId — a CACHE, not a contract. Refreshed at dial-time. */
  ownerPeerId: string;
  createdAt: number;
  lastEnteredAt: number | null;
  /**
   * Public cells are announced on the global `public-cells` registry and
   * relay their live content to the main mesh. Private (default) cells never do.
   */
  isPublic?: boolean;
  /** When the cell last went public; content older than this stays in the cell. */
  publicSince?: number;
}

const CELLS_KEY = 'user-cells';
const ACTIVE_KEY = 'active-user-cell';
const CELL_ID_PREFIX = 'u/';

type CellsRecord = Record<string, UserCell>;
type CellsListener = (cells: UserCell[]) => void;
type ActiveListener = (cell: UserCell | null) => void;

const cellsListeners = new Set<CellsListener>();
const activeListeners = new Set<ActiveListener>();

function hex(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCells(): CellsRecord {
  try {
    const raw = localStorage.getItem(CELLS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CellsRecord) : {};
  } catch {
    return {};
  }
}

function writeCells(record: CellsRecord): void {
  try {
    localStorage.setItem(CELLS_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('[userCell] persist failed', err);
  }
  notifyCells(record);
}

function notifyCells(record: CellsRecord): void {
  const list = Object.values(record).sort((a, b) => b.createdAt - a.createdAt);
  for (const fn of cellsListeners) {
    try { fn(list); } catch { /* ignore */ }
  }
}

function notifyActive(cell: UserCell | null): void {
  for (const fn of activeListeners) {
    try { fn(cell); } catch { /* ignore */ }
  }
}

async function getOwnerPeerId(): Promise<string> {
  const m = await import('./builderMode.standalone-archived');
  return m.getStandaloneBuilderMode().getPeerId();
}

/** Parse a username + suffix out of a cellId. Returns null for legacy IDs. */
function parseUsernameCellId(cellId: string): { username: string; suffix: string } | null {
  const trimmed = cellId.trim();
  if (!trimmed.startsWith(CELL_ID_PREFIX)) return null;
  const rest = trimmed.slice(CELL_ID_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const username = rest.slice(0, slash);
  const suffix = rest.slice(slash + 1);
  if (!username || !suffix) return null;
  return { username, suffix };
}

function isLegacyCellId(cellId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}$/i.test(cellId.trim());
}

export const CELL_NAME_MAX = 48;

/** Trimmed, length-capped cell name; throws when blank (pure — exported for tests). */
export function normalizeCellName(name: string | null | undefined): string {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Cell name is required');
  return trimmed.slice(0, CELL_NAME_MAX);
}

export async function createUserCell(name: string): Promise<UserCell> {
  const cellName = normalizeCellName(name);
  const me = getCurrentUser();
  if (!me) {
    throw new Error('No local account — sign in before creating a cell.');
  }
  const ownerPeerId = await getOwnerPeerId();
  const suffix = hex(2); // 4 hex chars — disambiguates multiple cells per user
  const cellId = `${CELL_ID_PREFIX}${me.username}/${suffix}`;
  const cell: UserCell = {
    cellId,
    name: cellName,
    ownerUserId: me.id,
    ownerUsername: me.username,
    ownerPeerId,
    createdAt: Date.now(),
    lastEnteredAt: null,
  };
  const record = readCells();
  record[cellId] = cell;
  writeCells(record);
  void ensureCellGenesis(cell);
  return cell;
}

/**
 * Owner's device: sign the cell's genesis (its first member list) and open
 * its chain if it has none. Needs the unlocked vault; with it locked this retries on next entry.
 */
async function ensureCellGenesis(cell: UserCell): Promise<void> {
  try {
    const { ensureOwnedCellChain } = await import('../blockchain/cellChain/cellChains');
    await ensureOwnedCellChain(cell);
  } catch (err) {
    console.warn('[userCell] cell genesis not written', err);
  }
}

export function listUserCells(): UserCell[] {
  return Object.values(readCells()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getUserCell(cellId: string): UserCell | null {
  return readCells()[cellId] ?? null;
}

export function deleteUserCell(cellId: string): void {
  const record = readCells();
  if (!record[cellId]) return;
  const wasPublic = record[cellId].isPublic && isOwnedCell(record[cellId]);
  const removed = record[cellId];
  delete record[cellId];
  writeCells(record);
  if (wasPublic) void announcePublicCell(removed, true);
  void import('../blockchain/cellChain/cellChains')
    .then(({ getCellChains }) => getCellChains().forget(cellId))
    .catch(() => { /* best effort */ });
  if (getActiveUserCellId() === cellId) {
    void exitUserCell();
  }
}

export function getActiveUserCellId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function getActiveUserCell(): UserCell | null {
  const id = getActiveUserCellId();
  return id ? getUserCell(id) : null;
}

export async function enterUserCell(cellId: string): Promise<UserCell> {
  const cell = getUserCell(cellId);
  if (!cell) throw new Error(`Cell ${cellId} not found`);

  // Flip persistence to builder mode (engine identity for cells)
  updateConnectionState({ mode: 'builder', enabled: true });

  // Lazy-start the archived Builder engine
  const m = await import('./builderMode.standalone-archived');
  const bm = m.getStandaloneBuilderMode();
  void bm.start();

  // Persist active cell + bump lastEnteredAt
  try { localStorage.setItem(ACTIVE_KEY, cellId); } catch { /* ignore */ }
  const record = readCells();
  if (record[cellId]) {
    record[cellId].lastEnteredAt = Date.now();
    writeCells(record);
  }
  // If the cell has an owner anchor and we're not the owner, refresh the dial
  // target via the live Skin directory (handles peer-id rotation).
  const me = getCurrentUser();
  if (cell.ownerUserId && me?.id !== cell.ownerUserId) {
    void dialCellOwner(cell);
  } else if (cell.ownerUserId && me?.id === cell.ownerUserId) {
    // Cells made before signed rosters get their genesis the next time the owner enters.
    void ensureCellGenesis(cell);
  }
  notifyActive(cell);
  syncPublicRelay();
  return cell;
}

export async function exitUserCell(): Promise<void> {
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  try {
    const m = await import('./builderMode.standalone-archived');
    m.getStandaloneBuilderMode().stop();
  } catch { /* ignore */ }
  updateConnectionState({ mode: 'swarm' });
  notifyActive(null);
  syncPublicRelay();
}

/**
 * Join a foreign cell by its cellId.
 *
 * Two formats:
 *   - `u/{username}/{suffix}` — anchored on username; dial target resolves at
 *     join-time via the SwarmMesh AccountSkin directory and is refreshed on
 *     every entry. Survives peer-id rotation.
 *   - `{8hex}-{4hex}` — legacy snapshot format; dials a frozen peerId guess.
 */
export async function joinUserCellById(cellId: string, name?: string): Promise<UserCell> {
  const trimmed = cellId.trim();

  const existing = getUserCell(trimmed);
  if (existing) {
    await enterUserCell(trimmed);
    return existing;
  }

  const usernameForm = parseUsernameCellId(trimmed);
  if (usernameForm) {
    const { username } = usernameForm;
    const { ownerUserId, ownerPeerId } = await resolveOwnerByUsername(username);
    const cell: UserCell = {
      cellId: trimmed,
      name: name?.trim().slice(0, CELL_NAME_MAX) || `Cell ${username}`,
      ownerUserId,
      ownerUsername: username,
      ownerPeerId,
      createdAt: Date.now(),
      lastEnteredAt: null,
    };
    const record = readCells();
    record[trimmed] = cell;
    writeCells(record);
    await enterUserCell(trimmed);
    void dialCellOwner(cell);
    return cell;
  }

  if (isLegacyCellId(trimmed)) {
    const suffix = trimmed.split('-')[0];
    const ownerPeerId = `peer-${suffix.padStart(16, '0')}`;
    const cell: UserCell = {
      cellId: trimmed,
      name: name?.trim() || `Cell ${trimmed.slice(0, 6)}`,
      ownerUserId: '',
      ownerUsername: '',
      ownerPeerId,
      createdAt: Date.now(),
      lastEnteredAt: null,
    };
    const record = readCells();
    record[trimmed] = cell;
    writeCells(record);
    await enterUserCell(trimmed);
    try {
      const m = await import('./builderMode.standalone-archived');
      m.getStandaloneBuilderMode().connectToPeer(ownerPeerId);
    } catch (err) {
      console.warn('[userCell] dial owner failed', err);
    }
    return cell;
  }

  throw new Error('Invalid cell ID. Expected u/username/xxxx or legacy 8hex-4hex.');
}

/**
 * Resolve a cell owner's live peerId via the SwarmMesh AccountSkin directory.
 * Falls back to a placeholder peerId (will be replaced once a Skin response
 * arrives) if no binding is known yet.
 */
async function resolveOwnerByUsername(
  username: string
): Promise<{ ownerUserId: string; ownerPeerId: string }> {
  try {
    const { tryGetP2PManager } = await import('./manager');
    const mgr = tryGetP2PManager();
    if (!mgr) return { ownerUserId: '', ownerPeerId: '' };
    let binding = mgr.resolveAccountByUsername(username);
    if (!binding) {
      mgr.queryAccountByUsername(username);
      // Brief wait — Skin queries usually resolve in <500ms on a warm mesh.
      await new Promise((r) => setTimeout(r, 800));
      binding = mgr.resolveAccountByUsername(username);
    }
    if (binding) {
      return { ownerUserId: binding.userId, ownerPeerId: binding.peerId };
    }
  } catch (err) {
    console.warn('[userCell] username resolve via SwarmMesh failed', err);
  }
  // No binding yet — store username as anchor; dialCellOwner() will retry.
  return { ownerUserId: '', ownerPeerId: '' };
}

/**
 * Refresh the cell's dial target via the live Skin directory and dial.
 * Safe to call repeatedly; the Builder engine dedupes.
 */
export async function dialCellOwner(cell: UserCell): Promise<void> {
  if (!cell.ownerUsername && !cell.ownerUserId) {
    // Legacy cell — best-effort dial of the cached peerId
    if (cell.ownerPeerId) {
      try {
        const m = await import('./builderMode.standalone-archived');
        m.getStandaloneBuilderMode().connectToPeer(cell.ownerPeerId);
      } catch { /* ignore */ }
    }
    return;
  }

  let livePeerId: string | null = null;
  try {
    const { tryGetP2PManager } = await import('./manager');
    const mgr = tryGetP2PManager();
    if (!mgr) {
      // No SwarmMesh available — fall through to cached peerId dial below.
      throw new Error('SwarmMesh manager not available');
    }
    let binding = cell.ownerUserId ? mgr.resolveAccount(cell.ownerUserId) : null;
    if (!binding && cell.ownerUsername) {
      binding = mgr.resolveAccountByUsername(cell.ownerUsername);
    }
    if (!binding) {
      if (cell.ownerUserId) mgr.queryAccount(cell.ownerUserId);
      if (cell.ownerUsername) mgr.queryAccountByUsername(cell.ownerUsername);
      await new Promise((r) => setTimeout(r, 800));
      binding = cell.ownerUserId ? mgr.resolveAccount(cell.ownerUserId) : null;
      if (!binding && cell.ownerUsername) {
        binding = mgr.resolveAccountByUsername(cell.ownerUsername);
      }
    }
    if (binding) {
      livePeerId = binding.peerId;
      // Cache the resolved peerId AND fill in any missing ownerUserId.
      const record = readCells();
      const stored = record[cell.cellId];
      if (stored) {
        let mutated = false;
        if (stored.ownerPeerId !== binding.peerId) {
          stored.ownerPeerId = binding.peerId;
          mutated = true;
        }
        if (!stored.ownerUserId && binding.userId) {
          stored.ownerUserId = binding.userId;
          mutated = true;
        }
        if (mutated) writeCells(record);
      }
    }
  } catch (err) {
    console.warn('[userCell] dialCellOwner resolve failed', err);
  }

  const target = livePeerId ?? cell.ownerPeerId;
  if (!target) {
    console.warn(`[userCell] No peerId yet for @${cell.ownerUsername} — cell will retry on next entry.`);
    return;
  }

  try {
    const m = await import('./builderMode.standalone-archived');
    m.getStandaloneBuilderMode().connectToPeer(target);
  } catch (err) {
    console.warn('[userCell] dial failed', err);
  }
}

export function onCellsChange(fn: CellsListener): () => void {
  cellsListeners.add(fn);
  try { fn(listUserCells()); } catch { /* ignore */ }
  return () => { cellsListeners.delete(fn); };
}

export function onActiveCellChange(fn: ActiveListener): () => void {
  activeListeners.add(fn);
  try { fn(getActiveUserCell()); } catch { /* ignore */ }
  return () => { activeListeners.delete(fn); };
}

/**
 * Cell mode is a UI alias of 'builder' mode. Returns true while a user cell
 * is active so callers can render cell-specific labels.
 */
export function isCellMode(): boolean {
  const state = loadConnectionState();
  return state.mode === 'builder' && getActiveUserCellId() !== null;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC CELLS
// ═══════════════════════════════════════════════════════════════════

function isOwnedCell(cell: UserCell): boolean {
  const me = getCurrentUser();
  return !!me && !!cell.ownerUserId && cell.ownerUserId === me.id;
}

/** Owners only: open a cell to the global directory, or make it private again. */
export function toggleCellPublic(cellId: string, isPublic: boolean): UserCell {
  const record = readCells();
  const cell = record[cellId];
  if (!cell) throw new Error(`Cell ${cellId} not found`);
  if (!isOwnedCell(cell)) throw new Error('Only the cell owner can change its visibility.');
  if (!!cell.isPublic === isPublic) return cell;
  cell.isPublic = isPublic;
  cell.publicSince = isPublic ? Date.now() : undefined;
  writeCells(record);
  void announcePublicCell(cell, !isPublic);
  if (isPublic) ensurePublicAnnouncer();
  syncPublicRelay();
  return cell;
}

/**
 * Sync boundary for the main mesh. Outside any cell, or inside a public
 * cell, content may broadcast to the main mesh. Inside a private cell it
 * stays in the cell, and is not marked as synced to the mesh.
 */
export function cellAllowsMeshBroadcast(): boolean {
  if (!isCellMode()) return true;
  return !!getActiveUserCell()?.isPublic;
}

async function announcePublicCell(cell: UserCell, withdrawn = false): Promise<void> {
  let ownerMeshPeerId = '';
  let members = 1;
  try {
    const { getSwarmMeshStandalone } = await import('./swarmMesh.standalone');
    ownerMeshPeerId = getSwarmMeshStandalone().getPeerId() || '';
  } catch { /* mesh not loaded */ }
  if (getActiveUserCellId() === cell.cellId) {
    try {
      const m = await import('./builderMode.standalone-archived');
      members += m.getStandaloneBuilderMode().getStats().connectedPeers;
    } catch { /* engine not loaded */ }
  }
  const { publishPublicCellListing } = await import('./publicCells');
  await publishPublicCellListing({
    cellId: cell.cellId,
    name: cell.name,
    ownerUsername: cell.ownerUsername,
    ownerUserId: cell.ownerUserId,
    ownerPeerId: cell.ownerPeerId,
    ownerMeshPeerId,
    members,
    announcedAt: Date.now(),
    ...(withdrawn ? { withdrawn: true } : {}),
  });
}

let announceTimer: ReturnType<typeof setInterval> | null = null;

function ownedPublicCells(): UserCell[] {
  return listUserCells().filter(c => c.isPublic && isOwnedCell(c));
}

/** Re-announce every owned public cell while the app is open. */
function ensurePublicAnnouncer(): void {
  if (announceTimer || typeof window === 'undefined') return;
  void import('./publicCells').then(({ PUBLIC_CELL_REANNOUNCE_MS }) => {
    if (announceTimer) return;
    const tick = () => {
      const owned = ownedPublicCells();
      if (owned.length === 0) {
        if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
        return;
      }
      owned.forEach(c => { void announcePublicCell(c); });
    };
    announceTimer = setInterval(tick, PUBLIC_CELL_REANNOUNCE_MS);
    tick();
  }).catch(() => { /* ignore */ });
}

/** How far back an item may be stamped and still count as "live". */
export const LIVE_RELAY_WINDOW_MS = 2 * 60_000;

/**
 * Relay decision for one cell item (pure — exported for tests). Only live
 * items, made after the cell went public and within the live window, cross
 * to the main mesh; inventory catch-up and the offline backlog stay in the cell.
 */
export function shouldRelayCellItem(
  item: { timestamp: number },
  cell: Pick<UserCell, 'isPublic' | 'publicSince'> | null,
  nowTs = Date.now(),
): boolean {
  if (!cell?.isPublic || !cell.publicSince) return false;
  if (!Number.isFinite(item.timestamp)) return false;
  return item.timestamp >= cell.publicSince && nowTs - item.timestamp <= LIVE_RELAY_WINDOW_MS;
}

let relayUnsub: (() => void) | null = null;

/** Attach the cell → main mesh live relay only while a public cell is active. */
function syncPublicRelay(): void {
  const active = isCellMode() ? getActiveUserCell() : null;
  if (!active?.isPublic) {
    relayUnsub?.();
    relayUnsub = null;
    return;
  }
  if (relayUnsub) return;
  relayUnsub = () => { /* pending attach */ };
  void Promise.all([
    import('./builderMode.standalone-archived'),
    import('./swarmMesh.standalone'),
  ]).then(([bmMod, smMod]) => {
    if (!relayUnsub) return; // detached while loading
    const off = bmMod.getStandaloneBuilderMode().onContent((item) => {
      const cell = getActiveUserCell();
      if (!isCellMode() || !shouldRelayCellItem(item, cell)) return;
      const sm = smMod.getSwarmMeshStandalone();
      if (sm.getPhase() !== 'online' || !item.data || typeof item.data !== 'object') return;
      const data = item.data as Record<string, unknown>;
      if (item.type === 'post') sm.broadcastNewPost(data);
      else if (item.type === 'comment') sm.broadcastComment(data);
    });
    relayUnsub = off;
  }).catch(() => { relayUnsub = null; });
}

if (typeof window !== 'undefined' && import.meta.env?.MODE !== 'test') {
  setTimeout(() => {
    if (ownedPublicCells().length > 0) ensurePublicAnnouncer();
    syncPublicRelay();
  }, 5_000);
}

// Run the active cell's chain (blocks, endorsements, catch-up) over the cell engine.
if (typeof window !== 'undefined' && import.meta.env?.MODE !== 'test') {
  void import('../blockchain/cellChain/cellRuntime')
    .then(({ attachCellRuntime }) => attachCellRuntime())
    .catch((err) => console.warn('[userCell] cell chain runtime not started', err));
}
