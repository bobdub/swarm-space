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
}

const DEFAULT_CONFIG: RendezvousMeshConfig = {
  community: 'mainnet',
  beacons: [
    {
      url: 'https://beacon1.swarm-space.network',
      community: 'mainnet'
    },
    {
      url: 'https://beacon2.swarm-space.network',
      community: 'mainnet'
    }
  ],
  capsules: [],
  trustedTicketPublicKeys: [],
  trustedCapsulePublicKeys: [],
  announceIntervalMs: 45_000,
  refreshIntervalMs: 120_000,
  ticketTtlMs: 3 * 60_000
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
    ticketTtlMs: overrides.ticketTtlMs ?? base.ticketTtlMs
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
