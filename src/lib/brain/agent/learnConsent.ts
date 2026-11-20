/**
 * Who Infinity may learn from.
 *
 * The Shy Node toggle (node dashboard) is the switch: a shy node's words are
 * never learned. Shy lives on each person's own device, so the author stamps
 * `infinityLearn: true` on posts, comments and chat lines they write while not
 * shy. Every other device learns only from items carrying that stamp; an item
 * without it (old content, older clients, shy authors) is never learned.
 */
import { getShyMode } from '@/lib/p2p/shyMode';

/** Stamp for content this device is about to create. */
export function selfLearnStamp(): { infinityLearn?: true } {
  return getShyMode() ? {} : { infinityLearn: true };
}

/** True when this device's own words may be learned right now. */
export function selfLearnable(): boolean {
  return !getShyMode();
}

/** True only when the author stamped the item as learnable. */
export function isLearnable(item: unknown): boolean {
  return Boolean(item && typeof item === 'object' && (item as { infinityLearn?: unknown }).infinityLearn === true);
}
