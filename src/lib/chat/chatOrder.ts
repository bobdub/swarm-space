/**
 * Causal chat order: a reply always shows after the line it answers.
 *
 * New peers stamp lines with `causalNow()`, so replies already carry a later
 * stamp than their parent. Lines from older peers, or from a peer whose clock
 * was briefly off, may not, so the view also nudges each reply to just after
 * its parent. Ties are broken by id so every peer shows the same order.
 */

export interface OrderableLine {
  id: string;
  ts: number;
  replyToId?: string;
}

/** Sort lines by time, keeping every reply after its parent. */
export function causalOrder<T>(lines: T[], key: (line: T) => OrderableLine = (l) => l as unknown as OrderableLine): T[] {
  const byId = new Map<string, OrderableLine>();
  for (const line of lines) {
    const k = key(line);
    byId.set(k.id, k);
  }
  const effective = new Map<string, number>();
  const visiting = new Set<string>();
  const effectiveTs = (k: OrderableLine): number => {
    const known = effective.get(k.id);
    if (known !== undefined) return known;
    let ts = Number.isFinite(k.ts) ? k.ts : 0;
    const parent = k.replyToId ? byId.get(k.replyToId) : undefined;
    if (parent && parent.id !== k.id && !visiting.has(k.id)) {
      visiting.add(k.id);
      ts = Math.max(ts, effectiveTs(parent) + 1);
      visiting.delete(k.id);
    }
    effective.set(k.id, ts);
    return ts;
  };
  return lines
    .map((line) => ({ line, k: key(line) }))
    .map((entry) => ({ ...entry, ts: effectiveTs(entry.k) }))
    .sort((a, b) => a.ts - b.ts || (a.k.id < b.k.id ? -1 : a.k.id > b.k.id ? 1 : 0))
    .map((entry) => entry.line);
}
