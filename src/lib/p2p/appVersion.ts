/**
 * App release handoff over the mesh.
 *
 * There is no service worker, so a tab keeps running the build it loaded
 * until it is refreshed. Chain rule changes need every peer on the new
 * build, so peers tell each other their release once a data channel has
 * settled (`releaseHandshake.ts`). The wire packet carries only internal
 * identifiers, never a timestamp:
 *
 *   { type: 'app-release', release: 14, id: 'a4f89c0' }
 *
 * Releases are ordered strictly by the monotonic counter in `release.json`
 * (v0.014 = 14); no wall clock is consulted. A peer's claim is only a hint.
 * Infinity verifies it against this tab's OWN host (`version.json`, written
 * at build time) before anyone is told:
 *
 * - The host must be serving a release at least as new as the claim and
 *   newer than this tab. A spoofed claim (release 99999) fails that check
 *   and is dropped silently.
 * - Each claimed release is checked at most once per tab (a host read
 *   that fails outright forgets the claim so a later one can retry). Claims that
 *   arrive while a read is in flight are answered together by the next
 *   read. There are no timers.
 * - A claim at or below a release the host has already shown is confirmed
 *   by that read, with no new request.
 * - A peer on a release this host has not deployed (another host, a
 *   preview, a dev server) changes nothing, so a refresh can never land on
 *   the same old build and loop.
 * - Every update waits for an explicit choice; there is no auto-refresh.
 *   A live call, the current world and mesh sync remain intact until then.
 */

import { isCallActive } from './callActivity';

export interface ReleaseStamp {
  /** Monotonic release counter (v0.014 = 14), bumped on every merge to main. */
  release: number;
  /** Short commit hash (or a fallback id); for display only. */
  id: string;
}

/** The one packet peers swap about versions. */
export interface AppReleasePacket {
  type: 'app-release';
  release: number;
  id: string;
}

const MAX_ID_LENGTH = 64;
export const MAX_RELEASE = 10_000_000;
/** Remembered spoofed claims; a bounded set so a noisy peer cannot grow it. */
const MAX_REJECTED = 64;
const RELOAD_ATTEMPT_KEY = 'swarm-app-release-reload-attempt';

/** True when `a` is a later release than `b`. */
export function isNewerRelease(a: ReleaseStamp, b: ReleaseStamp | null): boolean {
  return a.release > (b?.release ?? 0);
}

/** Validates a stamp from a peer packet or `version.json`. */
export function parseReleaseStamp(raw: unknown): ReleaseStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const { release, id } = raw as { release?: unknown; id?: unknown };
  if (typeof release !== 'number' || !Number.isSafeInteger(release) || release <= 0 || release > MAX_RELEASE) return null;
  if (id === undefined) return { release, id: '' };
  if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) return null;
  return { release, id };
}

export function appReleasePacket(local: ReleaseStamp): AppReleasePacket {
  return { type: 'app-release', release: local.release, id: local.id };
}

declare const __APP_BUILD__: unknown;

/** The release this tab is running. release 0 means unknown (tests). */
export const LOCAL_RELEASE: ReleaseStamp = (() => {
  try {
    if (typeof __APP_BUILD__ !== 'undefined') {
      const parsed = parseReleaseStamp(__APP_BUILD__);
      if (parsed) return parsed;
    }
  } catch { /* not defined */ }
  return { release: 0, id: 'unknown' };
})();

export type UpdateNoticeReason =
  /** A refresh for this release already ran and the old build came back. */
  | 'stale-cache'
  /** A call is live, so the refresh waits for the person. */
  | 'call'
  /** Tab storage is unavailable, so a refresh loop cannot be ruled out. */
  | 'no-guard';

export type AppUpdateState =
  | { status: 'idle' }
  | {
      status: 'available';
      deployed: ReleaseStamp;
      mode: 'manual';
      deadline: null;
      reason: UpdateNoticeReason | null;
    };

export interface AppVersionDeps {
  local: ReleaseStamp;
  fetchDeployed: () => Promise<unknown>;
  reload: () => void;
  isCallActive: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

type Listener = (state: AppUpdateState) => void;

export class AppVersionWatch {
  private state: AppUpdateState = { status: 'idle' };
  private listeners = new Set<Listener>();
  private checking = false;
  /** Claimed releases waiting for the next host read. */
  private pending = new Set<number>();
  /** Claimed releases the read in flight will answer. */
  private inFlight = new Set<number>();
  /** Newest release the host itself has shown this tab. */
  private hostRelease: ReleaseStamp | null = null;
  /** Claims the host did not back (spoofed, or another host's build). */
  private rejected = new Set<number>();
  /** Release the person said "Not now" to in this tab. */
  private dismissed: ReleaseStamp | null = null;

  constructor(private readonly deps: AppVersionDeps) {
    this.clearSucceededAttempt();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The stamp this node announces to peers. */
  getLocalRelease(): ReleaseStamp {
    return this.deps.local;
  }

  /**
   * A peer told us its release. Returns true when it led to a host read.
   * The claim is only a hint; the host's `version.json` decides.
   */
  notePeerRelease(raw: unknown): boolean {
    const { local } = this.deps;
    if (local.release <= 0) return false;
    const claim = parseReleaseStamp(raw);
    if (!claim || !isNewerRelease(claim, local)) return false;
    // The host already showed a release at least this new: confirmed.
    if (this.hostRelease && claim.release <= this.hostRelease.release) {
      this.confirm(this.hostRelease);
      return false;
    }
    const r = claim.release;
    if (this.rejected.has(r) || this.pending.has(r) || this.inFlight.has(r)) return false;
    this.pending.add(r);
    // A read in flight answers older claims; this one rides the next read.
    if (this.checking) return false;
    void this.checkHost();
    return true;
  }

  /** Infinity's verification loop: one host read answers every pending claim. */
  private async checkHost(): Promise<void> {
    if (this.checking || this.pending.size === 0) return;
    this.checking = true;
    const claims = [...this.pending];
    this.inFlight = new Set(claims);
    this.pending.clear();
    let deployed: ReleaseStamp | null = null;
    try {
      deployed = parseReleaseStamp(await this.deps.fetchDeployed());
    } catch {
      deployed = null;
    } finally {
      this.checking = false;
      this.inFlight = new Set();
    }
    // An unreachable host proves nothing either way: forget these claims
    // so a later announcement (reconnect, another peer) can try again.
    if (deployed) {
      if (isNewerRelease(deployed, this.hostRelease)) this.hostRelease = deployed;
      const shown = this.hostRelease ?? deployed;
      let confirmed = false;
      for (const claim of claims) {
        if (claim <= shown.release) confirmed = true;
        else this.reject(claim);
      }
      if (confirmed) this.confirm(shown);
    }
    // Claims that arrived while this read was in flight.
    if (this.pending.size > 0) void this.checkHost();
  }

  private reject(release: number): void {
    // Silent: a failed claim never reaches the person.
    this.rejected.add(release);
    if (this.rejected.size > MAX_REJECTED) {
      const oldest = this.rejected.values().next().value;
      if (oldest !== undefined) this.rejected.delete(oldest);
    }
  }

  private confirm(deployed: ReleaseStamp): void {
    if (!isNewerRelease(deployed, this.deps.local)) return;
    if (this.dismissed && !isNewerRelease(deployed, this.dismissed)) return;
    if (this.state.status === 'available' && !isNewerRelease(deployed, this.state.deployed)) return;
    let reason: UpdateNoticeReason | null = null;
    const attempt = this.readAttempt();
    if (attempt === undefined) reason = 'no-guard';
    else if (attempt !== null && attempt >= deployed.release) reason = 'stale-cache';
    else if (this.deps.isCallActive()) reason = 'call';
    this.setState({ status: 'available', deployed, mode: 'manual', deadline: null, reason });
  }

  /** The person pressed Update Now: the sole path that reloads this tab. */
  refreshNow(): void {
    if (this.state.status !== 'available') return;
    this.recordAttempt();
    this.deps.reload();
  }

  /** Store the loop guard for the offered release; true only if it reads back. */
  private recordAttempt(): boolean {
    if (this.state.status !== 'available' || !this.deps.storage) return false;
    const value = String(this.state.deployed.release);
    try {
      this.deps.storage.setItem(RELOAD_ATTEMPT_KEY, value);
      return this.deps.storage.getItem(RELOAD_ATTEMPT_KEY) === value;
    } catch {
      return false;
    }
  }

  /** "Not now": hide the notice for this release in this tab. */
  dismiss(): void {
    if (this.state.status !== 'available') return;
    if (isNewerRelease(this.state.deployed, this.dismissed)) this.dismissed = this.state.deployed;
    this.setState({ status: 'idle' });
  }

  /** null: no attempt recorded. undefined: storage unavailable. */
  private readAttempt(): number | null | undefined {
    const { storage } = this.deps;
    if (!storage) return undefined;
    try {
      const raw = storage.getItem(RELOAD_ATTEMPT_KEY);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : null;
    } catch {
      return undefined;
    }
  }

  /** The refresh worked once this tab runs a release at least as new as its target. */
  private clearSucceededAttempt(): void {
    const attempt = this.readAttempt();
    if (typeof attempt === 'number' && this.deps.local.release >= attempt) {
      try { this.deps.storage?.removeItem(RELOAD_ATTEMPT_KEY); } catch { /* ignore */ }
    }
  }

  private setState(next: AppUpdateState): void {
    this.state = next;
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* ignore */ }
    }
  }
}

function browserStorage(): AppVersionDeps['storage'] {
  try {
    const s = window.sessionStorage;
    const probe = '__swarm_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

async function fetchDeployedRelease(): Promise<unknown> {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  // `cache: 'no-store'` plus a per-request nonce (not a clock) defeats caches.
  const nonce = Math.random().toString(36).slice(2, 10);
  const url = `${base.endsWith('/') ? base : `${base}/`}version.json?n=${nonce}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

let shared: AppVersionWatch | null = null;

export function getAppVersionWatch(): AppVersionWatch {
  if (!shared) {
    shared = new AppVersionWatch({
      local: LOCAL_RELEASE,
      fetchDeployed: fetchDeployedRelease,
      reload: () => window.location.reload(),
      isCallActive,
      storage: typeof window === 'undefined' ? null : browserStorage(),
    });
  }
  return shared;
}
