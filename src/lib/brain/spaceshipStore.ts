import { useSyncExternalStore } from 'react';
import { validShipState, padAvailableAt, type ShipState } from './spaceshipRules';

const ships = new Map<string, { state: ShipState; heard: number }>();
const listeners = new Set<() => void>();
let revision = 0;
const key = (room: string, peer: string) => `${room}|${peer}`;
function emit() { revision++; listeners.forEach(fn => fn()); }
export function useShipsVersion() { return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => revision, () => revision); }
export function getShips(room: string): ShipState[] { return [...ships.values()].filter(x => x.state.roomId === room).map(x => x.state); }
export function getPilotShip(room: string, peer: string): ShipState | undefined { const s = ships.get(key(room, peer))?.state; return s && s.phase !== 'ended' && s.phase !== 'claim' ? s : undefined; }
export function setLocalShip(s: ShipState) { ships.set(key(s.roomId, s.pilotPeerId), { state: { ...s }, heard: Date.now() }); emit(); }
export function acceptShip(value: unknown, sender: string, room: string, now = Date.now()): boolean {
  if (!validShipState(value, sender, room)) return false;
  const old = ships.get(key(room, sender));
  if (old && (value.startedAt < old.state.startedAt || (value.session === old.state.session && value.seq <= old.state.seq))) return false;
  if (old && value.session !== old.state.session && value.startedAt === old.state.startedAt) return false;
  if (old?.state.phase === 'ended' && value.session === old.state.session) return false;
  ships.set(key(room, sender), { state: { ...value }, heard: now }); emit(); return true;
}
export function removeShip(room: string, peer: string) { if (ships.delete(key(room, peer))) emit(); }
export function sweepShips(room: string, peers: Set<string>, now = Date.now()) {
  for (const [id, rec] of ships) if (rec.state.roomId === room && (!peers.has(rec.state.pilotPeerId) || now - rec.heard > 15_000)) { ships.delete(id); emit(); }
}
export function padClaim(room: string, now = Date.now()): ShipState | undefined {
  return getShips(room).filter(s => s.phase !== 'ended' && (s.phase === 'claim' || now < padAvailableAt(s.startedAt)))
    .sort((a, b) => a.startedAt - b.startedAt || a.pilotPeerId.localeCompare(b.pilotPeerId))[0];
}
export function resetShips() { ships.clear(); emit(); }