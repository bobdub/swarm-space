/**
 * Room graph: Gun.js discovery and call-setup fallback for call rooms.
 *
 * Gossip down a line of members (A-B-C-D) is slow and lossy, so every
 * member also writes its presence to a shared Gun room graph:
 *
 *   swarm-space/rooms/<roomId>/peers/<peerId>   presence, 30 s TTL heartbeat
 *   swarm-space/rooms/<roomId>/inbox/<peerId>   call setup inbox
 *
 * Everyone in the room sees everyone else directly, so the call layer can
 * close the mesh into a full web (every pair dials). When a pair has no open
 * mesh link yet, their short setup strings (SDP offer/answer, ICE candidates,
 * reconnect) may also travel through the target's inbox. Audio and video
 * never touch Gun: they stay on direct WebRTC (or TURN).
 *
 * Uses the same GunAdapter transport as the stalled-dial mesh relay
 * (`src/lib/p2p/meshRelayLink.ts`). Started only while a call room is
 * joined. Gun relays are bot-protected, so automated tests inject a mock
 * transport through `setRoomGraphTransportFactory`.
 */

import { GUN_RELAYS } from '@/lib/p2p/gunRelays';

export const ROOM_GRAPH_ROOT = 'swarm-space/rooms';
/** A member not heard from for this long is no longer present in the graph. */
export const ROOM_GRAPH_TTL_MS = 30_000;
/** How often each member rewrites its presence slot. */
export const ROOM_GRAPH_HEARTBEAT_MS = 10_000;
/** Setup strings older than this are stale history, not live signaling. */
export const ROOM_INBOX_MAX_AGE_MS = 60_000;
/** SDP is a few KB; anything far larger is not call setup. */
export const ROOM_INBOX_MAX_BYTES = 32 * 1024;

const PRESENCE_CHANNEL = 'room-presence';
const INBOX_CHANNEL = 'room-signal';

export interface RoomGraphTransport {
  start(context: { peerId: string }): Promise<void>;
  stop(): void;
  send(channel: string, peerId: string, payload: unknown): boolean;
  broadcastToAll(channel: string, payload: unknown, options?: { slot?: string }): boolean;
  onMessage(channel: string, handler: (peerId: string, payload: unknown) => void): () => void;
}

export interface RoomGraphTransportOptions {
  graphKey: string;
  /** Presence registry: one slot per member, latest write wins. */
  registryMode?: boolean;
  /** Per-member inbox: listen only on `<graphKey>/<localPeerId>`. */
  inbox?: boolean;
  maxAgeMs: number;
}

export type RoomGraphTransportFactory = (options: RoomGraphTransportOptions) => Promise<RoomGraphTransport>;

const isTestRun = typeof process !== 'undefined' && !!process.env?.VITEST;

const gunFactory: RoomGraphTransportFactory = async (options) => {
  const { GunAdapter } = await import('@/lib/p2p/transports/gunAdapter');
  return new GunAdapter({ peers: GUN_RELAYS, ...options }) as unknown as RoomGraphTransport;
};

// Tests never reach real relays unless they inject a transport.
let factory: RoomGraphTransportFactory | null = isTestRun ? null : gunFactory;

/** Test hook: swap the Gun transport (null disables the room graph). */
export function setRoomGraphTransportFactory(next: RoomGraphTransportFactory | null): void {
  factory = next;
}

export function roomPeersGraphKey(roomId: string): string {
  return `${ROOM_GRAPH_ROOT}/${roomId}/peers`;
}
export function roomInboxGraphKey(roomId: string): string {
  return `${ROOM_GRAPH_ROOT}/${roomId}/inbox`;
}

interface PresenceRecord { peerId: string; roomId: string; ts: number; left?: boolean }

interface ActiveGraph {
  roomId: string;
  peerId: string;
  presence: RoomGraphTransport | null;
  inbox: RoomGraphTransport | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  sweep: ReturnType<typeof setInterval> | null;
  offs: Array<() => void>;
  /** peerId -> last time we saw a fresh heartbeat (local clock). */
  seen: Map<string, number>;
  /** Inbox sends made while the inbox transport was still starting. */
  queue: Array<{ to: string; raw: string }>;
  closed: boolean;
}

let active: ActiveGraph | null = null;
const peerHandlers = new Set<(roomId: string, peerId: string) => void>();
const peerGoneHandlers = new Set<(roomId: string, peerId: string) => void>();
const inboxHandlers = new Set<(roomId: string, fromPeerId: string, envelope: Record<string, unknown>) => void>();

function emit<T extends unknown[]>(handlers: Set<(...args: T) => void>, ...args: T): void {
  for (const h of handlers) {
    try { h(...args); } catch { /* ignore */ }
  }
}

function writePresence(graph: ActiveGraph, left = false): void {
  if (!graph.presence) return;
  const record: PresenceRecord = { peerId: graph.peerId, roomId: graph.roomId, ts: Date.now(), ...(left ? { left: true } : {}) };
  try {
    graph.presence.broadcastToAll(PRESENCE_CHANNEL, JSON.stringify(record), { slot: graph.peerId });
  } catch { /* relay unavailable */ }
}

function onPresence(graph: ActiveGraph, from: string, payload: unknown): void {
  if (graph.closed || typeof payload !== 'string' || payload.length > 1024) return;
  let record: PresenceRecord;
  try { record = JSON.parse(payload) as PresenceRecord; } catch { return; }
  // The slot owner is the only one who may speak for it.
  if (!record || record.peerId !== from || record.roomId !== graph.roomId || from === graph.peerId) return;
  if (typeof record.ts !== 'number' || Math.abs(Date.now() - record.ts) > ROOM_GRAPH_TTL_MS) return;
  if (record.left) {
    if (graph.seen.delete(from)) emit(peerGoneHandlers, graph.roomId, from);
    return;
  }
  const isNew = !graph.seen.has(from);
  graph.seen.set(from, Date.now());
  // Every fresh heartbeat is reported: the call layer uses it to retry a
  // pair that still has no connection, and ignores it for working pairs.
  emit(peerHandlers, graph.roomId, from);
  if (isNew) console.log(`[RoomGraph] 🕸️ ${from} is in ${graph.roomId}`);
}

function onInbox(graph: ActiveGraph, from: string, payload: unknown): void {
  if (graph.closed || typeof payload !== 'string' || payload.length > ROOM_INBOX_MAX_BYTES) return;
  let envelope: Record<string, unknown>;
  try { envelope = JSON.parse(payload) as Record<string, unknown>; } catch { return; }
  if (!envelope || typeof envelope !== 'object') return;
  // Only the sender may sign as the sender, only to us, only for this room.
  if (envelope.from !== from || envelope.to !== graph.peerId || envelope.roomId !== graph.roomId) return;
  if (typeof envelope.ts !== 'number' || Date.now() - envelope.ts > ROOM_INBOX_MAX_AGE_MS) return;
  emit(inboxHandlers, graph.roomId, from, envelope);
}

/**
 * Join the room graph for `roomId` as `peerId`. Idempotent; joining another
 * room (or as another peer ID) leaves the previous one first.
 */
export function joinRoomGraph(roomId: string, peerId: string): void {
  if (active && active.roomId === roomId && active.peerId === peerId && !active.closed) return;
  leaveRoomGraph();
  const make = factory;
  if (!make || !roomId || !peerId) return;
  const graph: ActiveGraph = {
    roomId, peerId, presence: null, inbox: null, heartbeat: null, sweep: null,
    offs: [], seen: new Map(), queue: [], closed: false,
  };
  active = graph;

  void (async () => {
    try {
      const presence = await make({ graphKey: roomPeersGraphKey(roomId), registryMode: true, maxAgeMs: ROOM_GRAPH_TTL_MS });
      await presence.start({ peerId });
      if (graph.closed) { presence.stop(); return; }
      graph.presence = presence;
      graph.offs.push(presence.onMessage(PRESENCE_CHANNEL, (from, payload) => onPresence(graph, from, payload)));
      writePresence(graph);
      graph.heartbeat = setInterval(() => writePresence(graph), ROOM_GRAPH_HEARTBEAT_MS);
      graph.sweep = setInterval(() => {
        const now = Date.now();
        for (const [id, at] of graph.seen) {
          if (now - at <= ROOM_GRAPH_TTL_MS) continue;
          graph.seen.delete(id);
          emit(peerGoneHandlers, graph.roomId, id);
        }
      }, ROOM_GRAPH_HEARTBEAT_MS);
    } catch (err) {
      console.warn('[RoomGraph] presence graph unavailable:', err);
    }
  })();

  void (async () => {
    try {
      const inbox = await make({ graphKey: roomInboxGraphKey(roomId), inbox: true, maxAgeMs: ROOM_INBOX_MAX_AGE_MS });
      await inbox.start({ peerId });
      if (graph.closed) { inbox.stop(); return; }
      graph.inbox = inbox;
      graph.offs.push(inbox.onMessage(INBOX_CHANNEL, (from, payload) => onInbox(graph, from, payload)));
      const queued = graph.queue;
      graph.queue = [];
      for (const { to, raw } of queued) inbox.send(INBOX_CHANNEL, to, raw);
    } catch (err) {
      console.warn('[RoomGraph] signaling inbox unavailable:', err);
    }
  })();
}

/** Leave the room graph: mark our slot as left and stop both transports. */
export function leaveRoomGraph(roomId?: string): void {
  const graph = active;
  if (!graph || (roomId && graph.roomId !== roomId)) return;
  active = null;
  graph.closed = true;
  writePresence(graph, true);
  if (graph.heartbeat) clearInterval(graph.heartbeat);
  if (graph.sweep) clearInterval(graph.sweep);
  for (const off of graph.offs) { try { off(); } catch { /* ignore */ } }
  try { graph.presence?.stop(); } catch { /* ignore */ }
  try { graph.inbox?.stop(); } catch { /* ignore */ }
  graph.seen.clear();
  graph.queue = [];
}

/** Members currently present in the graph (excluding us). */
export function getRoomGraphPeers(roomId: string, now: number = Date.now()): string[] {
  if (!active || active.roomId !== roomId) return [];
  return [...active.seen].filter(([, at]) => now - at <= ROOM_GRAPH_TTL_MS).map(([id]) => id);
}

export function isRoomGraphPeerPresent(roomId: string, peerId: string, now: number = Date.now()): boolean {
  if (!active || active.roomId !== roomId) return false;
  const at = active.seen.get(peerId);
  return at !== undefined && now - at <= ROOM_GRAPH_TTL_MS;
}

/** True while the room graph runs for `roomId`. */
export function isRoomGraphActive(roomId: string): boolean {
  return !!active && active.roomId === roomId && !active.closed;
}

/**
 * Put one call setup envelope in `toPeerId`'s room inbox. Returns false
 * when the graph is not running for that room or the envelope is too big.
 */
export function sendRoomInboxSignal(roomId: string, toPeerId: string, envelope: Record<string, unknown>): boolean {
  const graph = active;
  if (!graph || graph.closed || graph.roomId !== roomId || !toPeerId || toPeerId === graph.peerId) return false;
  let raw: string;
  try { raw = JSON.stringify(envelope); } catch { return false; }
  if (raw.length > ROOM_INBOX_MAX_BYTES) return false;
  if (graph.inbox) return graph.inbox.send(INBOX_CHANNEL, toPeerId, raw);
  if (graph.queue.length >= 50) graph.queue.shift();
  graph.queue.push({ to: toPeerId, raw });
  return true;
}

/** A member's heartbeat was seen (first sighting and every refresh). */
export function onRoomGraphPeer(handler: (roomId: string, peerId: string) => void): () => void {
  peerHandlers.add(handler);
  return () => { peerHandlers.delete(handler); };
}

/** A member left the graph or its heartbeat expired. */
export function onRoomGraphPeerGone(handler: (roomId: string, peerId: string) => void): () => void {
  peerGoneHandlers.add(handler);
  return () => { peerGoneHandlers.delete(handler); };
}

/** A call setup envelope arrived through our room inbox (already validated). */
export function onRoomInboxSignal(
  handler: (roomId: string, fromPeerId: string, envelope: Record<string, unknown>) => void,
): () => void {
  inboxHandlers.add(handler);
  return () => { inboxHandlers.delete(handler); };
}
