import { connectionCurvature, type ConnectionAffinity } from '@/lib/uqrc/namespaceIdentity';

interface LiveContact { peerId: string; userId?: string; connectedAt: number }
interface Session { since: number; peers: Set<string> }
const sessions = new Map<string, Map<string, Session>>();
const histories = new Map<string, Record<string, ConnectionAffinity>>();
const lastSaved = new Map<string, number>();
const key = (owner: string) => `swarm-connection-affinity:${owner}`;
function history(owner: string) {
  let value = histories.get(owner);
  if (!value) {
    try { value = JSON.parse(localStorage.getItem(key(owner)) || '{}'); } catch { value = {}; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    histories.set(owner, value);
  }
  return value;
}
function persist(owner: string, now: number, force = false) {
  if (!force && now - (lastSaved.get(owner) ?? 0) < 150_000) return;
  const saved = { ...history(owner) };
  for (const [id, session] of sessions.get(owner) ?? []) {
    const h = saved[id];
    if (h) saved[id] = { ...h, connectedDurationMs: h.connectedDurationMs + Math.max(0, now - session.since), lastInteractionAt: now };
  }
  try { localStorage.setItem(key(owner), JSON.stringify(saved)); lastSaved.set(owner, now); } catch { /* storage unavailable */ }
}
/** Union concurrent channels for the same canonical user; rotations do not erase history. */
export function observeConnections(owner: string, contacts: LiveContact[], now = Date.now()) {
  if (!owner) return;
  const active = sessions.get(owner) ?? new Map<string, Session>();
  sessions.set(owner, active);
  const grouped = new Map<string, LiveContact[]>();
  for (const c of contacts) {
    if (!c.userId || c.userId === owner) continue;
    grouped.set(c.userId, [...(grouped.get(c.userId) ?? []), c]);
  }
  const records = history(owner);
  let changed = false;
  for (const [id, session] of active) {
    if (grouped.has(id)) continue;
    const h = records[id];
    if (h) records[id] = { ...h, connectedDurationMs: h.connectedDurationMs + Math.max(0, now - session.since), lastInteractionAt: now };
    active.delete(id);
    changed = true;
  }
  for (const [id, channels] of grouped) {
    if (active.has(id)) continue;
    const prior = records[id] ?? { connectedDurationMs: 0, sessions: 0, lastInteractionAt: 0 };
    records[id] = { ...prior, sessions: prior.sessions + 1, lastInteractionAt: now };
    active.set(id, { since: Math.min(now, ...channels.map(c => c.connectedAt)), peers: new Set(channels.map(c => c.peerId)) });
    changed = true;
  }
  persist(owner, now, changed);
}
export function getConnectionAffinity(owner: string, userId: string, now = Date.now()): ConnectionAffinity {
  const h = history(owner)[userId] ?? { connectedDurationMs: 0, sessions: 0, lastInteractionAt: 0 };
  const live = sessions.get(owner)?.get(userId);
  return live ? { ...h, connectedDurationMs: h.connectedDurationMs + Math.max(0, now - live.since), lastInteractionAt: now } : { ...h };
}
export function affinityScore(owner: string, userId: string, now = Date.now()) {
  return connectionCurvature(getConnectionAffinity(owner, userId, now), now);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { for (const owner of sessions.keys()) persist(owner, Date.now(), true); });
}