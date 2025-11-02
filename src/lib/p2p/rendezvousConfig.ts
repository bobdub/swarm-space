import type { BeaconEndpoint, CapsuleSource } from './bootstrap';

export interface RendezvousMeshConfig {
  community: string;
  beacons: BeaconEndpoint[];
  capsules: CapsuleSource[];
  trustedTicketPublicKeys: string[];
  trustedCapsulePublicKeys: string[];
  announceIntervalMs: number;
  refreshIntervalMs: number;
  ticketTtlMs: number;
  beaconRequestTimeoutMs?: number;
  beaconRetryLimit?: number;
  beaconRetryBackoffMs?: number;
  capsuleRequestTimeoutMs?: number;
  capsuleRetryLimit?: number;
  capsuleRetryBackoffMs?: number;
  rendezvousFailureThreshold?: number;
}

const DEFAULT_CONFIG: RendezvousMeshConfig = {
  community: 'mainnet',
  beacons: [
    {
      url: 'https://beacon1.swarm-space.network',
      community: 'mainnet',
      timeoutMs: 8000,
      retryLimit: 2,
      retryBackoffMs: 1000,
    },
    {
      url: 'https://beacon2.swarm-space.network',
      community: 'mainnet',
      timeoutMs: 8000,
      retryLimit: 2,
      retryBackoffMs: 1000,
    }
  ],
  capsules: [],
  trustedTicketPublicKeys: [],
  trustedCapsulePublicKeys: [],
  announceIntervalMs: 45_000,
  refreshIntervalMs: 120_000,
  ticketTtlMs: 3 * 60_000,
  beaconRequestTimeoutMs: 8000,
  beaconRetryLimit: 2,
  beaconRetryBackoffMs: 1000,
  capsuleRequestTimeoutMs: 8000,
  capsuleRetryLimit: 1,
  capsuleRetryBackoffMs: 1000,
  rendezvousFailureThreshold: 3,
};

type EnvShape = {
  VITE_RENDEZVOUS_CONFIG?: string;
};

function mergeConfig(
  base: RendezvousMeshConfig,
  overrides: Partial<RendezvousMeshConfig>
): RendezvousMeshConfig {
  return {
    ...base,
    ...overrides,
    beacons: overrides.beacons ? [...overrides.beacons] : base.beacons,
    capsules: overrides.capsules ? [...overrides.capsules] : base.capsules,
    trustedTicketPublicKeys: overrides.trustedTicketPublicKeys
      ? [...overrides.trustedTicketPublicKeys]
      : base.trustedTicketPublicKeys,
    trustedCapsulePublicKeys: overrides.trustedCapsulePublicKeys
      ? [...overrides.trustedCapsulePublicKeys]
      : base.trustedCapsulePublicKeys,
    announceIntervalMs:
      overrides.announceIntervalMs ?? base.announceIntervalMs,
    refreshIntervalMs: overrides.refreshIntervalMs ?? base.refreshIntervalMs,
    ticketTtlMs: overrides.ticketTtlMs ?? base.ticketTtlMs,
    beaconRequestTimeoutMs: overrides.beaconRequestTimeoutMs ?? base.beaconRequestTimeoutMs,
    beaconRetryLimit: overrides.beaconRetryLimit ?? base.beaconRetryLimit,
    beaconRetryBackoffMs: overrides.beaconRetryBackoffMs ?? base.beaconRetryBackoffMs,
    capsuleRequestTimeoutMs: overrides.capsuleRequestTimeoutMs ?? base.capsuleRequestTimeoutMs,
    capsuleRetryLimit: overrides.capsuleRetryLimit ?? base.capsuleRetryLimit,
    capsuleRetryBackoffMs: overrides.capsuleRetryBackoffMs ?? base.capsuleRetryBackoffMs,
    rendezvousFailureThreshold: overrides.rendezvousFailureThreshold ?? base.rendezvousFailureThreshold,
  };
}

function parseInlineConfig(): Partial<RendezvousMeshConfig> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const element = document.getElementById('rendezvous-config');
  if (!element) {
    return null;
  }

  const raw = element.textContent;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RendezvousMeshConfig>;
    return parsed;
  } catch (error) {
    console.warn('[RendezvousConfig] Failed to parse inline config:', error);
    return null;
  }
}

function parseEnvConfig(value: string): Partial<RendezvousMeshConfig> | null {
  try {
    const parsed = JSON.parse(value) as Partial<RendezvousMeshConfig>;
    return parsed;
  } catch (error) {
    console.warn('[RendezvousConfig] Failed to parse VITE_RENDEZVOUS_CONFIG:', error);
    return null;
  }
}

function getEnv(): EnvShape {
  try {
    return (import.meta as any)?.env ?? {};
  } catch {
    return {};
  }
}

export function loadRendezvousConfig(): RendezvousMeshConfig {
  let config = { ...DEFAULT_CONFIG };

  const inline = parseInlineConfig();
  if (inline) {
    config = mergeConfig(config, inline);
  }

  const env = getEnv();
  if (env.VITE_RENDEZVOUS_CONFIG) {
    const parsed = parseEnvConfig(env.VITE_RENDEZVOUS_CONFIG);
    if (parsed) {
      config = mergeConfig(config, parsed);
    }
  }

  return config;
}
