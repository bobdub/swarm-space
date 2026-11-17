import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePressAndHold } from '../usePressAndHold';

function pointer(type = 'touch') {
  return {
    stopPropagation: () => {},
    preventDefault: () => {},
    pointerType: type,
    button: 0,
    pointerId: 1,
    currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {} },
  } as never;
}

describe('usePressAndHold', () => {
  let now = 0;
  let queue: FrameRequestCallback[] = [];
  const step = (ms: number) => {
    now += ms;
    const cbs = queue;
    queue = [];
    cbs.forEach((cb) => cb(now));
  };

  beforeEach(() => {
    now = 0;
    queue = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('fires once after holding for the full duration (touch)', () => {
    const done = vi.fn();
    const { result } = renderHook(() => usePressAndHold(done, { durationMs: 200 }));
    act(() => result.current.bind.onPointerDown(pointer('touch')));
    act(() => { for (let i = 0; i < 4; i++) step(40); });
    expect(done).not.toHaveBeenCalled();
    act(() => { for (let i = 0; i < 4; i++) step(40); });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not fire when released early, and eases back down', () => {
    const done = vi.fn();
    const { result } = renderHook(() => usePressAndHold(done, { durationMs: 200 }));
    act(() => result.current.bind.onPointerDown(pointer('mouse')));
    act(() => { for (let i = 0; i < 3; i++) step(40); });
    const mid = result.current.progress;
    expect(mid).toBeGreaterThan(0);
    act(() => result.current.bind.onPointerUp(pointer('mouse')));
    act(() => step(40));
    expect(result.current.progress).toBeLessThan(mid);
    act(() => { for (let i = 0; i < 10; i++) step(40); });
    expect(result.current.progress).toBe(0);
    expect(done).not.toHaveBeenCalled();
  });

  it('ignores presses while disabled', () => {
    const done = vi.fn();
    const { result } = renderHook(() => usePressAndHold(done, { durationMs: 100, enabled: false }));
    act(() => result.current.bind.onPointerDown(pointer()));
    act(() => { for (let i = 0; i < 10; i++) step(40); });
    expect(done).not.toHaveBeenCalled();
  });
});
