import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Render immediately — defer all background services to idle time
createRoot(document.getElementById("root")!).render(<App />);

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

  // Phase: Lab UX — hydrate harvested chemical inventory + wire it as
  // the holding source for element-lock gating.
  import("./lib/remix/harvestedInventory").then(async (inv) => {
    await inv.hydrateHarvestedInventory();
    const { setHoldingLookup } = await import("./lib/remix/elementHoldings");
    setHoldingLookup((symbol) => inv.getHarvested(symbol));
  }).catch(() => {});

  // Phase 2 — NPCs come alive. Hydrate persisted roster (best-effort)
  // then start the 8 Hz live tick. Honors the scaffoldBus kill-switch.
  (async () => {
    try {
      const persistence = await import("./lib/brain/npc/npcPersistence");
      const engine = await import("./lib/brain/npc/npcEngine");
      const reg = await import("./lib/brain/npc/npcRegistry");
      const roster = await persistence.loadNpcRoster();
      if (roster && roster.length > 0 && reg.listNpcs().length === 0) {
        for (const n of roster) {
          try {
            engine.spawnNpc({
              name: n.name,
              sex: n.sex,
              anchorPeerId: n.anchorPeerId,
              tx: n.tx,
              tz: n.tz,
              seed: n.seed,
            });
          } catch { /* skip duplicates / cap */ }
        }
      }
      const sched = await import("./lib/brain/npc/npcTickScheduler");
      sched.startNpcTickScheduler();
      const repro = await import("./lib/brain/npc/reproductionScheduler");
      repro.startReproductionScheduler();
    } catch (err) {
      console.warn('[main] NPC live tick boot failed', err);
    }
  })();

});

// Global presence registry remains eager, but mesh/network start is now owned
// solely by useP2P behind the unified auth-ready gate.
setTimeout(() => {
  import('./lib/p2p/globalCell').then(m => m.getGlobalCell().start()).catch(() => {});
}, 0);
