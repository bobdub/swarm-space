/**
 * Chain catch-up sync: send a returning peer only the blocks it hasn't seen.
 *
 * When a mesh channel opens, each side asks the other for its chain. Before
 * this, the answer was always the whole chain from genesis. Now the asker
 * remembers, per peer, the last tip it got from that peer ("your block 180,
 * hash X") and sends it with the request. If the answering peer still has
 * that exact block at that height, it sends only what came after, in pages.
 * If not (its chain changed, or the asker is new), it sends the full chain,
 * as before.
 *
 * Peers on older versions never send a mark, so they keep getting full chains,
 * and an older answerer ignores the mark and sends the full chain, which the
 * newer asker still handles.
 */

export interface ChainMark {
  index: number;
  hash: string;
}

export interface BlockLike {
  index: number;
  hash: string;
}

/** Blocks per message; keeps each data-channel message small. */
export const CATCHUP_PAGE_BLOCKS = 50;

const MARKS_KEY = 'swarm-chain-sync-marks';
const MAX_MARKS = 200;

export interface CatchupPage<B> {
  blocks: B[];
  /** Index of the first block in this page. */
  fromIndex: number;
  /** Sender's chain length, so the asker can tell whether it's behind. */
  totalLength: number;
  /** Sender's tip after this sync. */
  tip: ChainMark | null;
  page: number;
  pages: number;
  /** True when the pages start at genesis (no usable mark). */
  full: boolean;
}

/**
 * Split the answer to a sync request into pages. With a mark that matches
 * our chain, only blocks after it are sent; otherwise the whole chain is.
 * An asker already at our tip gets one empty page carrying the tip.
 */
export function planCatchup<B extends BlockLike>(chain: B[], since: ChainMark | null | undefined, pageSize = CATCHUP_PAGE_BLOCKS): CatchupPage<B>[] {
  const last = chain[chain.length - 1];
  const tip = last ? { index: last.index, hash: last.hash } : null;
  const matches = !!since
    && Number.isInteger(since.index)
    && since.index >= 0
    && chain[since.index]?.hash === since.hash;
  const start = matches ? since!.index + 1 : 0;
  const rest = chain.slice(start);
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(rest.length / size));
  const out: CatchupPage<B>[] = [];
  for (let page = 0; page < pages; page++) {
    out.push({
      blocks: rest.slice(page * size, (page + 1) * size),
      fromIndex: start + page * size,
      totalLength: chain.length,
      tip,
      page,
      pages,
      full: !matches,
    });
  }
  return out;
}

type MarkStore = Record<string, ChainMark & { at: number }>;

function readMarks(): MarkStore {
  try {
    const raw = localStorage.getItem(MARKS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as MarkStore : {};
  } catch {
    return {};
  }
}

/** The last tip we got from this peer, if any. */
export function getChainMark(peerId: string): ChainMark | null {
  const mark = readMarks()[peerId];
  if (!mark || !Number.isInteger(mark.index) || typeof mark.hash !== 'string') return null;
  return { index: mark.index, hash: mark.hash };
}

/** Remember this peer's tip once its last page has arrived. */
export function saveChainMark(peerId: string, tip: ChainMark | null | undefined): void {
  if (!peerId || !tip || !Number.isInteger(tip.index) || typeof tip.hash !== 'string') return;
  try {
    const marks = readMarks();
    marks[peerId] = { index: tip.index, hash: tip.hash, at: Date.now() };
    const ids = Object.keys(marks);
    if (ids.length > MAX_MARKS) {
      ids.sort((a, b) => marks[a].at - marks[b].at);
      for (const id of ids.slice(0, ids.length - MAX_MARKS)) delete marks[id];
    }
    localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  } catch { /* storage unavailable: next sync is simply full */ }
}

/** Forget a peer's mark (e.g. its pages didn't line up with what we expected). */
export function clearChainMark(peerId: string): void {
  try {
    const marks = readMarks();
    if (!(peerId in marks)) return;
    delete marks[peerId];
    localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  } catch { /* ignore */ }
}

// ── Shared chain: adopting a peer's chain without losing anything ───────

export interface TxLike {
  id: string;
}

export interface ChainBlockLike<T extends TxLike = TxLike> extends BlockLike {
  previousHash: string;
  transactions: T[];
  /** ISO string (SwarmBlock) or epoch ms. */
  timestamp?: string | number;
}

/** Cadence target: one counted block per this many ms (SWARM_CONFIG.blockTime). */
export const CADENCE_SPACING_MS = 30_000;
/** A gap this long between blocks means the mesh went dark: a new epoch starts. */
export const EPOCH_GAP_MS = 10 * 60 * 1000;
/** Blocks stamped further ahead of our clock than this aren't counted. */
export const FUTURE_LIMIT_MS = 2 * 60 * 1000;

function blockTime(block: { timestamp?: string | number }): number {
  const t = typeof block.timestamp === 'number' ? block.timestamp : Date.parse(String(block.timestamp ?? ''));
  return Number.isFinite(t) ? t : NaN;
}

export interface CadenceWeight {
  /** Blocks that kept the cadence: each at least one spacing after the last counted one. */
  weight: number;
  /** Epochs the segment spans (dark gaps + 1). */
  epochs: number;
}

/**
 * How much real, paced history a run of blocks represents. A burst of blocks
 * mined seconds apart counts once per cadence slot, so a chain can't win by
 * spamming blocks; blocks stamped before their parent or in the future don't
 * count. A gap longer than EPOCH_GAP_MS starts a new epoch (the mesh went
 * dark and re-lit), which is allowed and still counts.
 */
export function cadenceWeight(
  segment: { timestamp?: string | number }[],
  ancestorTime: number,
  now: number = Date.now(),
  spacing: number = CADENCE_SPACING_MS,
): CadenceWeight {
  let last = Number.isFinite(ancestorTime) ? ancestorTime : -Infinity;
  let weight = 0;
  let epochs = 1;
  for (const block of segment) {
    const t = blockTime(block);
    if (!Number.isFinite(t) || t > now + FUTURE_LIMIT_MS) continue;
    const gap = t - last;
    if (gap < spacing) continue;
    if (Number.isFinite(last) && gap > EPOCH_GAP_MS) epochs += 1;
    weight += 1;
    last = t;
  }
  return { weight, epochs };
}

/** First height where the two chains differ (both share everything below it). */
export function forkPoint(a: BlockLike[], b: BlockLike[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i].hash !== b[i].hash) return i;
  return n;
}

export interface AdoptionPlan<T extends TxLike> {
  replace: boolean;
  forkPoint: number;
  /** Our transactions from the blocks we'd drop that the new chain lacks: they go back to pending. */
  requeue: T[];
}

/**
 * Decide whether to switch to a peer's chain, and what to carry over.
 *
 * The choice weighs cadence first, not raw length: after the fork point,
 * each side scores the blocks that kept the 30-second rhythm (see
 * cadenceWeight). A chain with less paced history never wins, however many
 * blocks it has. With equal cadence weight, chains that share only the
 * genesis block (they grew apart before peers shared blocks) go to the
 * longer one, then the lowest tip hash, so every peer lands on the same
 * chain; chains with more shared history go to `resolve` (the UQRC fork
 * choice). Either way, every transaction in a block we drop that the new
 * chain lacks goes back to pending, so no balance is lost.
 */
export function planAdoption<T extends TxLike>(
  local: ChainBlockLike<T>[],
  incoming: ChainBlockLike<T>[],
  resolve: (local: ChainBlockLike<T>[], incoming: ChainBlockLike<T>[]) => 'keep' | 'replace',
  now: number = Date.now(),
): AdoptionPlan<T> {
  const point = forkPoint(local, incoming);
  const keep = { replace: false, forkPoint: point, requeue: [] as T[] };
  if (incoming.length === 0 || local.length === 0) return keep;
  if (incoming[0].hash !== local[0].hash) return keep; // different genesis: not our network
  const localTip = local[local.length - 1];
  const incomingTip = incoming[incoming.length - 1];
  if (localTip.hash === incomingTip.hash) return keep;
  if (point >= incoming.length) return keep; // theirs is a prefix of ours

  const ancestorTime = blockTime(local[point - 1] ?? {});
  const ours = cadenceWeight(local.slice(point), ancestorTime, now).weight;
  const theirs = cadenceWeight(incoming.slice(point), ancestorTime, now).weight;

  let replace: boolean;
  if (theirs !== ours) {
    replace = theirs > ours;
  } else if (point <= 1) {
    replace = incoming.length > local.length
      || (incoming.length === local.length && incomingTip.hash < localTip.hash);
  } else {
    replace = resolve(local, incoming) === 'replace';
  }
  if (!replace) return keep;

  const included = new Set(incoming.flatMap((block) => block.transactions.map((tx) => tx.id)));
  const seen = new Set<string>();
  const requeue: T[] = [];
  for (const block of local.slice(point)) {
    for (const tx of block.transactions) {
      if (included.has(tx.id) || seen.has(tx.id)) continue;
      seen.add(tx.id);
      requeue.push(tx);
    }
  }
  return { replace: true, forkPoint: point, requeue };
}
