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

  // Lab → World bridge — hydrate prior mints so they re-appear in the
  // Builder Bar after reload. Local-first; P2P gossip via BroadcastChannel
  // is set up lazily by the store on first mint.
  import("./lib/remix/lab.bus").then(m => m.bootLabBusBridges()).catch(() => {});

});

// Global presence registry remains eager, but mesh/network start is now owned
// solely by useP2P behind the unified auth-ready gate.
setTimeout(() => {
  import('./lib/p2p/globalCell').then(m => m.getGlobalCell().start()).catch(() => {});
}, 0);
