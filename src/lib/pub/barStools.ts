/**
 * barStools — the stools along the bar counter.
 *
 * Every counter stool is its own one-seat "table" so the shared pub
 * plumbing (proximity anchor → press-and-hold → takeSeatAt pin) works
 * for it with no game panel attached.
 */

/** Centre-to-centre spacing between counter stools, in metres. */
export const BAR_STOOL_SPACING_M = 1.1;
/** Gap left between the outermost stool centre and each counter end. */
export const BAR_STOOL_END_INSET_M = 0.45;

/**
 * Right-axis offsets for stools spread evenly along the full counter,
 * centred on the counter's midpoint.
 */
export function barStoolOffsets(
  counterLen: number,
  spacing = BAR_STOOL_SPACING_M,
  endInset = BAR_STOOL_END_INSET_M,
): number[] {
  const span = Math.max(0, counterLen - endInset * 2);
  const count = Math.max(1, Math.floor(span / spacing) + 1);
  if (count === 1) return [0];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => -span / 2 + step * i);
}

const PREFIX = 'pub:stool:';

/** Table id for one counter stool in a given bar. */
export function barStoolTableId(barId: string, index: number): string {
  return `${PREFIX}${barId}:${index}`;
}

/** True when `tableId` is a counter stool rather than a game table. */
export function isBarStoolTable(tableId: string | null | undefined): boolean {
  return !!tableId && tableId.startsWith(PREFIX);
}

/** Spacing of the invisible colliders that make the counter solid. */
export const COUNTER_COLLIDER_STEP_M = 0.5;

/** Right-axis offsets of counter colliders, end to end along the counter. */
export function counterColliderOffsets(
  counterLen: number,
  step = COUNTER_COLLIDER_STEP_M,
): number[] {
  const count = Math.max(2, Math.round(counterLen / step) + 1);
  const pitch = counterLen / (count - 1);
  return Array.from({ length: count }, (_, i) => -counterLen / 2 + pitch * i);
}

/**
 * The bar-counter table (drinks menu) a stool faces, so a seated player
 * can order without getting up. Null for anything that isn't a stool.
 */
export function barTableForStool(tableId: string | null | undefined): string | null {
  if (!isBarStoolTable(tableId)) return null;
  const rest = (tableId as string).slice(PREFIX.length);
  const cut = rest.lastIndexOf(':');
  return cut > 0 ? `pub:bar:${rest.slice(0, cut)}` : null;
}
