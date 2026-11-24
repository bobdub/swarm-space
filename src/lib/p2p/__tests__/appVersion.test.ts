import { describe, expect, it, vi } from 'vitest';
import {
  AppVersionWatch,
  VERSION_CHECK_MIN_GAP_MS,
  FRESH_CLAIM_MIN_GAP_MS,
  MAX_FUTURE_SKEW_MS,
  parseBuildStamp,
  type AppVersionDeps,
  type BuildStamp,
} from '../appVersion';

const T0 = new Date('2026-11-21T20:00:00Z').getTime();
const OLD: BuildStamp = { id: 'aaa111', builtAt: T0 - 3_600_000 };
const NEW: BuildStamp = { id: 'bbb222', builtAt: T0 - 60_000 };

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

function harness(opts: { local?: BuildStamp; deployed?: unknown; call?: boolean; storage?: ReturnType<typeof memoryStorage> | null } = {}) {
  let clock = T0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const call = { active: opts.call ?? false };
  const deployed = { value: 'deployed' in opts ? opts.deployed : NEW };
  const storage = opts.storage === undefined ? memoryStorage() : opts.storage;
  const deps: AppVersionDeps = {
    local: opts.local ?? OLD,
    now: () => clock,
    fetchDeployed: vi.fn(async () => deployed.value),
    reload: vi.fn(),
    isCallActive: () => call.active,
    storage,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ at: clock + ms, fn, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1); },
  };
  const advance = async (ms: number) => {
    clock += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (!due || due.at > clock) break;
      timers.shift();
      due.fn();
      await flush();
    }
    await flush();
  };
  return { deps, call, deployed, storage, advance, watch: () => new AppVersionWatch(deps) };
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('build stamp parsing', () => {
  it('refuses malformed, oversized and far-future stamps', () => {
    expect(parseBuildStamp(NEW, T0)).toEqual(NEW);
    expect(parseBuildStamp({ id: '', builtAt: 5 }, T0)).toBeNull();
    expect(parseBuildStamp({ id: 'x'.repeat(65), builtAt: 5 }, T0)).toBeNull();
    expect(parseBuildStamp({ id: 'x', builtAt: '5' }, T0)).toBeNull();
    expect(parseBuildStamp({ id: 'x', builtAt: 1.5 }, T0)).toBeNull();
    expect(parseBuildStamp({ id: 'x', builtAt: T0 + MAX_FUTURE_SKEW_MS + 1 }, T0)).toBeNull();
    expect(parseBuildStamp(null, T0)).toBeNull();
  });

  it('keeps a sane release number for display and drops a bad one', () => {
    expect(parseBuildStamp({ ...NEW, release: 13 }, T0)).toEqual({ ...NEW, release: 13 });
    expect(parseBuildStamp({ ...NEW, release: -1 }, T0)).toEqual(NEW);
    expect(parseBuildStamp({ ...NEW, release: 1.5 }, T0)).toEqual(NEW);
    expect(parseBuildStamp({ ...NEW, release: '13' }, T0)).toEqual(NEW);
  });
});

describe('app version handoff', () => {
  it('ignores peers on the same or an older build without asking the host', async () => {
    const h = harness();
    const w = h.watch();
    expect(w.notePeerBuild(OLD)).toBe(false);
    expect(w.notePeerBuild({ id: 'older', builtAt: OLD.builtAt - 1 })).toBe(false);
    await h.advance(0);
    expect(h.deps.fetchDeployed).not.toHaveBeenCalled();
    expect(w.getState().status).toBe('idle');
  });

  it('holds the current version indefinitely until Update App is explicitly chosen', async () => {
    const h = harness();
    const w = h.watch();
    expect(w.notePeerBuild(NEW)).toBe(true);
    await h.advance(0);
    expect(w.getState()).toMatchObject({ status: 'available', mode: 'manual', deadline: null, deployed: NEW });
    await h.advance(7 * VERSION_CHECK_MIN_GAP_MS);
    expect(h.deps.reload).not.toHaveBeenCalled();
    w.refreshNow();
    expect(h.deps.reload).toHaveBeenCalledTimes(1);
    expect(h.storage?.map.get('swarm-app-reload-attempt')).toBe(String(NEW.builtAt));
  });

  it('a fake higher stamp cannot force a refresh when the host has nothing newer', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    w.notePeerBuild({ id: 'fake', builtAt: T0 + 60_000 });
    await h.advance(30_000 * 2);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    expect(h.deps.reload).not.toHaveBeenCalled();
    expect(w.getState().status).toBe('idle');
  });

  it('a host without version.json (dev server, error page) changes nothing', async () => {
    const h = harness({ deployed: '<!doctype html>' });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(30_000 * 2);
    expect(w.getState().status).toBe('idle');
    expect(h.deps.reload).not.toHaveBeenCalled();
  });

  it('throttles host reads to one per gap however many peers claim, then checks the waiting claim', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(0);
    for (let i = 0; i < 20; i++) w.notePeerBuild({ id: `p${i}`, builtAt: NEW.builtAt + i });
    await h.advance(1_000);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    // The real build lands on the host; the waiting claim gets its check after the gap.
    h.deployed.value = NEW;
    await h.advance(VERSION_CHECK_MIN_GAP_MS);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', mode: 'manual' });
  });

  it('checks the host at most once a day per device, across reloads', async () => {
    const persist = memoryStorage();
    const first = harness({ deployed: OLD });
    first.deps.persist = persist;
    first.watch().notePeerBuild(NEW);
    await first.advance(0);
    expect(first.deps.fetchDeployed).toHaveBeenCalledTimes(1);

    // A reload an hour later still respects the day; the claim waits for it.
    const second = harness();
    second.deps.persist = persist;
    await second.advance(3_600_000);
    const w = second.watch();
    expect(w.notePeerBuild(NEW)).toBe(false);
    await second.advance(VERSION_CHECK_MIN_GAP_MS - 3_600_000 - 1);
    expect(second.deps.fetchDeployed).not.toHaveBeenCalled();
    await second.advance(1_000);
    expect(second.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    expect(w.getState()).toMatchObject({ status: 'available', mode: 'manual' });
  });

  it('never loops: after one refresh for a build, the old build coming back stays manual', async () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    const w1 = first.watch();
    w1.notePeerBuild(NEW);
    await first.advance(0);
    w1.refreshNow();
    expect(first.deps.reload).toHaveBeenCalledTimes(1);

    // Stale cache: the reloaded tab still runs OLD.
    const second = harness({ storage });
    const w2 = second.watch();
    w2.notePeerBuild(NEW);
    await second.advance(30_000 * 3);
    expect(w2.getState()).toMatchObject({ status: 'available', mode: 'manual', reason: 'stale-cache', deadline: null });
    expect(second.deps.reload).not.toHaveBeenCalled();
  });

  it('clears the attempt once the tab runs the target build', () => {
    const storage = memoryStorage();
    storage.setItem('swarm-app-reload-attempt', String(NEW.builtAt));
    harness({ storage, local: NEW }).watch();
    expect(storage.map.has('swarm-app-reload-attempt')).toBe(false);
  });

  it('without tab storage the notice is manual, since a loop cannot be ruled out', async () => {
    const h = harness({ storage: null });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(30_000 * 2);
    expect(w.getState()).toMatchObject({ mode: 'manual', reason: 'no-guard' });
    expect(h.deps.reload).not.toHaveBeenCalled();
  });

  it('holds without auto-refresh even when tab storage later fails', async () => {
    const storage = memoryStorage();
    const h = harness({ storage });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(0);
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    await h.advance(30_000);
    expect(h.deps.reload).not.toHaveBeenCalled();
    expect(w.getState()).toMatchObject({ mode: 'manual', deadline: null });
    w.refreshNow();
    expect(h.deps.reload).toHaveBeenCalledTimes(1);
  });

  it('never interrupts a live call, including one that starts after the notice', async () => {
    const h = harness({ call: true });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(30_000 * 2);
    expect(w.getState()).toMatchObject({ mode: 'manual', reason: 'call' });
    expect(h.deps.reload).not.toHaveBeenCalled();

    const h2 = harness();
    const w2 = h2.watch();
    w2.notePeerBuild(NEW);
    await h2.advance(1_000);
    h2.call.active = true;
    await h2.advance(30_000);
    expect(w2.getState()).toMatchObject({ mode: 'manual', deadline: null });
    expect(h2.deps.reload).not.toHaveBeenCalled();
    w2.refreshNow();
    expect(h2.deps.reload).toHaveBeenCalledTimes(1);
  });

  it('"Not now" hides the invitation and hides that build for the tab, but a newer one shows again', async () => {
    const h = harness();
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(1_000);
    w.dismiss();
    await h.advance(30_000 * 2);
    expect(h.deps.reload).not.toHaveBeenCalled();
    expect(w.getState().status).toBe('idle');

    w.notePeerBuild(NEW);
    await h.advance(VERSION_CHECK_MIN_GAP_MS);
    expect(w.getState().status).toBe('idle');

    const NEWER = { id: 'ccc333', builtAt: NEW.builtAt + 1_000 };
    h.deployed.value = NEWER;
    w.notePeerBuild(NEWER);
    await h.advance(VERSION_CHECK_MIN_GAP_MS);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });

  it('does nothing when its own build is unknown', async () => {
    const h = harness({ local: { id: 'unknown', builtAt: 0 } });
    const w = h.watch();
    expect(w.notePeerBuild(NEW)).toBe(false);
    await h.advance(30_000 * 2);
    expect(h.deps.fetchDeployed).not.toHaveBeenCalled();
  });

  it('a release newer than today\'s earlier check is checked on reconnect, not a day later', async () => {
    // Earlier today a peer announced NEW; this tab checked and saw it.
    const persist = memoryStorage();
    const morning = harness({ deployed: NEW });
    morning.deps.persist = persist;
    const w0 = morning.watch();
    w0.notePeerBuild(NEW);
    await morning.advance(0);
    expect(morning.deps.fetchDeployed).toHaveBeenCalledTimes(1);

    // Two hours later another release ships; a refreshed peer reconnects.
    const NEWER: BuildStamp = { id: 'ccc333', builtAt: T0 + 60_000, release: 13 };
    const evening = harness({ deployed: NEWER, local: NEW });
    evening.deps.persist = persist;
    await evening.advance(2 * 3_600_000);
    const w = evening.watch();
    expect(w.notePeerBuild(NEWER)).toBe(true);
    await evening.advance(0);
    expect(evening.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });

  it('a fresh claim right after a check waits about a minute, not a day', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(0);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    // A newer release lands; its peer reconnects 10s later.
    const NEWER = { id: 'ccc333', builtAt: NEW.builtAt + 30_000 };
    h.deployed.value = NEWER;
    expect(w.notePeerBuild(NEWER)).toBe(false);
    await h.advance(FRESH_CLAIM_MIN_GAP_MS);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });

  it('a waiting daily recheck is pulled forward when a fresher claim arrives', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(0);
    w.notePeerBuild(NEW); // same claim: waits a day
    await h.advance(5 * 60_000);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
    const NEWER = { id: 'ccc333', builtAt: NEW.builtAt + 30_000 };
    h.deployed.value = NEWER;
    w.notePeerBuild(NEWER);
    await h.advance(1_000);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });

  it('made-up ever-newer stamps cost at most one host read a minute', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    for (let i = 0; i < 600; i++) {
      w.notePeerBuild({ id: `fake${i}`, builtAt: T0 + i });
      await h.advance(1_000);
    }
    expect((h.deps.fetchDeployed as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(11);
    expect(w.getState().status).toBe('idle');
  });
});
