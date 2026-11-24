import { getCallAudioContext } from '@/lib/webrtc/sharedAudioContext';
import { loadHubPrefs, saveHubPrefs } from '@/lib/virtualHub/avatars';
import { isPeerMuted } from '@/lib/brain/mutedPeersStore';
import { deriveBlockedPeerIds, loadBlocklistFromStorage } from '@/lib/p2p/blocklistStore';

/**
 * Brain chat chirp: a short synthesized bird call when someone else's chat
 * line arrives. Plays through the one shared call AudioContext (no asset,
 * no new context), stays silent while that context is not allowed to run
 * (browser autoplay), and is throttled so a burst of lines chirps once.
 */

/** Minimum gap between chirps; lines inside the window stay silent. */
export const CHIRP_MIN_GAP_MS = 1500;
/** Peak gain of the chirp, kept well below voice level. */
export const CHIRP_PEAK_GAIN = 0.25;

export function isChatChirpEnabled(): boolean {
  try { return loadHubPrefs().chatChirp !== false; } catch { return true; }
}

export function setChatChirpEnabled(enabled: boolean): void {
  saveHubPrefs({ chatChirp: enabled });
}

/** Pure throttle: may a chirp sound at `now` given the last one at `lastAt`? */
export function chirpAllowed(lastAt: number | null, now: number, gapMs = CHIRP_MIN_GAP_MS): boolean {
  return lastAt === null || now - lastAt >= gapMs;
}

let lastChirpAt: number | null = null;

/** Test hook: forget the last chirp time and the seen line ids. */
export function resetChatChirpThrottle(): void {
  lastChirpAt = null;
  recentIds.length = 0;
  recentSet.clear();
}

/** Three rising whistles, ~0.35 s in total. */
function scheduleChirp(ctx: AudioContext): void {
  const out = ctx.createGain();
  out.gain.value = CHIRP_PEAK_GAIN;
  out.connect(ctx.destination);
  const start = ctx.currentTime + 0.01;
  const notes: Array<[offset: number, dur: number, from: number, to: number]> = [
    [0, 0.08, 2200, 3600],
    [0.12, 0.08, 2400, 3900],
    [0.24, 0.11, 2600, 4200],
  ];
  let end = start;
  for (const [offset, dur, from, to] of notes) {
    const t0 = start + offset;
    const t1 = t0 + dur;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(to, t1);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t1 + 0.01);
    end = t1;
  }
  const cleanupMs = Math.ceil((end - ctx.currentTime + 0.05) * 1000);
  setTimeout(() => { try { out.disconnect(); } catch { /* already gone */ } }, cleanupMs);
}

function skip(reason: string): false {
  try { console.debug(`[chatChirp] silent: ${reason}`); } catch { /* ignore */ }
  return false;
}

/**
 * Chirp for an incoming chat line if the chirp is on, the throttle allows
 * it and the shared AudioContext may play. Returns true when one was played
 * (or queued behind a permitted resume).
 */
export function playChatChirp(now: number = Date.now()): boolean {
  if (!isChatChirpEnabled()) return skip('turned off');
  if (!chirpAllowed(lastChirpAt, now)) return skip('throttled');
  const ctx = getCallAudioContext();
  if (!ctx) return skip('no AudioContext');
  if (ctx.state === 'running') {
    lastChirpAt = now;
    try { scheduleChirp(ctx); } catch { return skip('schedule failed'); }
    return true;
  }
  // Autoplay: only try to wake the context once the page has had a user
  // gesture; otherwise stay silent rather than queue a late chirp.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ctx.state !== 'suspended' || (activation && !activation.hasBeenActive)) return skip(`audio ${ctx.state}, no gesture yet`);
  lastChirpAt = now;
  void ctx.resume().then(() => {
    if (ctx.state === 'running') scheduleChirp(ctx);
    else skip(`audio still ${ctx.state} after resume`);
  }).catch(() => skip('resume refused'));
  return true;
}

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
let unlockArmed = false;

/**
 * Browsers (Safari/iOS strictly, others in some cases) only let an
 * AudioContext start inside a user gesture. Chat lines arrive outside one,
 * so wake the shared call context on the next tap, click or key press and
 * keep it running for later chirps. Idempotent; listeners leave once the
 * context runs.
 */
export function armChatChirpAudio(): void {
  if (unlockArmed || typeof window === 'undefined') return;
  unlockArmed = true;
  const unlock = () => {
    const ctx = getCallAudioContext();
    if (!ctx) return;
    const done = () => {
      if (ctx.state !== 'running') return;
      for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, unlock, true);
      unlockArmed = false;
    };
    if (ctx.state === 'suspended') void ctx.resume().then(done).catch(() => {});
    else done();
  };
  for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

const recentIds: string[] = [];
const recentSet = new Set<string>();
const RECENT_CAP = 200;

/** Remember a line id; false when it was already seen (duplicate delivery). */
function markSeen(id: string): boolean {
  if (recentSet.has(id)) return false;
  recentSet.add(id);
  recentIds.push(id);
  if (recentIds.length > RECENT_CAP) recentSet.delete(recentIds.shift()!);
  return true;
}

/**
 * Chirp for a chat line from someone else. Own lines never reach here (the
 * room chat drops our echoes); duplicates and lines from muted people or
 * anyone on the P2P blocklist stay silent.
 */
export function chirpForRemoteLine(line: { id: string; peerId?: string; authorId?: string }, now: number = Date.now()): boolean {
  if (!markSeen(line.id)) return skip('duplicate line');
  const ids = [line.peerId, line.authorId].filter((id): id is string => Boolean(id));
  if (ids.some((id) => isPeerMuted(id))) return skip('sender muted');
  // Blocks made outside the Brain (connections panel) live only in the P2P blocklist.
  const blocked = new Set(deriveBlockedPeerIds(loadBlocklistFromStorage()));
  if (ids.some((id) => blocked.has(id))) return skip('sender blocked');
  return playChatChirp(now);
}
