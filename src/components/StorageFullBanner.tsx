import { useEffect, useState } from "react";
import { AlertTriangle, HardDrive } from "lucide-react";
import { getStorageHealth, STORAGE_WARN_PERCENT, STORAGE_BLOCK_PERCENT } from "@/lib/storage/quotaGuard";

/**
 * Global banner that surfaces storage pressure. Warns at 85%, hard-blocks
 * copy at 90% (asset transfers are also gated at the same threshold by
 * `assertStorageWritable`).
 */
export function StorageFullBanner() {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const h = await getStorageHealth(true);
      if (!cancelled) setPercent(h.percent);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (percent == null || percent < STORAGE_WARN_PERCENT) return null;

  const critical = percent >= STORAGE_BLOCK_PERCENT;
  return (
    <div
      role="alert"
      className={`fixed top-0 inset-x-0 z-[999] px-3 py-2 text-xs sm:text-sm flex items-center gap-2 justify-center ${
        critical
          ? "bg-destructive/95 text-destructive-foreground"
          : "bg-amber-500/90 text-black"
      }`}
    >
      {critical ? <AlertTriangle className="h-4 w-4" /> : <HardDrive className="h-4 w-4" />}
      <span>
        {critical
          ? `Local storage ${percent}% full — asset transfers are blocked. Withdraw to MetaMask or export a backup to free space.`
          : `Local storage ${percent}% full — export a backup soon to protect your tokens and coins.`}
      </span>
    </div>
  );
}