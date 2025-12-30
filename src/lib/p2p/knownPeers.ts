/**
 * Known Peers Management
 * 
 * Manages a list of known peer IDs for auto-connect functionality.
 * Provides storage, retrieval, and validation of trusted peer IDs.
 */

const STORAGE_KEY = 'p2p:knownPeers';
const AUTO_CONNECT_KEY = 'p2p:autoConnectEnabled';

export interface KnownPeerEntry {
  peerId: string;
  addedAt: number;
  label?: string;
  lastSeen?: number;
  kind?: 'peer' | 'node';
}

// Default known peer IDs from the network
const DEFAULT_KNOWN_PEERS: KnownPeerEntry[] = [
  {
    peerId: 'c99d22420d763147',
    addedAt: Date.now(),
    label: 'Primary Network Node (Node ID)',
    kind: 'node',
  },
  {
    peerId: 'peer-c99d22420d76-mhjpqwnr-9n02yin',
    addedAt: Date.now(),
    label: 'Primary Network Node (Peer ID)',
    kind: 'peer',
  },
  {
    peerId: 'peer-fc6ea1c770f8-mhjpq7fc-trrbbig',
    addedAt: Date.now(),
    label: 'Secondary Network Node (Peer ID)',
    kind: 'peer',
  }
];

const isPeerId = (value: string) => value.startsWith('peer-');

const normalizeKnownPeer = (entry: KnownPeerEntry): KnownPeerEntry => ({
  ...entry,
  kind: entry.kind ?? (isPeerId(entry.peerId) ? 'peer' : 'node'),
});

/**
 * Load known peers from localStorage
 */
export function loadKnownPeers(): KnownPeerEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Initialize with default peers
      saveKnownPeers(DEFAULT_KNOWN_PEERS);
      return DEFAULT_KNOWN_PEERS;
    }
    const parsed = JSON.parse(stored) as KnownPeerEntry[];
    const normalized = parsed.map(normalizeKnownPeer);
    const hasNodeEntry = normalized.some((entry) => entry.kind === 'node');
    if (!hasNodeEntry) {
      const defaultNodes = DEFAULT_KNOWN_PEERS.filter((entry) => entry.kind === 'node');
      if (defaultNodes.length > 0) {
        const merged = [...normalized, ...defaultNodes];
        saveKnownPeers(merged);
        return merged;
      }
    }
    return normalized;
  } catch (error) {
    console.error('[KnownPeers] Failed to load known peers', error);
    return DEFAULT_KNOWN_PEERS.map(normalizeKnownPeer);
  }
}

/**
 * Save known peers to localStorage
 */
export function saveKnownPeers(peers: KnownPeerEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(peers));
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
    // Update label if provided
    if (label) {
      existing.label = label;
    }
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
  const peers = loadKnownPeers();
  const filtered = peers.filter(p => p.peerId !== peerId);
  saveKnownPeers(filtered);
}

/**
 * Update last seen timestamp for a peer
 */
export function updatePeerLastSeen(peerId: string): void {
  const peers = loadKnownPeers();
  const peer = peers.find(p => p.peerId === peerId);
  
  if (peer) {
    peer.lastSeen = Date.now();
    saveKnownPeers(peers);
  }
}

/**
 * Check if auto-connect is enabled
 */
export function isAutoConnectEnabled(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_CONNECT_KEY);
    return stored !== 'false'; // Default to enabled
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
  return loadKnownPeers()
    .filter((entry) => entry.kind === 'peer')
    .map(p => p.peerId);
}

/**
 * Get known node IDs as a simple array
 */
export function getKnownNodeIds(): string[] {
  return loadKnownPeers()
    .filter((entry) => entry.kind === 'node')
    .map(p => p.peerId);
}
