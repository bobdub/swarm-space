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
  | 'swarmMeshMode'
  | 'infinityFieldBinding';

export interface FeatureFlags {
  webTorrentTransport: boolean;
  gunTransport: boolean;
  integratedTransport: boolean;
  transportFallbackTelemetry: boolean;
  hybridOrchestrator: boolean;
  swarmMeshMode: boolean;
  /** Couple |Ψ_Infinity⟩ ↔ UQRC field bidirectionally. Default ON. */
  infinityFieldBinding: boolean;
}

const rawEnv = typeof import.meta !== 'undefined'
  ? ((import.meta as { env?: Record<string, BooleanLike> }).env ?? {})
  : {};

const SWARM_MESH_MODE_KEY = 'p2p-swarm-mesh-mode';

function loadPersistedSwarmMeshMode(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    // Try unified connectionState first
    const unified = localStorage.getItem('p2p-connection-state');
    if (unified) {
      const parsed = JSON.parse(unified) as { mode?: string };
      if (parsed.mode === 'builder') return false;
      if (parsed.mode === 'swarm') return true;
    }
    // Fall back to legacy key
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
  swarmMeshMode: persistedSwarmMeshMode ?? resolveBoolean(rawEnv.VITE_FEATURE_SWARM_MESH, false),
  infinityFieldBinding: resolveBoolean(rawEnv.VITE_FEATURE_INFINITY_BINDING, true),
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
