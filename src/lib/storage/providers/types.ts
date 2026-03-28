/**
 * Storage Provider Interface
 * Defines the contract for pluggable storage backends (browser IndexedDB, external device, etc.)
 */

export type StorageTier = 'critical' | 'bulk' | 'replica';

export interface StorageCapacity {
  used: number;
  total: number;
  free: number;
}

export interface StorageHealthResult {
  available: boolean;
  issues: string[];
  lastCheckedAt: number;
}

export interface PlacementMeta {
  provider: string;
  storedAt: number;
}

/**
 * Data classification for tiered routing.
 * - critical: posts, users, meta, keys, sessions → always browser
 * - bulk: manifests, chunks → external when available, browser fallback
 * - replica: replicas → external preferred, skip if no space
 */
export const STORE_TIER_MAP: Record<string, StorageTier> = {
  posts: 'critical',
  users: 'critical',
  meta: 'critical',
  connections: 'critical',
  creditBalances: 'critical',
  creditTransactions: 'critical',
  verificationStates: 'critical',
  verificationProofs: 'critical',
  notifications: 'critical',
  entanglements: 'critical',
  projects: 'critical',
  tasks: 'critical',
  milestones: 'critical',
  comments: 'critical',
  postMetrics: 'critical',
  blockchain: 'critical',
  tokenBalances: 'critical',
  nfts: 'critical',
  bridges: 'critical',
  miningSessions: 'critical',
  profileTokens: 'critical',
  profileTokenHoldings: 'critical',
  tokenUnlockStates: 'critical',
  rewardPool: 'critical',
  wrapRequests: 'critical',
  deployedCoins: 'critical',
  swarmCoins: 'critical',
  walledPosts: 'critical',
  achievementDefinitions: 'critical',
  achievementProgress: 'critical',
  qcmSamples: 'critical',
  nodeMetricAggregates: 'critical',

  manifests: 'bulk',
  chunks: 'bulk',

  replicas: 'replica',
};

export interface StorageProvider {
  /** Unique identifier for this provider instance */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  // ── CRUD ──────────────────────────────────────────────
  get<T>(store: string, key: string): Promise<T | null>;
  put<T>(store: string, key: string, data: T): Promise<void>;
  remove(store: string, key: string): Promise<void>;
  getAll<T>(store: string): Promise<T[]>;

  // ── Capacity ──────────────────────────────────────────
  getCapacity(): Promise<StorageCapacity>;

  // ── Health ────────────────────────────────────────────
  isAvailable(): Promise<boolean>;
  getHealthStatus(): Promise<StorageHealthResult>;
}

export interface StorageThresholds {
  /** Start routing bulk to external above this local usage % (0–100). Default 80 */
  maxLocalUsagePercent: number;
  /** Stop writing to external below this free byte count. Default 100 MB */
  minExternalFreeBytes: number;
  /** Placement strategy */
  placementMode: 'auto' | 'mirror' | 'external-only';
}

export const DEFAULT_THRESHOLDS: StorageThresholds = {
  maxLocalUsagePercent: 80,
  minExternalFreeBytes: 100 * 1024 * 1024,
  placementMode: 'auto',
};
