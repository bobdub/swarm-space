/**
 * Unified Connection State Store
 *
 * Single source of truth for P2P network preferences.
 * Replaces fragmented localStorage keys: p2p-enabled, p2p-swarm-mesh-enabled,
 * p2p-swarm-mesh-mode, flux_network_mode.
 */

export type NetworkMode = 'swarm' | 'builder';

export interface ConnectionState {
  enabled: boolean;
  mode: NetworkMode;
  lastConnectedAt: number | null;
}

const STORAGE_KEY = 'p2p-connection-state';

const DEFAULT_STATE: ConnectionState = {
  enabled: false,
  mode: 'swarm',
  lastConnectedAt: null,
};

// Legacy keys to migrate from
const LEGACY_KEYS = [
  'p2p-enabled',
  'p2p-swarm-mesh-enabled',
  'p2p-swarm-mesh-mode',
  'flux_network_mode',
] as const;

type Listener = (state: ConnectionState) => void;
const listeners = new Set<Listener>();
let cached: ConnectionState | null = null;

function notify(state: ConnectionState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.warn('[connectionState] listener error', err);
    }
  }
}

/**
 * Migrate from legacy scattered localStorage keys into the unified store.
 * Runs once on first load if the unified key doesn't exist yet.
 */
function migrateLegacyKeys(): ConnectionState {
  const state = { ...DEFAULT_STATE };

  try {
    const legacyEnabled = localStorage.getItem('p2p-enabled');
    if (legacyEnabled === 'true') {
      state.enabled = true;
    }

    const legacyMode = localStorage.getItem('flux_network_mode');
    const legacySwarmMode = localStorage.getItem('p2p-swarm-mesh-mode');

    if (legacyMode === 'builder') {
      state.mode = 'builder';
    } else if (legacyMode === 'swarm') {
      state.mode = 'swarm';
    } else if (legacySwarmMode === 'false') {
      state.mode = 'builder';
    } else if (legacySwarmMode === 'true') {
      state.mode = 'swarm';
    }

    // Persist unified state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    // Clean up legacy keys
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }

    console.log('[connectionState] Migrated legacy keys →', state);
  } catch (err) {
    console.warn('[connectionState] Migration failed', err);
  }

  return state;
}

/**
 * Load the connection state from localStorage.
 * On first load, migrates from legacy keys if needed.
 */
export function loadConnectionState(): ConnectionState {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    cached = { ...DEFAULT_STATE };
    return cached;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ConnectionState>;
      cached = {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_STATE.enabled,
        mode: parsed.mode === 'builder' ? 'builder' : 'swarm',
        lastConnectedAt: typeof parsed.lastConnectedAt === 'number' ? parsed.lastConnectedAt : null,
      };
      return cached;
    }
  } catch (err) {
    console.warn('[connectionState] Failed to parse stored state', err);
  }

  // No unified key found — migrate
  cached = migrateLegacyKeys();
  return cached;
}

/**
 * Save and broadcast a new connection state.
 */
export function saveConnectionState(state: ConnectionState): void {
  cached = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[connectionState] Failed to save', err);
  }
  notify(state);
}

/**
 * Update partial fields and broadcast.
 */
export function updateConnectionState(partial: Partial<ConnectionState>): void {
  const current = loadConnectionState();
  const next: ConnectionState = { ...current, ...partial };
  saveConnectionState(next);
}

/**
 * Subscribe to connection state changes.
 * Fires immediately with the current value.
 */
export function subscribeToConnectionState(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener(loadConnectionState());
  } catch (err) {
    console.warn('[connectionState] listener error during subscription', err);
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read the current mode without loading full state.
 */
export function getConnectionMode(): NetworkMode {
  return loadConnectionState().mode;
}

/**
 * Read whether network is flagged enabled.
 */
export function isConnectionEnabled(): boolean {
  return loadConnectionState().enabled;
}
