/**
 * Files the user flushed from the Transfers list. Automatic post sync,
 * retries and media coin fill-ins skip them; a peer announcing that it
 * seeds one, or the user opening it, lifts the flag.
 */
const FLUSHED_ASSETS_KEY = 'swarm-flushed-assets';

export function getFlushedAssets(): Set<string> {
  try {
    const raw = localStorage.getItem(FLUSHED_ASSETS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

export function saveFlushedAssets(set: Set<string>): void {
  try {
    // Bounded so the key can't grow forever; newest ids are kept.
    const arr = Array.from(set);
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    localStorage.setItem(FLUSHED_ASSETS_KEY, JSON.stringify(arr));
  } catch { /* noop */ }
}

export function clearFlushedAsset(manifestId: string): void {
  const set = getFlushedAssets();
  if (set.delete(manifestId)) saveFlushedAssets(set);
}

export function isAssetFlushed(manifestId: string): boolean {
  return getFlushedAssets().has(manifestId);
}
