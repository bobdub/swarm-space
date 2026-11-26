/**
 * honeyStore — each player can take honey from a hive once a day.
 *
 * "A day" is the player's own calendar day, so the hive is ready again
 * after midnight local time. Remembered in localStorage so a reload does
 * not refill the comb; falls back to memory where storage is blocked.
 */

/** Honey a player takes from a hive in one visit (its own good, traded at the Trading Stand). */
export const HONEY_PER_DAY = 3;

const KEY_PREFIX = 'swarm.honey.lastDay.';
const memory = new Map<string, string>();

/** Local calendar day, e.g. "2026-11-20". */
export function honeyDay(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function readLast(hiveId: string): string | undefined {
  try {
    const v = globalThis.localStorage?.getItem(KEY_PREFIX + hiveId);
    if (v) return v;
  } catch { /* storage blocked */ }
  return memory.get(hiveId);
}

function writeLast(hiveId: string, day: string): void {
  memory.set(hiveId, day);
  try { globalThis.localStorage?.setItem(KEY_PREFIX + hiveId, day); } catch { /* storage blocked */ }
}

/** True if this player has not yet taken honey from `hiveId` today. */
export function canCollectHoney(hiveId: string, now = Date.now()): boolean {
  return readLast(hiveId) !== honeyDay(now);
}

/** Take today's honey. Returns how much, or 0 if it was already taken today. */
export function collectHoney(hiveId: string, now = Date.now()): number {
  if (!canCollectHoney(hiveId, now)) return 0;
  writeLast(hiveId, honeyDay(now));
  return HONEY_PER_DAY;
}

export function _resetHoneyForTest(): void {
  memory.clear();
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k?.startsWith(KEY_PREFIX)) ls.removeItem(k);
    }
  } catch { /* noop */ }
}
