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
