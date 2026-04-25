import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { loadConnectionState } from "./lib/p2p/connectionState";

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

  // Start deterministic room discovery overlay
  import("./lib/p2p/roomDiscovery.standalone").then(m => m.getRoomDiscovery().start());

  // Initialize entity voice
  import("./lib/p2p/entityVoiceIntegration").then(m => m.initEntityVoiceListener());

  // UQRC Health Bridge — wires browser stress, content-delivery telemetry,
  // and MineHealth into the shared field. Closes the cross-layer feedback loop.
  import("./lib/uqrc/healthBridge").then(m => m.startHealthBridge()).catch(() => {});
});

// ── SWARM auto-start (NOT idle-gated) ──
// Chrome aggressively defers requestIdleCallback for backgrounded / freshly
// loaded tabs, so /brain sometimes never booted SWARM. Use a plain microtask
// timeout so the engine reliably starts after first paint.
setTimeout(() => {
  const connState = loadConnectionState();
  // GlobalCell (Gun.js presence registry) must boot eagerly alongside the
  // mesh — not via requestIdleCallback. Heavy routes like /brain saturate
  // the main thread with WebGL work, which delays idle callbacks long
  // enough that the mesh comes online with an empty peer library and
  // dials nothing on first cascade.
  import('./lib/p2p/globalCell').then(m => m.getGlobalCell().start()).catch(() => {});

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
}, 0);
