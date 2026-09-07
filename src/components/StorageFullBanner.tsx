import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, HardDrive, X } from "lucide-react";
import { getStorageHealth, STORAGE_WARN_PERCENT, STORAGE_BLOCK_PERCENT } from "@/lib/storage/quotaGuard";

const SESSION_KEY = "storage-banner-dismissed";
const SNOOZE_KEY = "storage-banner-snooze-until";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

/**
 * Storage pressure notice. Warns at 85%, hard-blocks copy at 90% (asset
 * transfers are gated at the same threshold by `assertStorageWritable`).
 * Sits in the page flow so it never covers content, can be closed for the
 * session, and links straight to Settings → Storage.
 */
export function StorageFullBanner() {
  const [percent, setPercent] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissed());

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

  if (dismissed) return null;
  if (percent == null || percent < STORAGE_WARN_PERCENT) return null;

  const critical = percent >= STORAGE_BLOCK_PERCENT;

  const dismiss = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
      // Below the hard-block level the notice also stays quiet for a day.
      if (!critical) localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* storage unavailable — dismiss for this render only */
    }
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className={`relative z-40 flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-xs sm:text-sm ${
        critical
          ? "bg-destructive/95 text-destructive-foreground"
          : "bg-amber-500/90 text-black"
      }`}
    >
      {critical ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <HardDrive className="h-4 w-4 shrink-0" />}
      <span className="min-w-0">
        {critical
          ? `Local storage ${percent}% full — asset transfers are blocked. Download a copy of your media and clear space.`
          : `Local storage ${percent}% full — download a copy of your media soon to protect your tokens and coins.`}
      </span>
      <Link
        to="/settings?tab=storage"
        className="rounded-full border border-current/40 px-3 py-1 font-medium underline-offset-2 hover:underline"
      >
        Free up space
      </Link>
      <button
        type="button"
        aria-label="Close storage notice"
        onClick={dismiss}
        className="ml-1 rounded-full p-1 hover:bg-black/10"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
