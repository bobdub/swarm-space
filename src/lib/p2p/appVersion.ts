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
 * - A fake or foreign stamp from a peer can never force a refresh. A claim
 *   newer than any claim already checked earns a fresh `version.json` read
 *   (at most one a minute); a claim already checked is re-read once a day.
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
  /** Human release counter (v0.001 = 1); for display only, never ordering. */
  release?: number;
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

/**
 * A claim no newer than one already checked is re-read at most once a day
 * per device. The time of the last read survives reloads (localStorage).
 */
export const VERSION_CHECK_MIN_GAP_MS = 24 * 60 * 60_000;
/**
 * A claim newer than every claim checked so far (a fresh release) is checked
 * right away, but never more than one read per this gap, so a peer making up
 * ever-newer stamps costs at most one small no-store read a minute.
 */
export const FRESH_CLAIM_MIN_GAP_MS = 60_000;
/** Stamps further than this into the future are refused as spoofed. */
export const MAX_FUTURE_SKEW_MS = 10 * 60_000;

const RELOAD_ATTEMPT_KEY = 'swarm-app-reload-attempt';
const LAST_CHECK_KEY = 'swarm-app-version-last-check';
const LAST_CLAIM_KEY = 'swarm-app-version-last-claim';
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
  /** Newest peer claim (builtAt) that a host read has already answered. */
  private lastClaimChecked = 0;
  /** Newest claim seen; the next host read answers it. */
  private newestClaim = 0;
  /** A claim that arrived while throttled waits for the next allowed check. */
  private pendingTimer: unknown = null;
  private pendingDueAt = Number.POSITIVE_INFINITY;
  /** Builds the person said "Not now" to in this tab. */
  private dismissedUpTo = 0;

  constructor(private readonly deps: AppVersionDeps) {
    try {
      const saved = Number(deps.persist?.getItem(LAST_CHECK_KEY));
      // A saved time in the future (clock change) is ignored.
      if (Number.isFinite(saved) && saved > 0 && saved <= deps.now()) this.lastCheckAt = saved;
      const claim = Number(deps.persist?.getItem(LAST_CLAIM_KEY));
      if (Number.isSafeInteger(claim) && claim > 0) this.lastClaimChecked = claim;
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
    this.newestClaim = Math.max(this.newestClaim, claim.builtAt);
    // A release newer than anything already checked must not wait out the
    // daily gap: a check earlier today (for an older release, or one that
    // found nothing yet) says nothing about this one.
    const fresh = claim.builtAt > this.lastClaimChecked;
    const gap = fresh ? FRESH_CLAIM_MIN_GAP_MS : VERSION_CHECK_MIN_GAP_MS;
    const wait = this.lastCheckAt + gap - t;
    if (this.checking || wait > 0) {
      // Throttled: one host read per gap, however many peers (or fakes) speak.
      this.schedule(t + Math.max(wait, 1_000));
      return false;
    }
    void this.checkHost();
    return true;
  }

  /** Keep one waiting check, moved earlier if a fresher claim allows it. */
  private schedule(dueAt: number): void {
    if (this.pendingTimer !== null) {
      if (dueAt >= this.pendingDueAt) return;
      this.deps.clearTimer(this.pendingTimer);
    }
    this.pendingDueAt = dueAt;
    this.pendingTimer = this.deps.setTimer(() => {
      this.pendingTimer = null;
      this.pendingDueAt = Number.POSITIVE_INFINITY;
      void this.checkHost();
    }, Math.max(dueAt - this.deps.now(), 0));
  }

  private async checkHost(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.lastCheckAt = this.deps.now();
    this.lastClaimChecked = Math.max(this.lastClaimChecked, this.newestClaim);
    try {
      this.deps.persist?.setItem(LAST_CHECK_KEY, String(this.lastCheckAt));
      this.deps.persist?.setItem(LAST_CLAIM_KEY, String(this.lastClaimChecked));
    } catch { /* ignore */ }
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
