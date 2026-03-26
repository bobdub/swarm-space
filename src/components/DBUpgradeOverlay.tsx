import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Full-screen overlay shown while IndexedDB is blocked on a version upgrade.
 * Listens for db-upgrade-blocked / db-upgrade-resolved window events
 * dispatched by store.ts and auto-dismisses once the DB is ready.
 */
export function DBUpgradeOverlay() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const onBlocked = () => setBlocked(true);
    const onResolved = () => setBlocked(false);

    window.addEventListener("db-upgrade-blocked", onBlocked);
    window.addEventListener("db-upgrade-resolved", onResolved);
    return () => {
      window.removeEventListener("db-upgrade-blocked", onBlocked);
      window.removeEventListener("db-upgrade-resolved", onResolved);
    };
  }, []);

  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="max-w-xs text-center text-sm text-muted-foreground">
        Syncing local database — this only takes a moment…
      </p>
    </div>
  );
}
