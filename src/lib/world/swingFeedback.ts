/**
 * swingFeedback — one quiet toast per held tool instead of a pile of them.
 *
 * Every swing used to fire its own sonner toast, so chopping a tree with a
 * dull edge stacked "The trunk resisted (0.31)." again and again. Now all
 * swing feedback for a tool shares one toast id, so each new message
 * replaces the last one in place. Resisted strikes are folded into a
 * single streak line ("The trunk resisted ×3") that updates instead of
 * popping. The in-world impact burst still marks every strike, so nothing
 * is hidden — there is just one indicator rather than many.
 */
import { toast } from 'sonner';

/** A resist more than this long after the previous one starts a new streak. */
export const RESIST_STREAK_GAP_MS = 4_000;
/** Resist toasts are short-lived: they are a hint, not news. */
const RESIST_TOAST_MS = 1_800;

interface Streak {
  count: number;
  lastAt: number;
  what: string;
}

const streaks = new Map<string, Streak>();

export function swingToastId(toolPrefabId: string): string {
  return `swing:${toolPrefabId}`;
}

/** Neutral progress line ("The tree shakes — 2 more swings."). */
export function swingProgress(toolPrefabId: string, title: string, description: string): void {
  streaks.delete(toolPrefabId);
  toast.message(title, { id: swingToastId(toolPrefabId), description });
}

/** A landed result ("Collected water.", "Timber!"). */
export function swingSuccess(toolPrefabId: string, title: string, description: string): void {
  streaks.delete(toolPrefabId);
  toast.success(title, { id: swingToastId(toolPrefabId), description });
}

/**
 * A strike that did not cut. Repeats against the same thing collapse into
 * one updating line; returns the streak length so callers/tests can see it.
 */
export function swingResisted(
  toolPrefabId: string,
  title: string,
  what: string,
  hint?: string,
  now: number = Date.now(),
): number {
  const prev = streaks.get(toolPrefabId);
  const continues = prev && prev.what === what && now - prev.lastAt <= RESIST_STREAK_GAP_MS;
  const count = continues ? prev.count + 1 : 1;
  streaks.set(toolPrefabId, { count, lastAt: now, what });
  const base = count > 1 ? `${what} resisted ×${count}` : `${what} resisted`;
  toast.message(title, {
    id: swingToastId(toolPrefabId),
    description: hint ? `${base} · ${hint}` : `${base}.`,
    duration: RESIST_TOAST_MS,
  });
  return count;
}

export function _resetSwingFeedbackForTest(): void {
  streaks.clear();
}
