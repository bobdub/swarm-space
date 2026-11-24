/**
 * App build handoff over the mesh.
 *
 * There is no service worker, so a tab keeps running the build it loaded
 * until it is refreshed. Chain rule changes need every peer on the new
 * build, so peers swap build stamps when a data channel opens. A stamp
 * carries the release number (one peer says 0.010, the other 0.012); stamps
 * from before the counter fall back to build time. A peer that hears of a
 * newer version asks its OWN host (`version.json`, written
 * at build time) what is deployed, and only a deployed build newer than
 * its own leads to a refresh notice:
 *
 * - Each version is checked once per tab: the first claim newer than any
 *   already checked triggers one `version.json` read, and repeats of that
 *   version (reconnects, other peers) are ignored. There are no timers.
 * - A fake or foreign stamp from a peer can never force a refresh.
 * - A peer on a newer build that this host has not deployed yet (another
 *   host, a preview, a dev server) changes nothing, so a refresh can never
 *   land on the same old build and loop.
 * - Every update waits for an explicit choice; there is no auto-refresh.
 * - A live call and the current world remain intact until that choice.
 */

import { isCallActive } from './callActivity';

export interface BuildStamp {
  /** Short commit hash (or a fallback id); for display only. */
  id: string;
  /** Build time in ms since epoch; this is what orders builds. */
  builtAt: number;
  /** Release counter (v0.012 = 12), bumped on every merge to main. */
  release?: number;
}

/**
 * True when `a` is a later version than `b`. Peers compare release numbers
 * (0.010 vs 0.012); a stamp without one (builds from before the counter)
 * falls back to build time.
 */
export function isNewerBuild(a: BuildStamp, b: BuildStamp | null): boolean {
  if (!b) return true;
  if (a.release && b.release) return a.release > b.release;
  return a.builtAt > b.builtAt;
}

declare const __APP_BUILD__: BuildStamp | undefined;

/** The build this tab is running. builtAt 0 means unknown (tests). */
export const LOCAL_BUILD: BuildStamp = (() => {
  try {
    if (typeof __APP_BUILD__ !== 'undefined' && __APP_BUILD__) {
      const parsed = parseBuildStamp(__APP_BUILD__, Number.POSITIVE_INFINITY);
      if (parsed) return parsed;
    }
  } catch { /* not defined */ }
  return { id: 'unknown', builtAt: 0 };
})();

/** Stamps further than this into the future are refused as spoofed. */
export const MAX_FUTURE_SKEW_MS = 10 * 60_000;

const RELOAD_ATTEMPT_KEY = 'swarm-app-reload-attempt';
const MAX_ID_LENGTH = 64;
const MAX_RELEASE = 10_000_000;

export function parseBuildStamp(raw: unknown, nowMs: number): BuildStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, builtAt } = raw as { id?: unknown; builtAt?: unknown };
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  if (typeof builtAt !== 'number' || !Number.isSafeInteger(builtAt) || builtAt <= 0) return null;
  if (builtAt > nowMs + MAX_FUTURE_SKEW_MS) return null;
  const { release } = raw as { release?: unknown };
  if (typeof release === 'number' && Number.isSafeInteger(release) && release > 0 && release <= MAX_RELEASE) {
    return { id, builtAt, release };
  }
  return { id, builtAt };
}

export type UpdateNoticeReason =
  /** A refresh for this build already ran and the old build came back. */
  | 'stale-cache'
  /** A call is live, so the refresh waits for the person. */
  | 'call'
  /** Tab storage is unavailable, so a refresh loop cannot be ruled out. */
  | 'no-guard';

export type AppUpdateState =
  | { status: 'idle' }
  | {
      status: 'available';
      deployed: BuildStamp;
      mode: 'manual';
      deadline: null;
      reason: UpdateNoticeReason | null;
    };

export interface AppVersionDeps {
  local: BuildStamp;
  now: () => number;
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
  /** Newest version a host read has already answered. */
  private checked: BuildStamp | null = null;
  /** Newest version claimed so far; the next host read answers it. */
  private newestClaim: BuildStamp | null = null;
  /** Builds the person said "Not now" to in this tab. */
  private dismissed: BuildStamp | null = null;

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
  getLocalBuild(): BuildStamp {
    return this.deps.local;
  }

  /**
   * A peer told us its build. Returns true when it led to a host check.
   * The claim is only a hint; the host's `version.json` decides.
   */
  notePeerBuild(raw: unknown): boolean {
    const { local, now } = this.deps;
    if (local.builtAt <= 0) return false;
    const t = now();
    const claim = parseBuildStamp(raw, t);
    if (!claim || !isNewerBuild(claim, local)) return false;
    if (this.state.status === 'available' && !isNewerBuild(claim, this.state.deployed)) return false;
    // Once per version: a version already checked is never read again.
    if (!isNewerBuild(claim, this.newestClaim)) return false;
    this.newestClaim = claim;
    // A read in flight answers an older claim; this one follows it.
    if (this.checking) return false;
    void this.checkHost();
    return true;
  }

  private async checkHost(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.checked = this.newestClaim;
    let deployed: BuildStamp | null = null;
    try {
      deployed = parseBuildStamp(await this.deps.fetchDeployed(), this.deps.now());
    } catch {
      deployed = null;
    } finally {
      this.checking = false;
    }
    // A newer version was claimed while this read was in flight.
    if (this.newestClaim && this.newestClaim !== this.checked) void this.checkHost();
    // Nothing newer on this host (a peer on another host, a preview, a
    // build still rolling out, or a made-up stamp): stay put.
    // The host confirms: only a deployed version truly ahead of ours counts.
    if (!deployed || !isNewerBuild(deployed, this.deps.local)) return;
    if (this.dismissed && !isNewerBuild(deployed, this.dismissed)) return;
    if (this.state.status === 'available' && !isNewerBuild(deployed, this.state.deployed)) return;
    this.offer(deployed);
  }

  private offer(deployed: BuildStamp): void {
    let reason: UpdateNoticeReason | null = null;
    const attempt = this.readAttempt();
    if (attempt === undefined) reason = 'no-guard';
    else if (attempt !== null && attempt >= deployed.builtAt) reason = 'stale-cache';
    else if (this.deps.isCallActive()) reason = 'call';

    this.setState({ status: 'available', deployed, mode: 'manual', deadline: null, reason });
  }

  /** The person pressed Update App: the sole path that reloads this tab. */
  refreshNow(): void {
    if (this.state.status !== 'available') return;
    this.recordAttempt();
    this.deps.reload();
  }

  /** Store the loop guard for the offered build; true only if it reads back. */
  private recordAttempt(): boolean {
    if (this.state.status !== 'available' || !this.deps.storage) return false;
    const value = String(this.state.deployed.builtAt);
    try {
      this.deps.storage.setItem(RELOAD_ATTEMPT_KEY, value);
      return this.deps.storage.getItem(RELOAD_ATTEMPT_KEY) === value;
    } catch {
      return false;
    }
  }

  /** "Not now": hide the notice for this build in this tab. */
  dismiss(): void {
    if (this.state.status !== 'available') return;
    if (isNewerBuild(this.state.deployed, this.dismissed)) this.dismissed = this.state.deployed;
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
      return Number.isFinite(n) ? n : null;
    } catch {
      return undefined;
    }
  }

  /** The refresh worked once this tab runs a build at least as new as its target. */
  private clearSucceededAttempt(): void {
    const attempt = this.readAttempt();
    if (typeof attempt === 'number' && this.deps.local.builtAt >= attempt) {
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

async function fetchDeployedBuild(): Promise<unknown> {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  const url = `${base.endsWith('/') ? base : `${base}/`}version.json?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

let shared: AppVersionWatch | null = null;

export function getAppVersionWatch(): AppVersionWatch {
  if (!shared) {
    shared = new AppVersionWatch({
      local: LOCAL_BUILD,
      now: () => Date.now(),
      fetchDeployed: fetchDeployedBuild,
      reload: () => window.location.reload(),
      isCallActive,
      storage: typeof window === 'undefined' ? null : browserStorage(),
    });
  }
  return shared;
}
