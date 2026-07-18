import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { getLoadingPriority } from "./lib/settings/loadingPriority";
// Render immediately — defer all background services to idle time
createRoot(document.getElementById("root")!).render(<App />);

const __loadingPriority = getLoadingPriority();
console.log(`[main] Loading priority: ${__loadingPriority}`);

// ── Deferred boot tasks (run after first paint) ──
const scheduleIdle = (fn: () => void) => {
  // Chrome may never fire requestIdleCallback if the tab is hidden during
  // onboarding. The 1500 ms timeout guarantees the boot tasks run even on
  // a busy main thread or backgrounded tab.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 1500 });
  } else {
    setTimeout(fn, 200);
  }
};

scheduleIdle(() => {
  // Initialize blockchain integration
  import("./lib/blockchain").then(m => m.initializeBlockchainIntegration());

  // Backfill manifests with raw keys so peers can decrypt shared content
  setTimeout(() => import("./lib/fileEncryption").then(m => void m.backfillManifestRawKeys()), 3000);

  // ── Sync dual enabled flags for compatibility only ──
  // Older accounts may have p2p-connection-state.enabled=true but
  // swarm-mesh-flags.enabled=false (or vice versa). Sync them.
  try {
    const rawState = localStorage.getItem('p2p-connection-state');
    const connState = rawState ? JSON.parse(rawState) as { enabled?: boolean } : null;
    if (connState?.enabled) {
      const raw = localStorage.getItem('swarm-mesh-flags');
      if (raw) {
        const flags = JSON.parse(raw);
        if (flags?.enabled !== true) {
          flags.enabled = true;
          localStorage.setItem('swarm-mesh-flags', JSON.stringify(flags));
          console.log('[main] Synced swarm-mesh-flags.enabled=true from unified state');
        }
      }
    }
  } catch { /* ignore */ }

  // Start deterministic room discovery overlay
  import("./lib/p2p/roomDiscovery.standalone").then(m => m.getRoomDiscovery().start());

  // Initialize entity voice
  import("./lib/p2p/entityVoiceIntegration").then(m => m.initEntityVoiceListener());

  // UQRC Health Bridge — wires browser stress, content-delivery telemetry,
  // and MineHealth into the shared field. Closes the cross-layer feedback loop.
  import("./lib/uqrc/healthBridge").then(m => m.startHealthBridge()).catch(() => {});

  // Scaffold Bus bridges — wire labour/custody → coin fill events.
  import("./lib/blockchain/coin.bus").then(m => m.bootCoinBusBridges()).catch(() => {});

  // Phase 3 — Labour ledger. Aggregates labour:<actor> coin.fill events
  // into a persisted, cross-tab gossip ledger surfaced in Wallet.
  import("./lib/blockchain/labourLedger").then(m => m.bootLabourLedger()).catch(() => {});

  // Lab → World bridge — hydrate prior mints so they re-appear in the
  // Builder Bar after reload. Local-first; P2P gossip via BroadcastChannel
  // is set up lazily by the store on first mint.
  import("./lib/remix/lab.bus").then(m => m.bootLabBusBridges()).catch(() => {});

  // Phase 4 — Sculpting → Tools. Hydrate forged tools so they re-appear
  // in the toolCatalog (and `sculpting.applyImpact`) after reload.
  import("./lib/brain/tool.bus").then(m => m.bootToolBusBridges()).catch(() => {});

  // Phase 5 — World Tools placement. Hydrate prior user-placed prefabs
  // so they re-appear on Earth after reload (replays through
  // BuilderBlockEngine). Local-first; cross-tab + P2P gossip via
  // BroadcastChannel is set up lazily on first placement.
  import("./lib/world/worldPlacementsStore").then(m => m.hydrateWorldPlacements()).catch(() => {});

  // Phase 5b — Wire world placements + forged tools to SwarmMesh so
  // connected peers see each other's buildings and dropped tools.
  import("./lib/world/p2pPlacementBridge").then(m => m.bootPlacementGossipBridge()).catch(() => {});

  // Phase 6 — Lab → Project submissions. Hydrate prior submissions so
  // the chosen Brain sees them after reload; cross-tab/P2P gossip is
  // set up lazily by the store on first submit.
  import("./lib/remix/labProjectBridge").then(m => m.hydrateProjectMints()).catch(() => {});

  // Brains gallery — hydrate public Brain submissions so the Remix
  // Brains tab has data on first paint.
  import("./lib/remix/brainSubmissionsStore").then(m => m.hydrateBrainSubmissions()).catch(() => {});

  // Phase: Lab UX — hydrate harvested chemical inventory (in-world atoms
  // the user has gathered). Drives the Lab locked-element overlay and the
  // live deduction HUD while drawing.
  import("./lib/remix/harvestedInventory")
    .then((inv) => inv.hydrateHarvestedInventory())
    .catch(() => {});

  // Forge — hydrate active coin-craft progress so the Crafting tab can
  // resume strikes after reload / across tabs.
  import("./lib/remix/coinCraftingStore")
    .then((m) => m.hydrateCoinCrafting())
    .catch(() => {});

  // Phase 2 — NPCs come alive. Defer to the single bootNpcWorld entry
  // point used by the world scene so seed + rehydrate + scheduler all
  // run through one idempotent path anchored to the shared village.
  import("./lib/brain/npc/bootNpcWorld")
    .then((m) => m.bootNpcWorld('swarm-shared-village'))
    .catch((err) => console.warn('[main] NPC boot failed', err));

});

// Global presence registry — timing follows the user's loading priority.
// mesh/network start itself is still owned by useP2P behind the unified
// auth-ready gate.
{
  const globalCellDelay =
    __loadingPriority === 'p2p' ? 0
    : __loadingPriority === 'social' ? 2000
    : 0;
  setTimeout(() => {
    import('./lib/p2p/globalCell').then(m => m.getGlobalCell().start()).catch(() => {});
  }, globalCellDelay);
}
