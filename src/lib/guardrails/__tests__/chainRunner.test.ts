import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let score = 0.1;
const started: string[] = [];

vi.mock('../browserHealth', () => ({
  getBrowserQScore: () => score,
  startBrowserHealth: () => {},
}));
vi.mock('../deviceProfile', () => ({ recordChainSample: () => {} }));
vi.mock('../config', () => ({
  getLoadingChainConfig: () => ({ order: ['local', 'brain-game', 'mesh'], adaptive: true }),
}));
vi.mock('../loadingChain', () => {
  const points = new Map<string, { id: string; label: string; essential: boolean; minQScore: number; start: () => Promise<void> }>();
  const add = (id: string, essential: boolean, minQScore: number) =>
    points.set(id, { id, label: id, essential, minQScore, start: async () => { started.push(id); } });
  return {
    registerDefaultPoints: () => {
      add('local', true, 0);
      add('brain-game', false, 0.3);
      add('mesh', true, 0.2);
    },
    getLoadingPoint: (id: string) => points.get(id),
    listLoadingPoints: () => Array.from(points.values()),
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  started.length = 0;
  score = 0.1;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loading chain', () => {
  it('starts the mesh even while a heavier point waits for a better score', async () => {
    const { startChain } = await import('../chainRunner');
    void startChain();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started).toEqual(['local', 'mesh']);

    // Score recovers and then stays put: no level-change events arrive.
    score = 0.5;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(started).toEqual(['local', 'mesh', 'brain-game']);
  });
});
