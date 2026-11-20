/**
 * Reflection (30 min+) and deep mapping (2 h+) over the synapse graph.
 *
 * Reflection looks back at Infinity's own recent messages and its memory
 * coins: topics of a message people answered get stronger, topics of a
 * message nobody answered get weaker, and every engraved coin re-links to
 * the topics it holds (more so when the room is talking about them again).
 *
 * Deep mapping closes short paths: when A↔B and B↔C are both strong, a weak
 * A↔C link appears, so related ideas find each other without new input.
 * Everything here is local and bounded; nothing is posted or sent.
 */
import { SynapseGraph, nodeId, nodeKind, topicsOf } from './synapseGraph';

export const ANSWER_WINDOW_MS = 5 * 60_000;
export const MAX_OWN_MESSAGES = 20;

export interface OwnMessage { text: string; ts: number; answered: boolean; reflected?: boolean }
export interface CoinMemoryLike { coinId?: string; topics: string[]; paragraphs: string[] }

export interface ReflectionResult { strengthened: number; weakened: number; coinLinks: number; pruned: number }

export function reflect(
  graph: SynapseGraph,
  input: { own: OwnMessage[]; coins: CoinMemoryLike[]; recentTopics: string[]; now: number },
): ReflectionResult {
  const result: ReflectionResult = { strengthened: 0, weakened: 0, coinLinks: 0, pruned: 0 };
  for (const msg of input.own) {
    if (msg.reflected || input.now - msg.ts < ANSWER_WINDOW_MS) continue;
    const topics = topicsOf(msg.text).map((t) => nodeId('topic', t));
    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        if (msg.answered) { graph.reinforce(topics[i], topics[j], 0.5, input.now); result.strengthened++; }
        else { graph.weaken(topics[i], topics[j], 0.8, input.now); result.weakened++; }
      }
    }
    msg.reflected = true;
  }
  const live = new Set(input.recentTopics);
  for (const coin of input.coins) {
    if (!coin.coinId) continue; // only engraved memories are touchstones
    const topics = [...new Set([...coin.topics, ...topicsOf(coin.paragraphs.join(' '), 4)])];
    for (const t of topics) {
      graph.reinforce(nodeId('coin', coin.coinId), nodeId('topic', t), live.has(t) ? 0.5 : 0.1, input.now);
      result.coinLinks++;
    }
  }
  result.pruned = graph.prune(input.now);
  return result;
}

export const DEEP_LINK_SCAN = 40;
export const DEEP_LINK_FACTOR = 0.25;

/** Close strong two-step topic paths. Returns how many new links formed. */
export function deepMap(graph: SynapseGraph, now: number): number {
  let formed = 0;
  const strong = graph.strongest(DEEP_LINK_SCAN, now).filter((l) => nodeKind(l.a) === 'topic' && nodeKind(l.b) === 'topic');
  for (const l of strong) {
    for (const [hub, from] of [[l.a, l.b], [l.b, l.a]] as const) {
      for (const n of graph.neighbours(hub, 6, now)) {
        if (n.id === from || nodeKind(n.id) !== 'topic') continue;
        if (graph.weight(from, n.id, now) > 0) continue;
        graph.reinforce(from, n.id, Math.min(l.w, n.w) * DEEP_LINK_FACTOR, now);
        formed++;
      }
    }
  }
  graph.prune(now);
  return formed;
}
