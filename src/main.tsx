import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadConnectionState } from "./lib/p2p/connectionState";

// Render immediately — defer all background services to idle time
createRoot(document.getElementById("root")!).render(<App />);

// ── Deferred boot tasks (run after first paint) ──
const scheduleIdle = (fn: () => void) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn());
  } else {
    setTimeout(fn, 200);
  }
};

scheduleIdle(() => {
  // Initialize blockchain integration
  import("./lib/blockchain").then(m => m.initializeBlockchainIntegration());

  // Backfill manifests with raw keys so peers can decrypt shared content
  setTimeout(() => import("./lib/fileEncryption").then(m => void m.backfillManifestRawKeys()), 3000);

  // ── Sync dual enabled flags before auto-start ──
  // Older accounts may have p2p-connection-state.enabled=true but
  // swarm-mesh-flags.enabled=false (or vice versa). Sync them.
  const connState = loadConnectionState();
  if (connState.enabled) {
    try {
      const raw = localStorage.getItem('swarm-mesh-flags');
      if (raw) {
        const flags = JSON.parse(raw);
        if (flags?.enabled !== true) {
          flags.enabled = true;
          localStorage.setItem('swarm-mesh-flags', JSON.stringify(flags));
          console.log('[main] Synced swarm-mesh-flags.enabled=true from unified state');
        }
      }
    } catch { /* ignore */ }
  }

  // Auto-start the correct P2P mode based on persisted connection state.
  // Builder Mode is no longer auto-started — it's lazy-loaded on demand
  // via User Cells (see lib/p2p/userCell.ts). SWARM-only users never load
  // the Builder code path on boot.
  if (connState.enabled && connState.mode === 'swarm') {
    import("./lib/p2p/swarmMesh.standalone").then(m => {
      const mesh = m.getSwarmMeshStandalone();
      void mesh.autoStart();
    });
  } else if (!connState.enabled) {
    import("./lib/p2p/testMode.standalone").then(m => {
      const tm = m.getTestMode();
      void tm.autoStart();
    });
  }

  // Start deterministic room discovery overlay
  import("./lib/p2p/roomDiscovery.standalone").then(m => m.getRoomDiscovery().start());

  // Start global cell — Gun.js presence registry
  import('./lib/p2p/globalCell').then(m => m.getGlobalCell().start()).catch(() => {});

  // Initialize entity voice
  import("./lib/p2p/entityVoiceIntegration").then(m => m.initEntityVoiceListener());
});
