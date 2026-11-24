import { describe, it, expect, vi } from 'vitest';
import { isScreenViewerOpen, setScreenViewerOpen, subscribeScreenViewerOpen } from '../screenViewerOpen';

describe('screen viewer open flag', () => {
  it('notifies only on a real change', () => {
    const fn = vi.fn();
    const off = subscribeScreenViewerOpen(fn);
    setScreenViewerOpen(true);
    setScreenViewerOpen(true);
    expect(isScreenViewerOpen()).toBe(true);
    setScreenViewerOpen(false);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    setScreenViewerOpen(true);
    expect(fn).toHaveBeenCalledTimes(2);
    setScreenViewerOpen(false);
  });
});
