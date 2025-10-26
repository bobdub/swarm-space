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
  beacons: [],
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
  const env = getEnv();
  if (env.VITE_RENDEZVOUS_CONFIG) {
    const parsed = parseEnvConfig(env.VITE_RENDEZVOUS_CONFIG);
    if (parsed) {
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        beacons: parsed.beacons ?? DEFAULT_CONFIG.beacons,
        capsules: parsed.capsules ?? DEFAULT_CONFIG.capsules,
        trustedTicketPublicKeys:
          parsed.trustedTicketPublicKeys ?? DEFAULT_CONFIG.trustedTicketPublicKeys,
        trustedCapsulePublicKeys:
          parsed.trustedCapsulePublicKeys ?? DEFAULT_CONFIG.trustedCapsulePublicKeys,
        announceIntervalMs: parsed.announceIntervalMs ?? DEFAULT_CONFIG.announceIntervalMs,
        refreshIntervalMs: parsed.refreshIntervalMs ?? DEFAULT_CONFIG.refreshIntervalMs,
        ticketTtlMs: parsed.ticketTtlMs ?? DEFAULT_CONFIG.ticketTtlMs
      };
    }
  }

  return DEFAULT_CONFIG;
}
