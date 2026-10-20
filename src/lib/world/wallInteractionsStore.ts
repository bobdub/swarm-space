/**
 * Append-only viewer interactions on walls (Reinforce + Graffiti).
 * Kept separate from owner-gated placement records so visitors never mutate
 * the wall itself. Local cache + BroadcastChannel + mesh gossip.
 */
export interface WallInteraction {
  id: string;
  placementId: string;
  kind: 'reinforce' | 'graffiti';
  actorId: string;
  emoji?: string;
  at: number;
}

const KEY = 'swarm:world:wall-interactions';
const CHANNEL = 'swarm:world:wall-interactions';
const MAX = 5000;
const items = new Map<string, WallInteraction>();
const listeners = new Set<() => void>();
let bc: BroadcastChannel | null = null;
let started = false;

function valid(v: unknown): v is WallInteraction {
  const r = v as WallInteraction;
  return !!r && typeof r.id === 'string' && typeof r.placementId === 'string' &&
    typeof r.actorId === 'string' && (r.kind === 'reinforce' || r.kind === 'graffiti') &&
    typeof r.at === 'number' && (r.kind !== 'graffiti' || (typeof r.emoji === 'string' && r.emoji.length <= 8));
}

function persist() {
  try {
    const all = [...items.values()].sort((a, b) => a.at - b.at).slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

function accept(v: unknown): boolean {
  if (!valid(v) || items.has(v.id)) return false;
  items.set(v.id, v);
  persist();
  listeners.forEach((l) => l());
  return true;
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  try { (JSON.parse(localStorage.getItem(KEY) || '[]') as unknown[]).forEach((v) => valid(v) && items.set(v.id, v)); } catch { /* ignore */ }
  try { bc = new BroadcastChannel(CHANNEL); bc.onmessage = (e) => accept(e.data); } catch { /* ignore */ }
  void import('@/lib/p2p/swarmMesh.standalone').then(({ getSwarmMeshStandalone }) => {
    getSwarmMeshStandalone().onMessage('wall-interactions', (_p, payload) => {
      if (Array.isArray(payload)) payload.forEach(accept); else accept(payload);
    });
  }).catch(() => {});
}

export function recordWallInteraction(rec: Omit<WallInteraction, 'id' | 'at'>): WallInteraction {
  start();
  const full: WallInteraction = { ...rec, id: crypto.randomUUID(), at: Date.now() };
  accept(full);
  try { bc?.postMessage(full); } catch { /* ignore */ }
  void import('@/lib/p2p/swarmMesh.standalone')
    .then(({ getSwarmMeshStandalone }) => getSwarmMeshStandalone().broadcast('wall-interactions', full))
    .catch(() => {});
  return full;
}

/** Interactions for a wall, excluding any made by the wall's owner. */
export function listWallInteractions(placementId: string, ownerId: string): WallInteraction[] {
  start();
  return [...items.values()].filter((i) => i.placementId === placementId && i.actorId !== ownerId);
}

export function subscribeWallInteractions(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _acceptWallInteractionForTest(v: unknown): boolean { return accept(v); }
export function _resetWallInteractionsForTest() { items.clear(); }
