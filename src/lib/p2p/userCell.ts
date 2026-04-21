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

export interface UserCell {
  cellId: string;
  name: string;
  ownerPeerId: string;
  createdAt: number;
  lastEnteredAt: number | null;
}

const CELLS_KEY = 'user-cells';
const ACTIVE_KEY = 'active-user-cell';

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

export async function createUserCell(name?: string): Promise<UserCell> {
  const ownerPeerId = await getOwnerPeerId();
  const suffix = ownerPeerId.replace(/^peer-/, '').slice(-8) || hex(4);
  const cellId = `${suffix}-${hex(2)}`;
  const cell: UserCell = {
    cellId,
    name: name?.trim() || `Cell ${cellId.slice(0, 6)}`,
    ownerPeerId,
    createdAt: Date.now(),
    lastEnteredAt: null,
  };
  const record = readCells();
  record[cellId] = cell;
  writeCells(record);
  return cell;
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
  delete record[cellId];
  writeCells(record);
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
  notifyActive(cell);
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
}

/**
 * Join a foreign cell by its cellId. Resolves the owner's peerId from the
 * cellId suffix (last 8 hex chars of their peerId) and dials them via the
 * Builder engine. Persists the foreign cell locally so it appears in the list.
 */
export async function joinUserCellById(cellId: string, name?: string): Promise<UserCell> {
  const trimmed = cellId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}$/i.test(trimmed)) {
    throw new Error('Invalid cell ID format. Expected 8hex-4hex.');
  }

  const existing = getUserCell(trimmed);
  if (existing) {
    await enterUserCell(trimmed);
    return existing;
  }

  // Reconstruct owner peerId guess from suffix (Builder uses peer-<16hex>)
  const suffix = trimmed.split('-')[0];
  const ownerPeerId = `peer-${suffix.padStart(16, '0')}`;

  const cell: UserCell = {
    cellId: trimmed,
    name: name?.trim() || `Cell ${trimmed.slice(0, 6)}`,
    ownerPeerId,
    createdAt: Date.now(),
    lastEnteredAt: null,
  };
  const record = readCells();
  record[trimmed] = cell;
  writeCells(record);

  await enterUserCell(trimmed);

  // Best-effort dial — Builder engine dedupes & queues
  try {
    const m = await import('./builderMode.standalone-archived');
    m.getStandaloneBuilderMode().connectToPeer(ownerPeerId);
  } catch (err) {
    console.warn('[userCell] dial owner failed', err);
  }

  return cell;
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
