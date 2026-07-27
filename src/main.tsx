import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { getLoadingPriority } from "./lib/settings/loadingPriority";
// Render immediately — defer all background services to idle time
createRoot(document.getElementById("root")!).render(<App />);

const __loadingPriority = getLoadingPriority();
console.log(`[main] Loading priority: ${__loadingPriority}`);

// ── Browser Guardrails: adaptive loading chain ──
// Walks the user's configured chain (defaults derived from their loading
// priority preset), pausing before any step whose min QScore isn't met.
// Idempotent; replaces the previous single-shot idle-boot block.
const scheduleIdle = (fn: () => void) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 1500 });
  } else {
    setTimeout(fn, 200);
  }
};

scheduleIdle(() => {
  import('./lib/guardrails/chainRunner')
    .then((m) => m.startChain())
    .catch((err) => console.warn('[main] guardrails chain failed', err));
});

// ── Sync Vault ingest — observes MediaCustody events and writes verified
// media into the source peer's local vault. Feature-flagged; no new gossip.
scheduleIdle(() => {
  Promise.all([
    import('./lib/blockchain/vaultIngest'),
    import('./lib/store'),
  ])
    .then(([ingest, store]) => {
      ingest.startVaultIngest(async () => {
        try {
          return await store.getAll('swarmCoins');
        } catch {
          return [];
        }
      });
    })
    .catch((err) => console.warn('[main] vault ingest failed', err));
});

// ── Sync Vault enforcement — flag entries whose torrent is no longer
// seeding so the redundancy sweep can pull them back. 60 s cadence.
scheduleIdle(() => {
  import('./lib/blockchain/vaultSeeder')
    .then((m) => {
      const tick = () => { void m.enforceVaultSeeding().catch(() => {}); };
      tick();
      setInterval(tick, 60_000);
    })
    .catch((err) => console.warn('[main] vault seeder failed', err));
});

// ── Media Coin wrap sweep — promotes sealed archive coins onto real
// wallet coins whenever the user has enough SWARM. 5 min + on tx events.
scheduleIdle(() => {
  import('./lib/blockchain/mediaCoinWrapSweep')
    .then((m) => m.startWrapSweep())
    .catch((err) => console.warn('[main] media coin wrap sweep failed', err));
});

// ── One-shot cleanup: normalize legacy vault refs, repair 100 MiB refs,
// and enforce one active filling media coin per vault.
scheduleIdle(() => {
  import('./lib/blockchain/syncVault')
    .then((m) => m.reconcileVaultCoinState())
    .catch((err) => console.warn('[main] media coin reconcile failed', err));
});

// ── Stuck-write watch — seals stalled media coins as failed archives
// and requeues their entries onto fresh coins. 30 s cadence.
scheduleIdle(() => {
  import('./lib/blockchain/mediaCoinStuckWatch')
    .then((m) => m.startStuckWatch())
    .catch((err) => console.warn('[main] media coin stuck watch failed', err));
});

// ── Reconnect sync — announces offline-created coins + kicks a wrap
// sweep the moment connectivity returns.
scheduleIdle(() => {
  import('./lib/blockchain/mediaCoinReconnectSync')
    .then((m) => m.startReconnectSync())
    .catch((err) => console.warn('[main] media coin reconnect sync failed', err));
});
