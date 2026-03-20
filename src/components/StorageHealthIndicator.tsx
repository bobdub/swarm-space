import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, HardDrive } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StorageHealth {
  localStorageOk: boolean;
  indexedDbOk: boolean;
  quotaUsedMb: number | null;
  quotaTotalMb: number | null;
}

async function checkStorageHealth(): Promise<StorageHealth> {
  let localStorageOk = true;
  let indexedDbOk = true;
  let quotaUsedMb: number | null = null;
  let quotaTotalMb: number | null = null;

  // localStorage test
  try {
    const key = "__storage_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
  } catch {
    localStorageOk = false;
  }

  // IndexedDB test
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("__idb_health_check__", 1);
      req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase("__idb_health_check__"); resolve(); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  } catch {
    indexedDbOk = false;
  }

  // Storage quota
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est.usage != null) quotaUsedMb = Math.round(est.usage / 1024 / 1024);
      if (est.quota != null) quotaTotalMb = Math.round(est.quota / 1024 / 1024);
    } catch {}
  }

  return { localStorageOk, indexedDbOk, quotaUsedMb, quotaTotalMb };
}

export function StorageHealthIndicator() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  useEffect(() => {
    checkStorageHealth().then(setHealth);
  }, []);

  if (!health) return null;

  const allGood = health.localStorageOk && health.indexedDbOk;
  const quotaPercent =
    health.quotaUsedMb != null && health.quotaTotalMb != null && health.quotaTotalMb > 0
      ? Math.round((health.quotaUsedMb / health.quotaTotalMb) * 100)
      : null;

  if (allGood && (quotaPercent === null || quotaPercent < 80)) {
    return (
      <div className="flex items-center gap-2 text-xs text-foreground/50">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        <span>Storage healthy</span>
        {quotaPercent !== null && (
          <span className="text-foreground/30">({quotaPercent}% used)</span>
        )}
      </div>
    );
  }

  return (
    <Alert variant="destructive" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm font-semibold">Storage Warning</AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        {!health.localStorageOk && (
          <p>⚠ localStorage blocked — Brave Shields or privacy settings may wipe your session.</p>
        )}
        {!health.indexedDbOk && (
          <p>⚠ IndexedDB unavailable — your identity and data cannot be stored persistently.</p>
        )}
        {quotaPercent !== null && quotaPercent >= 80 && (
          <p>
            <HardDrive className="inline h-3 w-3 mr-1" />
            Storage {quotaPercent}% full ({health.quotaUsedMb} MB / {health.quotaTotalMb} MB). Consider clearing old data.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
