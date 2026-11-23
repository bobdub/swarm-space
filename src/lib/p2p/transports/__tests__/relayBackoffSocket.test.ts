import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRelayBackoffSocket,
  relayBackoffDelay,
  _resetRelayBackoffForTest,
  type SocketLike,
} from '../relayBackoffSocket';

type Handler = ((ev: unknown) => void) | null;

class FakeSocket implements SocketLike {
  static made: FakeSocket[] = [];
  readyState = 0;
  onopen: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;
  sent: unknown[] = [];
  constructor(public url: string) { FakeSocket.made.push(this); }
  send(d: unknown) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.({}); }
  fail() { this.onerror?.({}); this.readyState = 3; this.onclose?.({}); }
  open() { this.readyState = 1; this.onopen?.({}); }
}

const URL = 'wss://dead.example/gun';

describe('relayBackoffSocket', () => {
  beforeEach(() => {
    _resetRelayBackoffForTest();
    FakeSocket.made = [];
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('connects immediately while a relay is healthy', () => {
    const Sock = createRelayBackoffSocket(FakeSocket);
    new Sock(URL);
    expect(FakeSocket.made).toHaveLength(1);
  });

  it('delays reconnects to a failing relay exponentially, capped', () => {
    const Sock = createRelayBackoffSocket(FakeSocket);
    for (let i = 0; i < 3; i++) {
      new Sock(URL);
      vi.runOnlyPendingTimers();
      FakeSocket.made[FakeSocket.made.length - 1].fail();
    }
    expect(relayBackoffDelay(URL)).toBe(8_000);
    const before = FakeSocket.made.length;
    new Sock(URL);
    expect(FakeSocket.made.length).toBe(before);
    vi.advanceTimersByTime(8_000);
    expect(FakeSocket.made.length).toBe(before + 1);
    for (let i = 0; i < 20; i++) {
      new Sock(URL);
      vi.runOnlyPendingTimers();
      FakeSocket.made[FakeSocket.made.length - 1].fail();
    }
    expect(relayBackoffDelay(URL)).toBe(5 * 60 * 1000);
  });

  it('resets the backoff once the relay opens', () => {
    const Sock = createRelayBackoffSocket(FakeSocket);
    for (let i = 0; i < 3; i++) {
      new Sock(URL);
      vi.runOnlyPendingTimers();
      FakeSocket.made[FakeSocket.made.length - 1].fail();
    }
    new Sock(URL);
    vi.runOnlyPendingTimers();
    FakeSocket.made[FakeSocket.made.length - 1].open();
    expect(relayBackoffDelay(URL)).toBe(0);
  });

  it('forwards events and throws on send until open, so Gun queues', () => {
    const Sock = createRelayBackoffSocket(FakeSocket);
    const s = new Sock(URL);
    const onopen = vi.fn();
    const onmessage = vi.fn();
    s.onopen = onopen;
    s.onmessage = onmessage;
    expect(() => s.send('x')).toThrow();
    FakeSocket.made[0].open();
    expect(onopen).toHaveBeenCalled();
    s.send('hi');
    expect(FakeSocket.made[0].sent).toEqual(['hi']);
    FakeSocket.made[0].onmessage?.({ data: 'm' });
    expect(onmessage).toHaveBeenCalledWith({ data: 'm' });
  });

  it('a close before the delayed connect never opens a socket', () => {
    const Sock = createRelayBackoffSocket(FakeSocket);
    for (let i = 0; i < 3; i++) {
      new Sock(URL);
      vi.runOnlyPendingTimers();
      FakeSocket.made[FakeSocket.made.length - 1].fail();
    }
    const before = FakeSocket.made.length;
    const s = new Sock(URL);
    s.close();
    vi.runOnlyPendingTimers();
    expect(FakeSocket.made.length).toBe(before);
    expect(s.readyState).toBe(3);
  });
});
