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
}

// Default known peer ID from the network
const DEFAULT_KNOWN_PEER = 'peer-c99d22420d76-mhjpqwnr-9n02yin';

/**
 * Load known peers from localStorage
 */
export function loadKnownPeers(): KnownPeerEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Initialize with default peer
      const defaultPeer: KnownPeerEntry = {
        peerId: DEFAULT_KNOWN_PEER,
        addedAt: Date.now(),
        label: 'Default Network Peer'
      };
      saveKnownPeers([defaultPeer]);
      return [defaultPeer];
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('[KnownPeers] Failed to load known peers', error);
    return [{
      peerId: DEFAULT_KNOWN_PEER,
      addedAt: Date.now(),
      label: 'Default Network Peer'
    }];
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

  peers.push({
    peerId,
    addedAt: Date.now(),
    label
  });
  
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
  return loadKnownPeers().map(p => p.peerId);
}
