type BooleanLike = string | boolean | undefined | null;

function resolveBoolean(value: BooleanLike, defaultValue = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return defaultValue;
}

export type FeatureFlagKey =
  | 'webTorrentTransport'
  | 'gunTransport'
  | 'integratedTransport'
  | 'transportFallbackTelemetry'
  | 'hybridOrchestrator'
  | 'connectionResilience'
  | 'swarmMeshMode';

export interface FeatureFlags {
  webTorrentTransport: boolean;
  gunTransport: boolean;
  integratedTransport: boolean;
  transportFallbackTelemetry: boolean;
  hybridOrchestrator: boolean;
  connectionResilience: boolean;
  swarmMeshMode: boolean;
}

const rawEnv = typeof import.meta !== 'undefined'
  ? ((import.meta as { env?: Record<string, BooleanLike> }).env ?? {})
  : {};

const SWARM_MESH_MODE_KEY = 'p2p-swarm-mesh-mode';

function loadPersistedSwarmMeshMode(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(SWARM_MESH_MODE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function persistSwarmMeshMode(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SWARM_MESH_MODE_KEY, value ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

// Check localStorage first for swarmMeshMode, fall back to env var
const persistedSwarmMeshMode = loadPersistedSwarmMeshMode();

const initialFlags: FeatureFlags = {
  webTorrentTransport: resolveBoolean(rawEnv.VITE_FEATURE_WEBTORRENT),
  gunTransport: resolveBoolean(rawEnv.VITE_FEATURE_GUN),
  integratedTransport: resolveBoolean(rawEnv.VITE_FEATURE_INTEGRATED),
  transportFallbackTelemetry: true,
  hybridOrchestrator: resolveBoolean(rawEnv.VITE_FEATURE_HYBRID_ORCHESTRATOR, true),
  connectionResilience: resolveBoolean(rawEnv.VITE_FEATURE_CONNECTION_RESILIENCE, true),
  swarmMeshMode: persistedSwarmMeshMode ?? resolveBoolean(rawEnv.VITE_FEATURE_SWARM_MESH, false),
};

let overrides: Partial<FeatureFlags> = {};

type FeatureFlagListener = (flags: FeatureFlags) => void;

const listeners = new Set<FeatureFlagListener>();

function snapshot(): FeatureFlags {
  return {
    ...initialFlags,
    ...overrides,
  };
}

function notify(): void {
  const current = snapshot();
  for (const listener of listeners) {
    try {
      listener(current);
    } catch (error) {
      console.warn('[featureFlags] Listener error', error);
    }
  }
}

export function getFeatureFlags(): FeatureFlags {
  return snapshot();
}

export function setFeatureFlag(key: FeatureFlagKey, value: boolean): void {
  overrides = {
    ...overrides,
    [key]: value,
  };
  // Persist swarmMeshMode to localStorage
  if (key === 'swarmMeshMode') {
    persistSwarmMeshMode(value);
  }
  notify();
}

export function updateFeatureFlags(next: Partial<FeatureFlags>): void {
  overrides = {
    ...overrides,
    ...next,
  };
  notify();
}

export function subscribeToFeatureFlags(listener: FeatureFlagListener): () => void {
  listeners.add(listener);
  try {
    listener(snapshot());
  } catch (error) {
    console.warn('[featureFlags] Listener error during subscription', error);
  }
  return () => {
    listeners.delete(listener);
  };
}
