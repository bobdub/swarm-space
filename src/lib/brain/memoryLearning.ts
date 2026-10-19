/**
 * Phase 2 — Infinity learns from its passive memory.
 *
 * 1. Backfill: posts/comments already synced to this device (never fed live)
 *    are copied into Infinity memory. Local reads only — no mesh requests.
 * 2. Learn: unlearned pieces are fed in small idle-time batches through the
 *    shared neural engine (Dual A: pattern learner, Dual B: language learner
 *    smoothed by the UQRC field), then marked learned so nothing repeats.
 */
import { enqueueMemory, flushMemory, hasMemory, isPrivatePost, markLearned, readMemory, type MemoryPiece } from './infinityMemory';
import type { ContentEvent } from '@/lib/p2p/dualLearningFusion';

export const LEARN_BATCH = 60;
const BACKFILL_CAP = 400;
const FIRST_DELAY_MS = 20_000;
const INTERVAL_MS = 120_000;
const ENTITY_ID = 'peer-network-entity';

/** Unlearned pieces, oldest first, capped to one batch. */
export function selectUnlearned(pieces: MemoryPiece[], batch = LEARN_BATCH): MemoryPiece[] {
  return pieces.filter((p) => !p.learned).sort((a, b) => a.ts - b.ts).slice(0, batch);
}

/** Posts weigh more than comments, comments more than chat. */
export function pieceToEvent(piece: MemoryPiece): ContentEvent {
  const weight = piece.kind === 'post' ? 3 : piece.kind === 'comment' ? 2 : 1;
  return {
    text: piece.text,
    reactions: weight,
    comments: piece.kind === 'post' ? 1 : 0,
    shares: 0,
    trustScore: 60,
    peerId: piece.authorHash,
    timestamp: piece.ts,
  };
}

export async function backfillMemory(): Promise<number> {
  try {
    const { getAll } = await import('@/lib/store');
    const [posts, comments] = await Promise.all([
      getAll<Record<string, unknown>>('posts').catch(() => []),
      getAll<Record<string, unknown>>('comments').catch(() => []),
    ]);
    const candidates = [
      ...posts.filter((p) => p.author !== ENTITY_ID && !isPrivatePost(p)).map((p) => ({
        id: `post:${p.id}`, kind: 'post' as const, text: String(p.content ?? ''), author: String(p.author ?? ''), ts: Date.parse(String(p.createdAt ?? '')) || Date.now(),
      })),
      ...comments.filter((c) => c.author !== ENTITY_ID).map((c) => ({
        id: `comment:${c.id}`, kind: 'comment' as const, text: String(c.text ?? ''), author: String(c.author ?? ''), ts: Date.parse(String(c.createdAt ?? '')) || Date.now(),
      })),
    ].sort((a, b) => b.ts - a.ts).slice(0, BACKFILL_CAP);
    const existing = await hasMemory(candidates.map((c) => c.id));
    let added = 0;
    for (const c of candidates) {
      if (existing.has(c.id)) continue;
      enqueueMemory(c);
      added++;
    }
    await flushMemory();
    return added;
  } catch {
    return 0;
  }
}

export async function learnFromMemory(): Promise<number> {
  const batch = selectUnlearned(await readMemory(2000));
  if (!batch.length) return 0;
  const { getSharedNeuralEngine } = await import('@/lib/p2p/sharedNeuralEngine');
  const engine = getSharedNeuralEngine();
  for (const piece of batch) {
    try { engine.ingestContentEvent(pieceToEvent(piece)); } catch { /* skip */ }
  }
  try { engine.persistToStorage(); } catch { /* ignore */ }
  await markLearned(batch.map((p) => p.id));
  return batch.length;
}

let started = false;
function idle(fn: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 15_000 }); else setTimeout(fn, 0);
}

export function startMemoryLearning(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const tick = () => idle(() => { void learnFromMemory(); });
  setTimeout(() => idle(async () => {
    await backfillMemory();
    // Upgrade existing learned memory into whole-expression realization
    // without replaying pattern/vocabulary ingestion or learned markers.
    const { getSharedNeuralEngine } = await import('@/lib/p2p/sharedNeuralEngine');
    const learner = getSharedNeuralEngine().getDualLearning().languageLearner;
    for (const piece of (await readMemory(256)).reverse()) {
      if (piece.learned) learner.rememberExpressions(piece.text);
    }
    tick();
    setInterval(tick, INTERVAL_MS);
  }), FIRST_DELAY_MS);
}
