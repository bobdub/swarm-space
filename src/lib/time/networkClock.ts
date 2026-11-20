/**
 * Network clock: wall-clock time corrected for a wrong device clock.
 *
 * Chat lines are stamped with epoch milliseconds and sorted by them. A
 * device whose clock is off (common around a daylight-saving change: the
 * clock face reads the right local time but the OS time zone or the clock
 * itself is an hour out) stamps every line it sends an hour early or late,
 * so those lines land an hour away from everyone else's in the timeline.
 *
 * We measure the device's offset against the HTTP `Date` header of the
 * app's own origin (no third party; same-origin, so the header is readable)
 * and expose `networkNow()` = `Date.now()` + that offset. Offsets under
 * `MIN_CORRECTION_MS` are ignored: the header has one-second precision and
 * healthy clocks are well within a minute.
 */

/** Smaller differences are treated as noise. */
export const MIN_CORRECTION_MS = 60_000;
/** A live line further than this from our clock came from a skewed sender. */
export const LIVE_SKEW_LIMIT_MS = 2 * MIN_CORRECTION_MS;
/** Ignore absurd answers (a cached or broken Date header). */
const MAX_CORRECTION_MS = 26 * 60 * 60 * 1000;
const RESYNC_MS = 30 * 60 * 1000;

let offsetMs = 0;
let syncing: Promise<number> | null = null;
let lastSyncAt = 0;

/** Current time in epoch ms, corrected for a skewed device clock. */
export function networkNow(): number {
  maybeResync();
  return Date.now() + offsetMs;
}

/** The correction currently applied, in ms (0 when the device clock is fine). */
export function networkClockOffset(): number {
  return offsetMs;
}

/**
 * Turn one round trip into an offset. `serverDate` is the HTTP Date header,
 * `sentAt`/`receivedAt` are local Date.now() around the request.
 */
export function offsetFromServerDate(serverDate: string | null, sentAt: number, receivedAt: number): number {
  if (!serverDate) return 0;
  const server = Date.parse(serverDate);
  if (!Number.isFinite(server)) return 0;
  // The header truncates to the second: the true instant is ~500 ms later on average.
  const raw = server + 500 - (sentAt + receivedAt) / 2;
  if (Math.abs(raw) < MIN_CORRECTION_MS || Math.abs(raw) > MAX_CORRECTION_MS) return 0;
  return Math.round(raw);
}

/** Test/internal: set the offset directly. */
export function setNetworkClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0;
  lastSyncAt = Date.now();
}

/** Measure the device clock against the app origin. Safe to call repeatedly. */
export function syncNetworkClock(): Promise<number> {
  if (syncing) return syncing;
  lastSyncAt = Date.now();
  if (
    typeof window === 'undefined'
    || typeof fetch !== 'function'
    || !window.location?.origin?.startsWith('http')
  ) {
    return Promise.resolve(offsetMs);
  }
  syncing = (async () => {
    try {
      const sentAt = Date.now();
      const res = await fetch(`${window.location.origin}/favicon.png?clock=${sentAt}`, {
        method: 'HEAD',
        cache: 'no-store',
      });
      const receivedAt = Date.now();
      // A slow round trip makes the midpoint guess unreliable.
      if (receivedAt - sentAt < 10_000) {
        const next = offsetFromServerDate(res.headers.get('date'), sentAt, receivedAt);
        if (next !== offsetMs && next !== 0) {
          console.info(`[NetworkClock] device clock is off by ${Math.round(next / 1000)}s; correcting chat timestamps`);
        }
        offsetMs = next;
      }
    } catch {
      /* offline or blocked: keep the last known offset */
    } finally {
      syncing = null;
    }
    return offsetMs;
  })();
  return syncing;
}

function maybeResync(): void {
  if (Date.now() - lastSyncAt > RESYNC_MS) void syncNetworkClock();
}

/**
 * A live chat line was just received, so it was sent moments ago. If the
 * sender's stamp is far from our (corrected) clock, the sender's device
 * clock is wrong: place the line at the moment it arrived instead.
 */
export function reconcileLiveTimestamp(senderTs: number, now: number = networkNow()): number {
  if (!Number.isFinite(senderTs)) return now;
  return Math.abs(senderTs - now) > LIVE_SKEW_LIMIT_MS ? now : senderTs;
}
