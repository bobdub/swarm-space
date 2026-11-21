/**
 * App build handoff over the mesh.
 *
 * There is no service worker, so a tab keeps running the build it loaded
 * until it is refreshed. Chain rule changes need every peer on the new
 * build, so peers swap build stamps when a data channel opens. A peer
 * that hears of a newer build asks its OWN host (`version.json`, written
 * at build time) what is deployed, and only a deployed build newer than
 * its own leads to a refresh notice:
 *
 * - A fake or foreign stamp from a peer can never force a refresh; at most
 *   it triggers one `version.json` read a day.
 * - A peer on a newer build that this host has not deployed yet (another
 *   host, a preview, a dev server) changes nothing, so a refresh can never
 *   land on the same old build and loop.
 * - Auto-refresh happens once per target build per tab. If a stale cache
 *   brings back the old build, the notice stays manual from then on.
 * - A live call is never cut off: the notice waits for the person.
 */

import { isCallActive } from './callActivity';

export interface BuildStamp {
  /** Short commit hash (or a fallback id); for display only. */
  id: string;
  /** Build time in ms since epoch; this is what orders builds. */
  builtAt: number;
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

/** Seconds of notice before an automatic refresh. */
export const UPDATE_COUNTDOWN_MS = 30_000;
/**
 * At most one `version.json` read per device per day, whatever peers claim.
 * The time of the last read survives reloads (localStorage).
 */
export const VERSION_CHECK_MIN_GAP_MS = 24 * 60 * 60_000;
/** Stamps further than this into the future are refused as spoofed. */
export const MAX_FUTURE_SKEW_MS = 10 * 60_000;

const RELOAD_ATTEMPT_KEY = 'swarm-app-reload-attempt';
const LAST_CHECK_KEY = 'swarm-app-version-last-check';
const MAX_ID_LENGTH = 64;

export function parseBuildStamp(raw: unknown, nowMs: number): BuildStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, builtAt } = raw as { id?: unknown; builtAt?: unknown };
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  if (typeof builtAt !== 'number' || !Number.isSafeInteger(builtAt) || builtAt <= 0) return null;
  if (builtAt > nowMs + MAX_FUTURE_SKEW_MS) return null;
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
      mode: 'auto' | 'manual';
      /** ms timestamp of the automatic refresh, when mode is auto. */
      deadline: number | null;
      reason: UpdateNoticeReason | null;
    };

export interface AppVersionDeps {
  local: BuildStamp;
  now: () => number;
  fetchDeployed: () => Promise<unknown>;
  reload: () => void;
  isCallActive: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Device-wide store for the last host check time (localStorage). */
  persist?: Pick<Storage, 'getItem' | 'setItem'> | null;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

type Listener = (state: AppUpdateState) => void;

export class AppVersionWatch {
  private state: AppUpdateState = { status: 'idle' };
  private listeners = new Set<Listener>();
  private checking = false;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  /** A claim that arrived while throttled waits for the next allowed check. */
  private pendingTimer: unknown = null;
  /** Builds the person said "Not now" to in this tab. */
  private dismissedUpTo = 0;
  private timer: unknown = null;

  constructor(private readonly deps: AppVersionDeps) {
    try {
      const saved = Number(deps.persist?.getItem(LAST_CHECK_KEY));
      // A saved time in the future (clock change) is ignored.
      if (Number.isFinite(saved) && saved > 0 && saved <= deps.now()) this.lastCheckAt = saved;
    } catch { /* no device storage: per-tab throttle only */ }
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
    if (!claim || claim.builtAt <= local.builtAt) return false;
    if (this.state.status === 'available' && claim.builtAt <= this.state.deployed.builtAt) return false;
    const wait = this.lastCheckAt + VERSION_CHECK_MIN_GAP_MS - t;
    if (this.checking || wait > 0) {
      // Throttled: one host read per gap, however many peers (or fakes) speak.
      if (this.pendingTimer === null) {
        this.pendingTimer = this.deps.setTimer(() => {
          this.pendingTimer = null;
          void this.checkHost();
        }, Math.max(wait, 1_000));
      }
      return false;
    }
    void this.checkHost();
    return true;
  }

  private async checkHost(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.lastCheckAt = this.deps.now();
    try { this.deps.persist?.setItem(LAST_CHECK_KEY, String(this.lastCheckAt)); } catch { /* ignore */ }
    let deployed: BuildStamp | null = null;
    try {
      deployed = parseBuildStamp(await this.deps.fetchDeployed(), this.deps.now());
    } catch {
      deployed = null;
    } finally {
      this.checking = false;
    }
    // Nothing newer on this host (a peer on another host, a preview, a
    // build still rolling out, or a made-up stamp): stay put.
    if (!deployed || deployed.builtAt <= this.deps.local.builtAt) return;
    if (deployed.builtAt <= this.dismissedUpTo) return;
    if (this.state.status === 'available' && deployed.builtAt <= this.state.deployed.builtAt) return;
    this.offer(deployed);
  }

  private offer(deployed: BuildStamp): void {
    this.cancelTimer();
    let reason: UpdateNoticeReason | null = null;
    const attempt = this.readAttempt();
    if (attempt === undefined) reason = 'no-guard';
    else if (attempt !== null && attempt >= deployed.builtAt) reason = 'stale-cache';
    else if (this.deps.isCallActive()) reason = 'call';

    if (reason) {
      this.setState({ status: 'available', deployed, mode: 'manual', deadline: null, reason });
      return;
    }
    const deadline = this.deps.now() + UPDATE_COUNTDOWN_MS;
    this.setState({ status: 'available', deployed, mode: 'auto', deadline, reason: null });
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.state.status !== 'available' || this.state.mode !== 'auto') return;
      if (this.deps.isCallActive()) {
        this.setState({ ...this.state, mode: 'manual', deadline: null, reason: 'call' });
        return;
      }
      // Auto-refresh only once the loop guard is really stored; a guard that
      // cannot be written could let a stale cache reload this tab again.
      if (!this.recordAttempt()) {
        this.setState({ ...this.state, mode: 'manual', deadline: null, reason: 'no-guard' });
        return;
      }
      this.deps.reload();
    }, UPDATE_COUNTDOWN_MS);
  }

  /** The person pressed Refresh now: reload even if the guard cannot be stored. */
  refreshNow(): void {
    if (this.state.status !== 'available') return;
    this.cancelTimer();
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
    this.cancelTimer();
    this.dismissedUpTo = Math.max(this.dismissedUpTo, this.state.deployed.builtAt);
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

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
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

function deviceStorage(): AppVersionDeps['persist'] {
  try { return window.localStorage; } catch { return null; }
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
      persist: typeof window === 'undefined' ? null : deviceStorage(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }
  return shared;
}
