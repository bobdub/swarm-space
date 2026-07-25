/**
 * Logical Loading Points registry.
 *
 * Each point wraps an existing subsystem's dynamic import so the chain
 * runner can start / pause / resume it without rewriting the subsystem.
 */

export type LoadingPointId =
  | 'local'
  | 'mesh'
  | 'brain'
  | 'brain-game'
  | 'blockchain'
  | 'torrents'
  | 'mining';

export interface LoadingPoint {
  id: LoadingPointId | string;
  label: string;
  essential: boolean;
  /** Won't start below this QScore. */
  minQScore: number;
  /** Suggests running work should back off below this QScore. */
  pauseBelowQScore: number;
  /** Idempotent boot. */
  start: () => Promise<void>;
  /** Optional teardown-lite: subsystem quiets down but keeps state. */
  pause?: () => void;
  resume?: () => void;
}

const points = new Map<string, LoadingPoint>();

export function registerLoadingPoint(p: LoadingPoint): void {
  points.set(p.id, p);
}

export function getLoadingPoint(id: string): LoadingPoint | undefined {
  return points.get(id);
}

export function listLoadingPoints(): LoadingPoint[] {
  return Array.from(points.values());
}

/** Register the seven built-in points that mirror `src/main.tsx` idle boots. */
export function registerDefaultPoints(): void {
  registerLoadingPoint({
    id: 'local',
    label: 'Local first',
    essential: true,
    minQScore: 0,
    pauseBelowQScore: 0,
    start: async () => {
      // Local sync flag reconciliation — cheap, always runs.
      try {
        const rawState = localStorage.getItem('p2p-connection-state');
        const connState = rawState ? (JSON.parse(rawState) as { enabled?: boolean }) : null;
        if (connState?.enabled) {
          const raw = localStorage.getItem('swarm-mesh-flags');
          if (raw) {
            const flags = JSON.parse(raw);
            if (flags?.enabled !== true) {
              flags.enabled = true;
              localStorage.setItem('swarm-mesh-flags', JSON.stringify(flags));
            }
          }
        }
      } catch { /* ignore */ }
      // Content lookup responder — allows share-link guests to find hosts on this origin.
      await import('@/lib/p2p/contentLookup').then((m) => m.startContentLookupResponder()).catch(() => {});
    },
  });

  registerLoadingPoint({
    id: 'mesh',
    label: 'Mesh / P2P sync',
    essential: false,
    minQScore: 0.20,
    pauseBelowQScore: 0.20,
    start: async () => {
      await import('@/lib/p2p/roomDiscovery.standalone').then((m) => m.getRoomDiscovery().start()).catch(() => {});
      await import('@/lib/p2p/globalCell').then((m) => m.getGlobalCell().start()).catch(() => {});
      await import('@/lib/p2p/entityVoiceIntegration').then((m) => m.initEntityVoiceListener()).catch(() => {});
    },
  });

  registerLoadingPoint({
    id: 'brain',
    label: 'Brain / Infinity',
    essential: false,
    minQScore: 0.25,
    pauseBelowQScore: 0.25,
    start: async () => {
      await import('@/lib/uqrc/healthBridge').then((m) => m.startHealthBridge()).catch(() => {});
      await import('@/lib/remix/lab.bus').then((m) => m.bootLabBusBridges()).catch(() => {});
      await import('@/lib/brain/tool.bus').then((m) => m.bootToolBusBridges()).catch(() => {});
    },
  });

  registerLoadingPoint({
    id: 'brain-game',
    label: 'Brain game functions',
    essential: false,
    minQScore: 0.30,
    pauseBelowQScore: 0.25,
    start: async () => {
      await import('@/lib/world/worldPlacementsStore').then((m) => m.hydrateWorldPlacements()).catch(() => {});
      await import('@/lib/world/p2pPlacementBridge').then((m) => m.bootPlacementGossipBridge()).catch(() => {});
      await import('@/lib/brain/npc/bootNpcWorld').then((m) => m.bootNpcWorld('swarm-shared-village')).catch(() => {});
    },
  });

  registerLoadingPoint({
    id: 'blockchain',
    label: 'Blockchain',
    essential: false,
    minQScore: 0.30,
    pauseBelowQScore: 0.25,
    start: async () => {
      await import('@/lib/blockchain').then((m) => m.initializeBlockchainIntegration()).catch(() => {});
      await import('@/lib/blockchain/coin.bus').then((m) => m.bootCoinBusBridges()).catch(() => {});
      await import('@/lib/blockchain/labourLedger').then((m) => m.bootLabourLedger()).catch(() => {});
      await import('@/lib/remix/labProjectBridge').then((m) => m.hydrateProjectMints()).catch(() => {});
      await import('@/lib/remix/brainSubmissionsStore').then((m) => m.hydrateBrainSubmissions()).catch(() => {});
      await import('@/lib/remix/harvestedInventory').then((m) => m.hydrateHarvestedInventory()).catch(() => {});
      await import('@/lib/remix/coinCraftingStore').then((m) => m.hydrateCoinCrafting()).catch(() => {});
    },
  });

  registerLoadingPoint({
    id: 'torrents',
    label: 'Torrents',
    essential: false,
    minQScore: 0.35,
    pauseBelowQScore: 0.30,
    start: async () => {
      // Fire-and-forget manifest backfill — deferred, non-blocking.
      setTimeout(() => {
        import('@/lib/fileEncryption').then((m) => void m.backfillManifestRawKeys()).catch(() => {});
      }, 3000);
    },
  });

  registerLoadingPoint({
    id: 'mining',
    label: 'Mining',
    essential: false,
    minQScore: 0.40,
    pauseBelowQScore: 0.30,
    start: async () => {
      // AutoMiningService is already mounted in App.tsx; nothing to boot here.
      // Kept as a chain point so guardrails can gate future eager mining work.
    },
  });
}