import { describe, expect, it, vi } from 'vitest';
import { RELEASE_IDLE_MS, RELEASE_MAX_WAIT_MS, RELEASE_POLL_MS, sendReleaseWhenClear } from '../releaseHandshake';

function channel() {
  let clock = 1_000;
  const queue: Array<{ at: number; fn: () => void }> = [];
  const state = { open: true, buffered: 0, lastHeard: clock };
  const send = vi.fn();
  const deps = {
    isOpen: () => state.open,
    bufferedAmount: () => state.buffered,
    lastHeardAt: () => state.lastHeard,
    now: () => clock,
    send,
    schedule: (fn: () => void, ms: number) => { queue.push({ at: clock + ms, fn }); },
  };
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > end) break;
      queue.shift();
      clock = next.at;
      next.fn();
    }
    clock = end;
  };
  return { state, send, deps, advance, heard: () => { state.lastHeard = clock; } };
}

describe('release hint on a clear channel', () => {
  it('waits out the opening burst, then sends once', () => {
    const c = channel();
    sendReleaseWhenClear(c.deps);
    c.advance(RELEASE_IDLE_MS - 1);
    expect(c.send).not.toHaveBeenCalled();
    c.advance(1);
    expect(c.send).toHaveBeenCalledTimes(1);
    c.advance(60_000);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('holds while our buffer drains or the peer is still talking', () => {
    const c = channel();
    c.state.buffered = 4096;
    sendReleaseWhenClear(c.deps);
    c.advance(RELEASE_IDLE_MS + RELEASE_POLL_MS * 2);
    expect(c.send).not.toHaveBeenCalled();
    c.state.buffered = 0;
    c.heard();
    c.advance(RELEASE_POLL_MS);
    expect(c.send).not.toHaveBeenCalled();
    c.advance(RELEASE_IDLE_MS);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('a channel that never settles still gets the hint', () => {
    const c = channel();
    c.state.buffered = 1;
    sendReleaseWhenClear(c.deps);
    c.advance(RELEASE_MAX_WAIT_MS + RELEASE_POLL_MS);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('a closed or cancelled channel sends nothing', () => {
    const a = channel();
    sendReleaseWhenClear(a.deps);
    a.state.open = false;
    a.advance(RELEASE_MAX_WAIT_MS * 2);
    expect(a.send).not.toHaveBeenCalled();

    const b = channel();
    const cancel = sendReleaseWhenClear(b.deps);
    cancel();
    b.advance(RELEASE_MAX_WAIT_MS * 2);
    expect(b.send).not.toHaveBeenCalled();
  });
});
