/**
 * Unprompted input — when Infinity may start a message in the shared chat.
 *
 * Every device runs the same rule, so exactly one device speaks for Infinity:
 * the one whose mesh peer id sorts first among the people talking recently.
 * Infinity speaks at most once per room per cooldown, only into a live
 * conversation, and only when it has learned something real to say (an
 * empty realization means silence, as everywhere else).
 */
import { topicsOf } from './synapseGraph';

export const INITIATIVE_COOLDOWN_MS = 30 * 60_000;
export const CONVERSATION_LIVE_MS = 10 * 60_000;
export const MIN_RECENT_LINES = 3;
export const QUOTE_SHINGLE = 6;

export interface ChatLineLike {
  text: string;
  ts: number;
  peerId?: string;
  /** Infinity lines carry this (prompted replies and its own messages). */
  infinityReplyTo?: string;
}

export interface InitiativeInput {
  now: number;
  /** Agent tier allows it (15+ min connected). */
  tierAllows: boolean;
  /** This node is shy: Infinity never chimes in from it. */
  shy: boolean;
  /** Infinity chat mode on this device is not 'off'. */
  chatEnabled: boolean;
  /** This device's mesh peer id. */
  selfPeerId: string | null;
  lines: ChatLineLike[];
  /** Last time any Infinity line was seen in the room (sent or received). */
  lastInfinityAt: number;
}

/** Human lines from the live window, oldest first. */
export function recentHumanLines(lines: ChatLineLike[], now: number): ChatLineLike[] {
  return lines.filter((l) => !l.infinityReplyTo && now - l.ts <= CONVERSATION_LIVE_MS && l.text.trim().length > 0);
}

/** Lowest peer id among self + recent speakers speaks for Infinity. */
export function isInitiativeLeader(selfPeerId: string, recent: ChatLineLike[]): boolean {
  for (const l of recent) if (l.peerId && l.peerId < selfPeerId) return false;
  return true;
}

export function shouldInitiate(input: InitiativeInput): boolean {
  if (!input.tierAllows || input.shy || !input.chatEnabled || !input.selfPeerId) return false;
  if (input.now - input.lastInfinityAt < INITIATIVE_COOLDOWN_MS) return false;
  const recent = recentHumanLines(input.lines, input.now);
  if (recent.length < MIN_RECENT_LINES) return false;
  // At least one other person must be in the conversation.
  if (!recent.some((l) => l.peerId && l.peerId !== input.selfPeerId)) return false;
  return isInitiativeLeader(input.selfPeerId, recent);
}

/** A prompt built from what the room is talking about plus linked topics. */
export function initiativeSeed(recent: ChatLineLike[], associated: string[]): string {
  const topics = topicsOf(recent.map((l) => l.text).join(' '), 6);
  return [...new Set([...topics, ...associated])].slice(0, 10).join(' ');
}

const shingles = (text: string, n: number): Set<string> => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
};

/** True when `text` repeats any run of QUOTE_SHINGLE words from a person's line. */
export function quotesAny(text: string, lines: ChatLineLike[], n = QUOTE_SHINGLE): boolean {
  const mine = shingles(text, n);
  if (mine.size === 0) return false;
  for (const l of lines) for (const s of shingles(l.text, n)) if (mine.has(s)) return true;
  return false;
}
