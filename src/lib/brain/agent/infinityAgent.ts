/**
 * Infinity's agent loop — one idle-time scheduler for everything Infinity
 * does on its own.
 *
 * Seamless tasks (no heartbeat) run at every tier: memory learning (already
 * started by the entity voice listener) and linking learned memory into the
 * synapse graph. Heartbeat tasks unlock as the connection clock grows:
 *
 *   10–15 min  converse    — normal replies (unchanged; status only)
 *   15–30 min  initiate    — may start one message in the shared chat
 *   30 min–2 h reflect     — reflects on its own messages and memory coins
 *   2 h+       deep        — closes strong paths in the graph (brain mapping)
 *                             and bypasses Ricci bottlenecks (bounded scan)
 *
 * Every task is local, bounded and runs in idle time. Nothing here moves
 * community pool funds (that phase is held for separate approval).
 */
import { ConnectionClock, tierFor, tierAtLeast, type AgentTier } from './connectionClock';
import { getSynapseGraph, saveSynapseGraph, topicSequence, topicsOf } from './synapseGraph';
import {
  CONVERSATION_LIVE_MS, initiativeSeed, quotesAny, recentHumanLines, shouldInitiate, type ChatLineLike,
} from './initiative';
import { ANSWER_WINDOW_MS, MAX_OWN_MESSAGES, deepMap, reflect, type OwnMessage } from './reflection';
import { ricciScan } from './ricci';

export const AGENT_TICK_MS = 60_000;
const LINK_INTERVAL_MS = 2 * 60_000;
const INITIATE_INTERVAL_MS = 2 * 60_000;
const REFLECT_INTERVAL_MS = 20 * 60_000;
const DEEP_INTERVAL_MS = 45 * 60_000;
const LINK_CURSOR_KEY = 'infinity-synapse-cursor';
const LINK_BATCH = 120;

export interface AgentStatus {
  tier: AgentTier;
  connectedMs: number;
  lastReflectAt: number | null;
  lastDeepAt: number | null;
  lastInitiativeAt: number | null;
  graph: { nodes: number; links: number };
}

type Task = { id: string; minTier: AgentTier; everyMs: number; run: () => Promise<void> | void };

const clock = new ConnectionClock();
const lastRun = new Map<string, number>();
const listeners = new Set<() => void>();
const own: OwnMessage[] = [];
let status: AgentStatus = {
  tier: 'base', connectedMs: 0, lastReflectAt: null, lastDeepAt: null, lastInitiativeAt: null, graph: { nodes: 0, links: 0 },
};
let started = false;
let running = false;

export function getAgentStatus(): AgentStatus { return status; }
export function subscribeAgent(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(patch: Partial<AgentStatus>): void {
  status = { ...status, ...patch, graph: getSynapseGraph().size };
  for (const l of listeners) l();
}

function idle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 15_000 }); else setTimeout(fn, 0);
}

// ── Seamless: link learned memory into the synapse graph ─────────────

async function linkMemory(): Promise<void> {
  const { readMemorySince } = await import('@/lib/brain/infinityMemory');
  let cursor = 0;
  try { cursor = Number(localStorage.getItem(LINK_CURSOR_KEY)) || 0; } catch { /* ignore */ }
  // Page forward from the cursor (oldest first) so a burst never skips pieces.
  const pieces = await readMemorySince(cursor, LINK_BATCH);
  if (!pieces.length) return;
  const graph = getSynapseGraph();
  // Only pieces stored with the author's consent stamp; legacy pieces are skipped.
  for (const p of pieces) if (p.consented === true) graph.observe({ topics: topicSequence(p.text), peer: p.authorHash, ordered: true, natural: true }, p.ts);
  try { localStorage.setItem(LINK_CURSOR_KEY, String(pieces[pieces.length - 1].ts)); } catch { /* ignore */ }
  saveSynapseGraph();
}

// ── Shared chat helpers ──────────────────────────────────────────────

async function roomLines(): Promise<ChatLineLike[]> {
  const { getRoomChatMessages } = await import('@/lib/streaming/webrtcSignalingBridge.standalone');
  const { BRAIN_ROOM_ID } = await import('@/lib/chat/networkChatRoom');
  return getRoomChatMessages(BRAIN_ROOM_ID).map((m) => {
    const sep = m.text.indexOf('\u0001');
    return { text: sep > 0 ? m.text.slice(sep + 1) : m.text, ts: m.ts, peerId: m.senderPeerId, infinityReplyTo: m.infinityReplyTo };
  });
}

/** Mark Infinity's own messages answered when a person spoke after them. */
function trackAnswers(lines: ChatLineLike[]): void {
  for (const msg of own) {
    if (msg.answered) continue;
    msg.answered = lines.some((l) => !l.infinityReplyTo && l.ts > msg.ts && l.ts - msg.ts <= ANSWER_WINDOW_MS);
  }
}

function lastInfinityAt(lines: ChatLineLike[]): number {
  let at = status.lastInitiativeAt ?? 0;
  for (const l of lines) if (l.infinityReplyTo && l.ts > at) at = l.ts;
  return at;
}

// ── Heartbeat: unprompted input (15 min+) ────────────────────────────

async function initiate(): Promise<void> {
  const now = Date.now();
  const lines = await roomLines();
  trackAnswers(lines);
  const [{ getShyMode }, { loadHubPrefs }, { getCurrentUser }, guest, bridge] = await Promise.all([
    import('@/lib/p2p/shyMode'), import('@/lib/virtualHub/avatars'), import('@/lib/auth'),
    import('@/lib/preview/guestAccess'), import('@/lib/streaming/webrtcSignalingBridge.standalone'),
  ]);
  const user = getCurrentUser();
  if (!user || guest.isGuestUser(user)) return;
  const mode = loadHubPrefs().infinityChatMode;
  const ok = shouldInitiate({
    now,
    tierAllows: tierAtLeast(status.tier, 'initiate'),
    shy: getShyMode(),
    chatEnabled: mode === 'text' || mode === 'audio',
    selfPeerId: bridge.getLocalMeshPeerId(),
    lines,
    lastInfinityAt: lastInfinityAt(lines),
  });
  if (!ok) return;
  const recent = recentHumanLines(lines, now);
  const associated = getSynapseGraph().associate(topicsOf(recent.map((l) => l.text).join(' ')), 4).map((a) => a.topic);
  const seed = initiativeSeed(recent, associated);
  if (!seed) return;
  const [{ getEntityVoice, ENTITY_DISPLAY_NAME, ENTITY_USER_ID }, { getSharedNeuralEngine }, { BRAIN_ROOM_ID }, { networkNow }] = await Promise.all([
    import('@/lib/p2p/entityVoice'), import('@/lib/p2p/sharedNeuralEngine'), import('@/lib/chat/networkChatRoom'), import('@/lib/time/networkClock'),
  ]);
  let text = '';
  try { text = getEntityVoice().generateText(seed, getSharedNeuralEngine())?.trim() ?? ''; } catch { /* silence */ }
  // Silence beats filler, and Infinity never repeats a person's words back.
  if (!text || quotesAny(text, recent)) return;
  const id = crypto.randomUUID();
  const ts = networkNow();
  bridge.sendRoomChatMessage(BRAIN_ROOM_ID, `${id}\u0001${text}`, user.id, guest.brainDisplayName(user), undefined, undefined, `initiative:${id}`);
  window.dispatchEvent(new CustomEvent('infinity:chat-line', {
    detail: { id, author: ENTITY_DISPLAY_NAME, authorId: ENTITY_USER_ID, infinityReplyTo: `initiative:${id}`, text, ts },
  }));
  own.push({ text, ts, answered: false });
  if (own.length > MAX_OWN_MESSAGES) own.splice(0, own.length - MAX_OWN_MESSAGES);
  publish({ lastInitiativeAt: Date.now() });
}

// ── Heartbeat: reflection (30 min+) and deep mapping (2 h+) ──────────

async function reflectTask(): Promise<void> {
  const now = Date.now();
  const lines = await roomLines();
  trackAnswers(lines);
  const live = lines.filter((l) => !l.infinityReplyTo && now - l.ts <= CONVERSATION_LIVE_MS);
  const { getSharedNeuralEngine } = await import('@/lib/p2p/sharedNeuralEngine');
  let coins: Array<{ coinId?: string; topics: string[]; paragraphs: string[] }> = [];
  try { coins = getSharedNeuralEngine().getDualLearning().coreMemories.list(); } catch { /* none yet */ }
  reflect(getSynapseGraph(), { own, coins, recentTopics: topicsOf(live.map((l) => l.text).join(' '), 12), now });
  saveSynapseGraph();
  publish({ lastReflectAt: now });
}

async function deepTask(): Promise<void> {
  const now = Date.now();
  const graph = getSynapseGraph();
  deepMap(graph, now);
  // Curvature scan is bounded (links and milliseconds) and runs only here,
  // on the 2 h+ deep heartbeat, never on the learning path.
  ricciScan(graph, now);
  saveSynapseGraph();
  publish({ lastDeepAt: now });
}

const TASKS: Task[] = [
  { id: 'link', minTier: 'base', everyMs: LINK_INTERVAL_MS, run: linkMemory },
  { id: 'initiate', minTier: 'initiate', everyMs: INITIATE_INTERVAL_MS, run: initiate },
  { id: 'reflect', minTier: 'reflect', everyMs: REFLECT_INTERVAL_MS, run: reflectTask },
  { id: 'deep', minTier: 'deep', everyMs: DEEP_INTERVAL_MS, run: deepTask },
];

/** One heartbeat: update the clock, then run whatever is due. */
export async function agentTick(peerCount: number, now = Date.now()): Promise<void> {
  clock.observe(peerCount, now);
  const connectedMs = clock.connectedFor(now);
  publish({ tier: tierFor(connectedMs), connectedMs });
  if (running) return;
  running = true;
  try {
    for (const task of TASKS) {
      if (!tierAtLeast(status.tier, task.minTier)) continue;
      if (now - (lastRun.get(task.id) ?? 0) < task.everyMs) continue;
      lastRun.set(task.id, now);
      try { await task.run(); } catch (err) { console.warn(`[InfinityAgent] ${task.id} failed`, err); }
    }
  } finally {
    running = false;
  }
}

export function startInfinityAgent(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const beat = () => idle(() => {
    void import('@/lib/streaming/webrtcSignalingBridge.standalone')
      .then((b) => agentTick(b.getMeshConnectedPeerCount()))
      .catch(() => {});
  });
  beat();
  setInterval(beat, AGENT_TICK_MS);
}

/** Test hook. */
export function resetInfinityAgentForTests(): void {
  lastRun.clear();
  own.length = 0;
  running = false;
  status = { tier: 'base', connectedMs: 0, lastReflectAt: null, lastDeepAt: null, lastInitiativeAt: null, graph: { nodes: 0, links: 0 } };
}
