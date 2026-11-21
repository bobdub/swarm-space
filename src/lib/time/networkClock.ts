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
 *
 * Cadence Clock (mesh agreement): every mesh ping reply also carries the
 * sender's corrected clock. We correct each reading for half the round trip
 * (Cristian's algorithm), drop slow round trips, average each peer's last 4
 * readings, and take the median across peers. A burst of 4 pings goes out
 * when a channel opens so a new peer is calibrated within a second.
 *
 * The site's server stays the anchor: once it has answered, the mesh may
 * only refine our clock within the server's own precision window, so a
 * group of wrong peers can't pull us away from real time. When the server
 * can't be reached, the mesh median is used on its own.
 *
 * The clock never steps backwards by small amounts: small corrections are
 * eased in, large ones (a device clock that is minutes or hours out) apply at
 * once. The correction survives a page reload through sessionStorage.
 */

/** Smaller differences are treated as noise. */
export const MIN_CORRECTION_MS = 60_000;
/** A live line further than this from our clock came from a skewed sender. */
export const LIVE_SKEW_LIMIT_MS = 2 * MIN_CORRECTION_MS;
/** Ignore absurd answers (a cached or broken Date header). */
const MAX_CORRECTION_MS = 26 * 60 * 60 * 1000;
const RESYNC_MS = 30 * 60 * 1000;
/** Peer readings whose round trip took longer than this are too vague to use. */
export const MAX_SAMPLE_RTT_MS = 1_000;
/** Forget a peer's reading after this long (it left, or its clock moved). */
const SAMPLE_TTL_MS = 10 * 60 * 1000;
/** Corrections larger than this apply at once instead of being eased in. */
export const STEP_THRESHOLD_MS = 5_000;
/** Easing rate: the correction moves at most this fraction of elapsed time. */
const SLEW_RATE = 0.1;
/** A device clock that moved this much against the monotonic stopwatch was changed (or slept). */
const WALL_JUMP_MS = 2_000;
const SESSION_KEY = 'swarm-network-clock';
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Offset measured against the site's server (0 inside its precision window). */
let offsetMs = 0;
/** Whether the server has answered at least once this session. */
let originSynced = false;
/** Offset actually applied right now (eases toward the target). */
let appliedMs = 0;
let lastApplyPerf = 0;
let lastReturned = 0;
let wallMinusPerf = NaN;
/** Correction restored after a reload; used until fresh peer readings arrive. */
let restoredTarget: number | null = null;
let syncing: Promise<number> | null = null;
let lastSyncAt = 0;

interface PeerClockSample {
  offset: number;
  rtt: number;
  at: number;
}
/** Readings kept per peer; the peer's offset is their average. */
export const SAMPLES_PER_PEER = 4;
const peerSamples = new Map<string, PeerClockSample[]>();

/** Average offset of a peer's fresh readings, or null with none. */
function peerOffset(peerId: string, at: number): number | null {
  const list = (peerSamples.get(peerId) ?? []).filter((sample) => at - sample.at <= SAMPLE_TTL_MS);
  if (list.length === 0) {
    peerSamples.delete(peerId);
    return null;
  }
  peerSamples.set(peerId, list);
  return list.reduce((sum, sample) => sum + sample.offset, 0) / list.length;
}

function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Median of the fresh peer readings, or null with none. */
export function meshClockOffset(at: number = Date.now()): number | null {
  const fresh: number[] = [];
  for (const peerId of [...peerSamples.keys()]) {
    const offset = peerOffset(peerId, at);
    if (offset !== null) fresh.push(offset);
  }
  if (fresh.length === 0) return null;
  fresh.sort((a, b) => a - b);
  const mid = fresh.length >> 1;
  return fresh.length % 2 ? fresh[mid] : Math.round((fresh[mid - 1] + fresh[mid]) / 2);
}

/** The offset the clock is heading toward: the server anchor, refined by the mesh. */
export function targetClockOffset(at: number = Date.now()): number {
  const mesh = meshClockOffset(at) ?? restoredTarget;
  if (mesh === null) return offsetMs;
  if (!originSynced) return Math.max(-MAX_CORRECTION_MS, Math.min(MAX_CORRECTION_MS, mesh));
  // The server is right to within MIN_CORRECTION_MS; let the mesh refine inside that.
  return Math.max(offsetMs - MIN_CORRECTION_MS, Math.min(offsetMs + MIN_CORRECTION_MS, mesh));
}

function stepApplied(): void {
  const perf = perfNow();
  const wall = Date.now();
  const drift = wall - perf;
  if (Number.isFinite(wallMinusPerf) && Math.abs(drift - wallMinusPerf) > WALL_JUMP_MS) {
    // Device clock was changed, or the device slept: old peer readings are
    // relative to the old clock, so drop them and re-check against the server.
    peerSamples.clear();
    restoredTarget = null;
    lastReturned = 0;
    wallMinusPerf = drift;
    void syncNetworkClock();
  }
  wallMinusPerf = drift;
  const target = targetClockOffset(wall);
  const gap = target - appliedMs;
  const elapsed = lastApplyPerf ? Math.max(0, perf - lastApplyPerf) : 0;
  lastApplyPerf = perf;
  if (Math.abs(gap) >= STEP_THRESHOLD_MS) {
    appliedMs = target;
    lastReturned = 0;
    return;
  }
  const maxStep = elapsed * SLEW_RATE;
  appliedMs += Math.max(-maxStep, Math.min(maxStep, gap));
}

/** Current time in epoch ms, corrected for a skewed device clock. */
export function networkNow(): number {
  maybeResync();
  stepApplied();
  const t = Math.round(Date.now() + appliedMs);
  // Never step backwards by a small amount; big jumps (above) reset this guard.
  if (t < lastReturned && lastReturned - t < STEP_THRESHOLD_MS) return lastReturned;
  lastReturned = t;
  return t;
}

/** The correction currently applied, in ms (0 when the device clock is fine). */
export function networkClockOffset(): number {
  return Math.round(appliedMs);
}

/**
 * Turn one mesh ping round trip into an offset. `sentAt`/`receivedAt` are
 * local Date.now() around the ping, `peerNow` is the peer's networkNow() from
 * its reply. Returns null when the round trip was too slow to trust.
 */
export function offsetFromPeerReply(sentAt: number, peerNow: number, receivedAt: number): number | null {
  if (![sentAt, peerNow, receivedAt].every(Number.isFinite)) return null;
  const rtt = receivedAt - sentAt;
  if (rtt < 0 || rtt > MAX_SAMPLE_RTT_MS) return null;
  const raw = peerNow + rtt / 2 - receivedAt;
  if (Math.abs(raw) > MAX_CORRECTION_MS) return null;
  return Math.round(raw);
}

/** Record a peer's clock reading from a ping reply. */
export function recordPeerClockSample(peerId: string, sentAt: number, peerNow: number, receivedAt: number): void {
  const offset = offsetFromPeerReply(sentAt, peerNow, receivedAt);
  if (offset === null || !peerId) return;
  const rtt = receivedAt - sentAt;
  // Average the last few ping-pongs: smooths out one-off jitter.
  const list = [...(peerSamples.get(peerId) ?? []), { offset, rtt, at: receivedAt }];
  peerSamples.set(peerId, list.slice(-SAMPLES_PER_PEER));
  restoredTarget = null;
  saveSession();
}

/** A peer left: drop its reading. */
export function forgetPeerClock(peerId: string): void {
  peerSamples.delete(peerId);
}

function saveSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      offset: offsetMs,
      originSynced,
      target: targetClockOffset(),
      savedAt: Date.now(),
    }));
  } catch { /* storage unavailable */ }
}

/** Restore the correction after a reload so the clock resumes without a jump. */
export function restoreNetworkClockSession(): void {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { offset?: number; originSynced?: boolean; target?: number; savedAt?: number };
    if (typeof saved.savedAt !== 'number' || Math.abs(Date.now() - saved.savedAt) > SESSION_MAX_AGE_MS) return;
    if (typeof saved.offset === 'number' && Number.isFinite(saved.offset)) offsetMs = saved.offset;
    if (typeof saved.target === 'number' && Number.isFinite(saved.target)) {
      appliedMs = saved.target;
      restoredTarget = saved.target;
    }
    originSynced = saved.originSynced === true;
  } catch { /* storage unavailable or corrupt */ }
}

/**
 * Turn one round trip into an offset. `serverDate` is the HTTP Date header,
 * `sentAt`/`receivedAt` are local Date.now() around the request.
 */
export function offsetFromServerDate(serverDate: string | null, sentAt: number, receivedAt: number): number {
  return measureServerOffset(serverDate, sentAt, receivedAt) ?? 0;
}

/**
 * Like offsetFromServerDate, but null when the header is missing, unreadable
 * or absurd, so a failed check is not mistaken for "the device clock is fine".
 */
export function measureServerOffset(serverDate: string | null, sentAt: number, receivedAt: number): number | null {
  if (!serverDate) return null;
  const server = Date.parse(serverDate);
  if (!Number.isFinite(server)) return null;
  // The header truncates to the second: the true instant is ~500 ms later on average.
  const raw = server + 500 - (sentAt + receivedAt) / 2;
  if (Math.abs(raw) > MAX_CORRECTION_MS) return null;
  if (Math.abs(raw) < MIN_CORRECTION_MS) return 0;
  return Math.round(raw);
}

/** Test/internal: set the server offset directly and clear mesh readings. */
export function setNetworkClockOffset(ms: number, opts: { originSynced?: boolean } = {}): void {
  offsetMs = Number.isFinite(ms) ? ms : 0;
  appliedMs = offsetMs;
  originSynced = opts.originSynced === true;
  lastApplyPerf = 0;
  lastReturned = 0;
  wallMinusPerf = NaN;
  peerSamples.clear();
  restoredTarget = null;
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
        const next = measureServerOffset(res.headers.get('date'), sentAt, receivedAt);
        if (next !== null) {
          if (next !== offsetMs && next !== 0) {
            console.info(`[NetworkClock] device clock is off by ${Math.round(next / 1000)}s; correcting chat timestamps`);
          }
          offsetMs = next;
          originSynced = true;
          saveSession();
        }
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

if (typeof window !== 'undefined') {
  restoreNetworkClockSession();
  try {
    document.addEventListener('visibilitychange', () => {
      // Timers and the stopwatch can pause while a device sleeps: re-check on wake.
      if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > 60_000) void syncNetworkClock();
    });
  } catch { /* no document */ }
}

// ── Causal stamps (hybrid logical clock) ─────────────────────────────
//
// A chat line must sort after every line its sender had already seen, even
// when two clocks disagree by a few milliseconds. `causalNow()` is the mesh
// clock, but never at or before the newest stamp we've seen or sent, so a
// reply typed after its parent arrived always carries a later stamp. The
// wire format stays a plain epoch-ms number, so older peers read it as is.

let causalLast = 0;

/** A timestamp later than anything this peer has seen or sent. */
export function causalNow(): number {
  const t = Math.max(networkNow(), causalLast + 1);
  causalLast = t;
  return t;
}

/**
 * Note a stamp we received. Stamps far in the future are capped, so one bad
 * peer can push our stamps ahead by at most LIVE_SKEW_LIMIT_MS.
 */
export function observeCausalTimestamp(ts: number, now: number = networkNow()): void {
  if (!Number.isFinite(ts)) return;
  causalLast = Math.max(causalLast, Math.min(ts, now + LIVE_SKEW_LIMIT_MS));
}

/** Test/internal: forget seen stamps. */
export function resetCausalClock(): void {
  causalLast = 0;
}
