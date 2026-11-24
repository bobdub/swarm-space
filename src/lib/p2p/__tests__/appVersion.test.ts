import { describe, expect, it, vi } from 'vitest';
import {
  AppVersionWatch,
  MAX_FUTURE_SKEW_MS,
  parseBuildStamp,
  type AppVersionDeps,
  type BuildStamp,
} from '../appVersion';

const DAY = 24 * 3_600_000;
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
  };
  const advance = async (ms: number) => {
    clock += ms;
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
    await h.advance(7 * DAY);
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

  it('asks the host once per version however many peers claim it', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    expect(w.notePeerBuild(NEW)).toBe(true);
    await h.advance(0);
    for (let i = 0; i < 20; i++) w.notePeerBuild(NEW);
    await h.advance(DAY);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
  });

  it('a newer version claimed while a read is in flight gets its own read after it', async () => {
    const h = harness({ deployed: OLD });
    const w = h.watch();
    const NEWER = { id: 'ccc333', builtAt: NEW.builtAt + 30_000 };
    w.notePeerBuild(NEW);
    expect(w.notePeerBuild(NEWER)).toBe(false);
    h.deployed.value = NEWER;
    await h.advance(0);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
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
    await h.advance(DAY);
    expect(w.getState().status).toBe('idle');

    const NEWER = { id: 'ccc333', builtAt: NEW.builtAt + 1_000 };
    h.deployed.value = NEWER;
    w.notePeerBuild(NEWER);
    await h.advance(0);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });

  it('does nothing when its own build is unknown', async () => {
    const h = harness({ local: { id: 'unknown', builtAt: 0 } });
    const w = h.watch();
    expect(w.notePeerBuild(NEW)).toBe(false);
    await h.advance(30_000 * 2);
    expect(h.deps.fetchDeployed).not.toHaveBeenCalled();
  });

  it('a new release is checked on reconnect right after an earlier release was checked', async () => {
    const h = harness({ deployed: NEW });
    const w = h.watch();
    w.notePeerBuild(NEW);
    await h.advance(0);
    w.dismiss();
    // Minutes later another release ships; a refreshed peer reconnects.
    await h.advance(5 * 60_000);
    const NEWER: BuildStamp = { id: 'ccc333', builtAt: T0 + 60_000, release: 13 };
    h.deployed.value = NEWER;
    expect(w.notePeerBuild(NEWER)).toBe(true);
    await h.advance(0);
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: NEWER });
  });
});
