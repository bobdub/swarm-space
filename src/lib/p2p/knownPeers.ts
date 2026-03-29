/**
 * Known Peers Management — UNIFIED with Swarm Library
 * 
 * This module now reads/writes to the swarm mesh connection library
 * (`swarm-mesh-connection-library`) instead of maintaining a separate store.
 * On first load, migrates any legacy data from the old `p2p:knownPeers` key.
 */

import { getStableNodeId, getCurrentNodeId } from './peerjs-adapter';

const LEGACY_STORAGE_KEY = 'p2p:knownPeers';
const LIBRARY_STORAGE_KEY = 'swarm-mesh-connection-library';
const AUTO_CONNECT_KEY = 'p2p:autoConnectEnabled';
const MIGRATION_DONE_KEY = 'p2p:knownPeers-migrated';

export interface KnownPeerEntry {
  peerId: string;
  addedAt: number;
  label?: string;
  lastSeen?: number;
  kind?: 'peer' | 'node';
}

// Default known peer IDs from the network (bootstrap nodes)
const DEFAULT_KNOWN_PEERS: KnownPeerEntry[] = [
  {
    peerId: '531132bd57058f8a',
    addedAt: Date.now(),
    label: 'Primary Dev Node (Node ID)',
    kind: 'node',
  },
  {
    peerId: 'c99d22420d763147',
    addedAt: Date.now(),
    label: 'Secondary Network Node (Node ID)',
    kind: 'node',
  },
  {
    peerId: 'fc6ea1c770f8e2db',
    addedAt: Date.now(),
    label: 'Tertiary Network Node (Node ID)',
    kind: 'node',
  },
  {
    peerId: '685cb8ea430d21a3',
    addedAt: Date.now(),
    label: 'Quaternary Network Node (Node ID)',
    kind: 'node',
  }
];

const isPeerId = (value: string) => value.startsWith('peer-');

const normalizeKnownPeer = (entry: KnownPeerEntry): KnownPeerEntry => ({
  ...entry,
  kind: entry.kind ?? (isPeerId(entry.peerId) ? 'peer' : 'node'),
});

// ── One-time migration from legacy key into library ────────────────

interface LibraryEntry {
  peerId: string;
  nodeId: string;
  alias: string;
  addedAt: number;
  lastSeenAt: number;
  autoConnect: boolean;
  source: string;
}

function migrateIfNeeded(): void {
  try {
    if (localStorage.getItem(MIGRATION_DONE_KEY)) return;
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) {
      localStorage.setItem(MIGRATION_DONE_KEY, '1');
      return;
    }

    const legacyPeers = JSON.parse(legacyRaw) as KnownPeerEntry[];
    const libraryRaw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    const library: LibraryEntry[] = libraryRaw ? JSON.parse(libraryRaw) : [];
    const existingIds = new Set(library.map(e => e.peerId));

    let added = 0;
    for (const entry of legacyPeers) {
      const peerId = entry.kind === 'node' ? `peer-${entry.peerId}` : entry.peerId;
      if (existingIds.has(peerId)) continue;

      library.push({
        peerId,
        nodeId: entry.peerId.replace(/^peer-/, ''),
        alias: entry.label ?? `Node ${entry.peerId.slice(0, 6)}`,
        addedAt: entry.addedAt,
        lastSeenAt: entry.lastSeen ?? 0,
        autoConnect: true,
        source: 'library',
      });
      added++;
    }

    if (added > 0) {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
      console.log(`[KnownPeers] Migrated ${added} entries from legacy store to swarm library`);
    }

    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.setItem(MIGRATION_DONE_KEY, '1');
  } catch (err) {
    console.error('[KnownPeers] Migration failed:', err);
  }
}

// Run migration on module load
migrateIfNeeded();

// ── Read from swarm library ────────────────────────────────────────

function readLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Get the local node ID for auto-connect purposes
 */
export function getLocalNodeId(): string {
  return getStableNodeId();
}

/**
 * Check if a peer ID matches the local node
 */
export function isLocalNode(peerIdOrNodeId: string): boolean {
  const localNodeId = getCurrentNodeId();
  if (!localNodeId) return false;
  if (peerIdOrNodeId === localNodeId) return true;
  if (peerIdOrNodeId.includes(localNodeId.slice(0, 12))) return true;
  return false;
}

/**
 * Load known peers from the unified swarm library
 */
export function loadKnownPeers(): KnownPeerEntry[] {
  try {
    const library = readLibrary();
    const result: KnownPeerEntry[] = library.map(e => normalizeKnownPeer({
      peerId: e.peerId,
      addedAt: e.addedAt,
      label: e.alias,
      lastSeen: e.lastSeenAt,
      kind: e.peerId.startsWith('peer-') ? 'peer' : 'node',
    }));

    // Ensure default bootstrap nodes are present
    const existingIds = new Set(result.map(e => e.peerId));
    const missingDefaults = DEFAULT_KNOWN_PEERS.filter(d => {
      const fullId = `peer-${d.peerId}`;
      return !existingIds.has(d.peerId) && !existingIds.has(fullId);
    });
    if (missingDefaults.length > 0) {
      result.push(...missingDefaults);
    }
    return result;
  } catch (error) {
    console.error('[KnownPeers] Failed to load known peers', error);
    return DEFAULT_KNOWN_PEERS.map(normalizeKnownPeer);
  }
}

/**
 * Save known peers — writes back to swarm library format
 */
export function saveKnownPeers(peers: KnownPeerEntry[]): void {
  try {
    const library = readLibrary();
    const libraryMap = new Map(library.map(e => [e.peerId, e]));

    for (const p of peers) {
      const peerId = p.kind === 'node' && !p.peerId.startsWith('peer-') ? `peer-${p.peerId}` : p.peerId;
      const existing = libraryMap.get(peerId);
      if (existing) {
        if (p.label) existing.alias = p.label;
        if (p.lastSeen) existing.lastSeenAt = p.lastSeen;
      } else {
        libraryMap.set(peerId, {
          peerId,
          nodeId: peerId.replace(/^peer-/, ''),
          alias: p.label ?? `Node ${peerId.slice(0, 6)}`,
          addedAt: p.addedAt,
          lastSeenAt: p.lastSeen ?? 0,
          autoConnect: true,
          source: 'library',
        });
      }
    }

    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(Array.from(libraryMap.values())));
  } catch (error) {
    console.error('[KnownPeers] Failed to save known peers', error);
  }
}

/**
 * Add a known peer
 */
export function addKnownPeer(peerId: string, label?: string): void {
  const peers = loadKnownPeers();
  const existing = peers.find(p => p.peerId === peerId);
  
  if (existing) {
    if (label) existing.label = label;
    saveKnownPeers(peers);
    return;
  }

  peers.push(normalizeKnownPeer({
    peerId,
    addedAt: Date.now(),
    label,
  }));
  
  saveKnownPeers(peers);
}

/**
 * Remove a known peer
 */
export function removeKnownPeer(peerId: string): void {
  const library = readLibrary();
  const filtered = library.filter(p => p.peerId !== peerId);
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(filtered));
  } catch { /* ignore */ }
}

/**
 * Update last seen timestamp for a peer
 */
export function updatePeerLastSeen(peerId: string): void {
  const library = readLibrary();
  const entry = library.find(p => p.peerId === peerId);
  if (entry) {
    entry.lastSeenAt = Date.now();
    try {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
    } catch { /* ignore */ }
  }
}

/**
 * Check if auto-connect is enabled
 */
export function isAutoConnectEnabled(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_CONNECT_KEY);
    return stored !== 'false';
  } catch (error) {
    return true;
  }
}

/**
 * Set auto-connect enabled state
 */
export function setAutoConnectEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_CONNECT_KEY, String(enabled));
  } catch (error) {
    console.error('[KnownPeers] Failed to save auto-connect state', error);
  }
}

/**
 * Get known peer IDs as a simple array
 */
export function getKnownPeerIds(): string[] {
  return readLibrary().map(p => p.peerId);
}

/**
 * Get known node IDs as a simple array
 */
export function getKnownNodeIds(): string[] {
  return readLibrary()
    .filter(e => !e.peerId.startsWith('peer-'))
    .map(p => p.peerId);
}

/**
 * Get only user-added peer IDs (not bootstrap nodes)
 */
export function getUserPeerIds(): string[] {
  const bootstrapSet = new Set(['peer-aabdc05f37ceb551', 'peer-01e3f23e20fe0102']);
  return readLibrary()
    .filter(e => !bootstrapSet.has(e.peerId) && e.source !== 'bootstrap')
    .map(p => p.peerId);
}
