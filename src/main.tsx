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
