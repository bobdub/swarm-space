import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { getAppVersionWatch, type AppUpdateState } from "@/lib/p2p/appVersion";

/**
 * Shown when a peer's build stamp led this tab to find a newer build on its
 * own host. Auto mode counts down and refreshes; manual mode (stale cache,
 * live call, no tab storage) waits for the person.
 */
export function AppUpdateNotice() {
  const watch = getAppVersionWatch();
  const [state, setState] = useState<AppUpdateState>(() => watch.getState());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => watch.subscribe(setState), [watch]);

  const deadline = state.status === "available" ? state.deadline : null;
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (state.status !== "available") return null;

  const seconds = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  let detail: string;
  if (state.mode === "auto") {
    detail = `Refreshing in ${seconds}s so you stay on the same chain rules as your peers.`;
  } else if (state.reason === "stale-cache") {
    detail = "A normal refresh brought back the old build. Try a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac).";
  } else if (state.reason === "call") {
    detail = "Refresh when your call ends to stay on the same chain rules as your peers.";
  } else {
    detail = "Refresh to stay on the same chain rules as your peers.";
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-x-0 top-2 z-[9998] mx-auto flex w-[calc(100%-1rem)] max-w-xl flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur sm:text-sm"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">A newer Swarm Space build is live.</strong> {detail}
      </span>
      <button
        type="button"
        onClick={() => watch.refreshNow()}
        className="rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground hover:bg-primary/90"
      >
        Refresh now
      </button>
      <button
        type="button"
        aria-label="Not now"
        title="Not now"
        onClick={() => watch.dismiss()}
        className="rounded-full p-1 hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
