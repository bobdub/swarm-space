/**
 * relayBackoffSocket — a WebSocket wrapper that backs off dead Gun relays.
 *
 * Gun's mesh reconnects a closed relay on a flat ~2 s timer. A relay that
 * is down (or a hostname that no longer resolves) therefore costs a socket
 * open, an error, a close and a mesh `bye` every two seconds, per relay,
 * for as long as the tab is open. Gun takes its socket class from
 * `opt.WebSocket`, so this wrapper sits in that slot and delays each new
 * connection to a relay by an exponential backoff that grows with that
 * relay's consecutive failures and resets as soon as it opens.
 *
 * The wrapper behaves like a WebSocket as far as Gun can tell: it exposes
 * the four `on*` handlers, `readyState`, `send` and `close`, and `send`
 * throws while not open so Gun queues the message (as it does for a
 * native socket that is still connecting).
 */

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

const relayFailures = new Map<string, number>();

/** Extra wait before the next connection attempt to `url`. 0 when healthy. */
export function relayBackoffDelay(url: string): number {
  const failures = relayFailures.get(url) ?? 0;
  if (failures <= 1) return 0;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - 1));
}

function recordFailure(url: string): void {
  relayFailures.set(url, (relayFailures.get(url) ?? 0) + 1);
}

function recordSuccess(url: string): void {
  relayFailures.delete(url);
}

type Handler = ((ev: unknown) => void) | null;

export interface SocketLike {
  readyState: number;
  onopen: Handler;
  onclose: Handler;
  onerror: Handler;
  onmessage: Handler;
  send(data: unknown): void;
  close(): void;
}

export type SocketCtor = new (url: string, protocols?: string | string[]) => SocketLike;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** Build a backoff-aware WebSocket class on top of `Native`. */
export function createRelayBackoffSocket(Native: SocketCtor): SocketCtor {
  return class RelayBackoffSocket implements SocketLike {
    static CONNECTING = CONNECTING;
    static OPEN = OPEN;
    static CLOSED = CLOSED;

    readyState = CONNECTING;
    onopen: Handler = null;
    onclose: Handler = null;
    onerror: Handler = null;
    onmessage: Handler = null;

    private ws: SocketLike | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private opened = false;
    private closedByCaller = false;

    constructor(private readonly url: string, private readonly protocols?: string | string[]) {
      const delay = relayBackoffDelay(url);
      if (delay === 0) this.connect();
      else this.timer = setTimeout(() => { this.timer = null; this.connect(); }, delay);
    }

    private connect(): void {
      if (this.closedByCaller) return;
      let ws: SocketLike;
      try {
        ws = new Native(this.url, this.protocols);
      } catch (err) {
        recordFailure(this.url);
        this.readyState = CLOSED;
        this.onerror?.(err);
        this.onclose?.({ code: 1006 });
        return;
      }
      this.ws = ws;
      ws.onopen = (ev) => {
        this.opened = true;
        recordSuccess(this.url);
        this.readyState = OPEN;
        this.onopen?.(ev);
      };
      ws.onmessage = (ev) => { this.onmessage?.(ev); };
      ws.onerror = (ev) => { this.onerror?.(ev); };
      ws.onclose = (ev) => {
        if (!this.opened && !this.closedByCaller) recordFailure(this.url);
        this.readyState = CLOSED;
        this.onclose?.(ev);
      };
    }

    send(data: unknown): void {
      if (!this.ws || this.readyState !== OPEN) {
        throw new Error('RelayBackoffSocket is not open');
      }
      this.ws.send(data);
    }

    close(): void {
      this.closedByCaller = true;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
      } else {
        this.readyState = CLOSED;
      }
    }
  };
}

let _shared: SocketCtor | null = null;

/** The backoff socket over the browser's WebSocket, or undefined without one. */
export function getRelayBackoffSocket(): SocketCtor | undefined {
  if (_shared) return _shared;
  const Native = (globalThis as { WebSocket?: SocketCtor }).WebSocket;
  if (typeof Native !== 'function') return undefined;
  _shared = createRelayBackoffSocket(Native);
  return _shared;
}

/** Test seam. */
export function _resetRelayBackoffForTest(): void {
  relayFailures.clear();
  _shared = null;
}
