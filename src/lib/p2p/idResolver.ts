/**
 * Unified Network ID Resolver
 * 
 * Accepts either a Node ID (16-char hex) or a Peer ID (peer-xxx-xxx-xxx format)
 * and resolves both identifiers so the system can connect via SWARM Mesh (Node ID)
 * and Builder Mode (Peer ID) simultaneously.
 * 
 * This ensures cross-mode connectivity: a Builder Mode user can enter a
 * SWARM Mesh user's Node ID and vice versa.
 */

const PEER_ID_PREFIX = 'peer-';

export interface ResolvedId {
  /** The raw input the user typed */
  raw: string;
  /** Detected format */
  format: 'node' | 'peer' | 'unknown';
  /** 16-char hex Node ID (if resolvable) */
  nodeId: string | null;
  /** Full PeerJS Peer ID (if resolvable) */
  peerId: string | null;
}

/**
 * Detect whether a string is a Node ID, Peer ID, or unknown.
 */
export function detectIdFormat(input: string): 'node' | 'peer' | 'unknown' {
  const trimmed = input.trim();
  if (trimmed.startsWith(PEER_ID_PREFIX)) return 'peer';
  if (/^[a-f0-9]{16}$/i.test(trimmed)) return 'node';
  // Could be a partial or legacy format — try best effort
  if (/^[a-f0-9]{8,}$/i.test(trimmed)) return 'node';
  return 'unknown';
}

/**
 * Extract a Node ID from a Peer ID.
 * Peer IDs are formatted as: peer-{nodeId[0:12]}-{timestamp}-{random}
 * We can extract the first 12 chars of the node ID but not the full 16.
 */
export function extractNodeIdFromPeerId(peerId: string): string | null {
  if (!peerId.startsWith(PEER_ID_PREFIX)) return null;
  const parts = peerId.slice(PEER_ID_PREFIX.length).split('-');
  if (parts.length >= 1 && /^[a-f0-9]{12}$/i.test(parts[0])) {
    return parts[0]; // partial node ID (12 chars)
  }
  return null;
}

/**
 * Resolve any user-entered ID into its component parts.
 */
export function resolveNetworkId(input: string): ResolvedId {
  const raw = input.trim();
  const format = detectIdFormat(raw);

  switch (format) {
    case 'node':
      return {
        raw,
        format: 'node',
        nodeId: raw,
        peerId: null, // We can't derive the full peer ID from a node ID
      };

    case 'peer':
      return {
        raw,
        format: 'peer',
        nodeId: extractNodeIdFromPeerId(raw),
        peerId: raw,
      };

    default:
      return {
        raw,
        format: 'unknown',
        nodeId: null,
        peerId: null,
      };
  }
}

/**
 * Get a display-friendly label for any network ID.
 * Always shows the short form (first 8 chars).
 */
export function formatNetworkId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith(PEER_ID_PREFIX)) {
    // Extract the node portion for display
    const partial = extractNodeIdFromPeerId(trimmed);
    if (partial) return partial.slice(0, 8) + '…';
    return trimmed.slice(0, 16) + '…';
  }
  if (trimmed.length > 8) return trimmed.slice(0, 8) + '…';
  return trimmed;
}

/**
 * Validate that an input looks like a usable network ID.
 */
export function isValidNetworkId(input: string): boolean {
  const format = detectIdFormat(input.trim());
  return format !== 'unknown';
}
