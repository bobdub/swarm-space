import { describe, expect, it, vi } from 'vitest';
import {
  AppVersionWatch,
  appReleasePacket,
  isNewerRelease,
  parseReleaseStamp,
  type AppVersionDeps,
  type ReleaseStamp,
} from '../appVersion';

const V12: ReleaseStamp = { release: 12, id: 'aaa111' };
const V14: ReleaseStamp = { release: 14, id: 'a4f89c0' };
const ATTEMPT_KEY = 'swarm-app-release-reload-attempt';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

function harness(opts: { local?: ReleaseStamp; deployed?: unknown; call?: boolean; storage?: ReturnType<typeof memoryStorage> | null } = {}) {
  const call = { active: opts.call ?? false };
  const deployed = { value: 'deployed' in opts ? opts.deployed : V14, fail: false };
  const storage = opts.storage === undefined ? memoryStorage() : opts.storage;
  const deps: AppVersionDeps = {
    local: opts.local ?? V12,
    fetchDeployed: vi.fn(async () => {
      if (deployed.fail) throw new Error('offline');
      return deployed.value;
    }),
    reload: vi.fn(),
    isCallActive: () => call.active,
    storage,
  };
  return { deps, call, deployed, storage, watch: () => new AppVersionWatch(deps) };
}
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('release stamps', () => {
  it('accepts only a sane release counter and a short id', () => {
    expect(parseReleaseStamp(V14)).toEqual(V14);
    expect(parseReleaseStamp({ release: 14 })).toEqual({ release: 14, id: '' });
    expect(parseReleaseStamp({ release: 0, id: 'x' })).toBeNull();
    expect(parseReleaseStamp({ release: -1, id: 'x' })).toBeNull();
    expect(parseReleaseStamp({ release: 1.5, id: 'x' })).toBeNull();
    expect(parseReleaseStamp({ release: '14', id: 'x' })).toBeNull();
    expect(parseReleaseStamp({ release: 10_000_001, id: 'x' })).toBeNull();
    expect(parseReleaseStamp({ release: 14, id: 'x'.repeat(65) })).toBeNull();
    expect(parseReleaseStamp({ release: 14, id: 7 })).toBeNull();
    expect(parseReleaseStamp(null)).toBeNull();
    expect(parseReleaseStamp('<!doctype html>')).toBeNull();
  });

  it('puts no timestamp on the wire', () => {
    const packet = appReleasePacket(V14);
    expect(packet).toEqual({ type: 'app-release', release: 14, id: 'a4f89c0' });
    expect(Object.keys(packet).sort()).toEqual(['id', 'release', 'type']);
  });

  it('orders strictly by the release counter', () => {
    expect(isNewerRelease(V14, V12)).toBe(true);
    expect(isNewerRelease(V12, V14)).toBe(false);
    expect(isNewerRelease(V14, { release: 14, id: 'other' })).toBe(false);
    expect(isNewerRelease(V12, null)).toBe(true);
  });
});

describe('Infinity verification loop', () => {
  it('release 12 learns of 14, the host confirms, the notice shows', async () => {
    const h = harness();
    const w = h.watch();
    expect(w.notePeerRelease(appReleasePacket(V14))).toBe(true);
    await flush();
    expect(w.getState()).toMatchObject({ status: 'available', mode: 'manual', deadline: null, deployed: V14 });
    expect(h.deps.reload).not.toHaveBeenCalled();
  });

  it('ignores peers on the same or an older release without asking the host', async () => {
    const h = harness({ local: V14 });
    const w = h.watch();
    expect(w.notePeerRelease(V14)).toBe(false);
    expect(w.notePeerRelease(V12)).toBe(false);
    await flush();
    expect(h.deps.fetchDeployed).not.toHaveBeenCalled();
  });

  it('drops a spoofed release silently when the host does not back it', async () => {
    const h = harness({ deployed: V12 });
    const w = h.watch();
    const states: unknown[] = [];
    w.subscribe(s => states.push(s));
    expect(w.notePeerRelease({ type: 'app-release', release: 99999, id: 'evil' })).toBe(true);
    await flush();
    expect(states).toEqual([]);
    expect(w.getState()).toEqual({ status: 'idle' });
    // The same spoof again never costs another read.
    expect(w.notePeerRelease({ release: 99999, id: 'evil' })).toBe(false);
    await flush();
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
  });

  it('a claim above what the host serves is refused even when the host is ahead of us', async () => {
    const h = harness({ deployed: V14 });
    const w = h.watch();
    w.notePeerRelease({ release: 99999, id: 'evil' });
    await flush();
    expect(w.getState().status).toBe('idle');
    // A genuine peer on 14 is then confirmed by that same read, no new request.
    expect(w.notePeerRelease(V14)).toBe(false);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: V14 });
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
  });

  it('the host confirms the claim when it already serves a newer release', async () => {
    const h = harness({ deployed: { release: 15, id: 'b' } });
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState()).toMatchObject({ status: 'available', deployed: { release: 15 } });
  });

  it('asks the host once per release however many peers claim it', async () => {
    const h = harness({ deployed: V12 });
    const w = h.watch();
    expect(w.notePeerRelease(V14)).toBe(true);
    for (let i = 0; i < 20; i++) w.notePeerRelease(V14);
    await flush();
    for (let i = 0; i < 20; i++) w.notePeerRelease(V14);
    await flush();
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(1);
  });

  it('claims made during a read are answered together by one follow-up read', async () => {
    const h = harness({ deployed: V12 });
    const w = h.watch();
    w.notePeerRelease(V14);
    expect(w.notePeerRelease({ release: 15, id: 'c' })).toBe(false);
    expect(w.notePeerRelease({ release: 16, id: 'd' })).toBe(false);
    h.deployed.value = { release: 16, id: 'd' };
    await flush();
    await flush();
    expect(h.deps.fetchDeployed).toHaveBeenCalledTimes(2);
    expect(w.getState()).toMatchObject({ status: 'available', deployed: { release: 16 } });
  });

  it('a host without version.json (dev server, error page) changes nothing', async () => {
    const h = harness({ deployed: '<!doctype html>' });
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState().status).toBe('idle');
  });

  it('an unreachable host does not block a later retry of the same release', async () => {
    const h = harness();
    h.deployed.fail = true;
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState().status).toBe('idle');
    h.deployed.fail = false;
    expect(w.notePeerRelease(V14)).toBe(true);
    await flush();
    expect(w.getState()).toMatchObject({ status: 'available', deployed: V14 });
  });

  it('does nothing when its own release is unknown', async () => {
    const h = harness({ local: { release: 0, id: 'unknown' } });
    const w = h.watch();
    expect(w.notePeerRelease(V14)).toBe(false);
    await flush();
    expect(h.deps.fetchDeployed).not.toHaveBeenCalled();
  });
});

describe('the person chooses when to update', () => {
  it('holds the current version until Update Now is chosen', async () => {
    const h = harness();
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(h.deps.reload).not.toHaveBeenCalled();
    w.refreshNow();
    expect(h.deps.reload).toHaveBeenCalledTimes(1);
    expect(h.storage?.map.get(ATTEMPT_KEY)).toBe('14');
  });

  it('never loops: the old build coming back after a refresh stays manual', async () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    const w1 = first.watch();
    w1.notePeerRelease(V14);
    await flush();
    w1.refreshNow();

    const second = harness({ storage });
    const w2 = second.watch();
    w2.notePeerRelease(V14);
    await flush();
    expect(w2.getState()).toMatchObject({ status: 'available', reason: 'stale-cache' });
    expect(second.deps.reload).not.toHaveBeenCalled();
  });

  it('clears the attempt once the tab runs the target release', () => {
    const storage = memoryStorage();
    storage.setItem(ATTEMPT_KEY, '14');
    harness({ storage, local: V14 }).watch();
    expect(storage.map.has(ATTEMPT_KEY)).toBe(false);
  });

  it('without tab storage the notice says a loop cannot be ruled out', async () => {
    const h = harness({ storage: null });
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState()).toMatchObject({ reason: 'no-guard' });
  });

  it('never interrupts a live call', async () => {
    const h = harness({ call: true });
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState()).toMatchObject({ mode: 'manual', reason: 'call' });
    expect(h.deps.reload).not.toHaveBeenCalled();
  });

  it('"Not now" hides that release for the tab, but a newer one shows again', async () => {
    const h = harness();
    const w = h.watch();
    w.notePeerRelease(V14);
    await flush();
    w.dismiss();
    w.notePeerRelease(V14);
    await flush();
    expect(w.getState().status).toBe('idle');

    const V15 = { release: 15, id: 'c' };
    h.deployed.value = V15;
    expect(w.notePeerRelease(V15)).toBe(true);
    await flush();
    expect(w.getState()).toMatchObject({ status: 'available', deployed: V15 });
  });
});
