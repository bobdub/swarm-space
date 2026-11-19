import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { BrainStatusReadout } from '../BrainStatusReadout';

const source = vi.hoisted(() => ({ getQScore: vi.fn(() => 0.2), getBody: vi.fn(() => undefined), subscribe: vi.fn() }));
vi.mock('@/lib/brain/uqrcPhysics', () => ({ getBrainPhysics: () => source }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('status sampling is isolated from the scene owner', () => {
  it('samples twice a second without a physics subscription or parent renders, and stops on unmount', () => {
    vi.useFakeTimers();
    const owner = vi.fn();
    function SceneOwner() {
      owner();
      return <BrainStatusReadout selfId="self" voiceCount={1} />;
    }
    const view = render(<SceneOwner />);
    const initial = source.getQScore.mock.calls.length;
    act(() => vi.advanceTimersByTime(499));
    expect(source.getQScore).toHaveBeenCalledTimes(initial);
    act(() => vi.advanceTimersByTime(1));
    expect(source.getQScore).toHaveBeenCalledTimes(initial + 1);
    act(() => vi.advanceTimersByTime(500));
    expect(source.getQScore).toHaveBeenCalledTimes(initial + 2);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(source.subscribe).not.toHaveBeenCalled();
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(source.getQScore).toHaveBeenCalledTimes(initial + 2);
  });
});