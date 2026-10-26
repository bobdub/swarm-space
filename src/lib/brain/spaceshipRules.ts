import { Vector3, Quaternion, Euler } from 'three';
import { C_LIGHT } from './lightspeed';

export const LAUNCH_SWARM = 5;
// Same 100:1 engagement-credit denomination used by the native economy.
export const LAUNCH_CREDITS = 500;
export const BOARD_HOLD_MS = 2500;
export const COUNTDOWN_MS = 10_000;
export const REPLACEMENT_MS = 10_000;
export const ASCENT_MS = 16_000;
export const SPACE_ALTITUDE = 750;
export const FLIGHT_SPEED = Math.min(180, C_LIGHT * 0.01);
export type ShipPhase = 'claim' | 'countdown' | 'launch' | 'flight' | 'return' | 'ended';
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export interface ShipState {
  version: 1; roomId: string; pilotPeerId: string; pilotId: string;
  session: string; seq: number; startedAt: number; phase: ShipPhase;
  position: V3; quaternion: Q4; velocity: V3; avatarId: string;
}
export function launchPayment(swarm: number, credits: number) {
  if (Number.isFinite(swarm) && swarm >= LAUNCH_SWARM) return { asset: 'swarm' as const, amount: LAUNCH_SWARM };
  if (Number.isFinite(credits) && credits >= LAUNCH_CREDITS) return { asset: 'credits' as const, amount: LAUNCH_CREDITS };
  return null;
}
export function countdownAt(start: number, now: number): number {
  return Math.max(0, Math.ceil((start + COUNTDOWN_MS - now) / 1000));
}
export function padAvailableAt(start: number): number { return start + COUNTDOWN_MS + REPLACEMENT_MS; }
export function validShipState(value: unknown, sender: string, room: string): value is ShipState {
  if (!value || typeof value !== 'object') return false;
  const s = value as ShipState;
  const vec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e7);
  return s.version === 1 && s.roomId === room && s.pilotPeerId === sender
    && typeof s.pilotId === 'string' && s.pilotId.length < 128
    && typeof s.session === 'string' && s.session.length > 0 && s.session.length < 128
    && Number.isSafeInteger(s.seq) && s.seq > 0 && Number.isFinite(s.startedAt)
    && ['claim', 'countdown', 'launch', 'flight', 'return', 'ended'].includes(s.phase)
    && typeof s.avatarId === 'string' && s.avatarId.length < 64
    && vec(s.position, 3) && vec(s.velocity, 3) && Math.hypot(...s.velocity) <= FLIGHT_SPEED + 1
    && vec(s.quaternion, 4) && Math.abs(Math.hypot(...s.quaternion) - 1) < 0.01;
}
export interface FlightInput { throttle: number; yaw: number; pitch: number; brake: boolean }
const turn = new Quaternion(), direction = new Vector3(), vel = new Vector3(), pos = new Vector3();
export function advanceFlight(s: ShipState, input: FlightInput, rawDt: number): void {
  const dt = Math.max(0, Math.min(rawDt, 0.05));
  const q = new Quaternion(...s.quaternion);
  turn.setFromEuler(new Euler(input.pitch * dt * 0.85, -input.yaw * dt * 0.85, 0, 'YXZ'));
  q.multiply(turn).normalize();
  direction.set(0, 0, -1).applyQuaternion(q);
  vel.set(...s.velocity).addScaledVector(direction, input.throttle * 100 * dt);
  vel.multiplyScalar(Math.exp(-(input.brake ? 5 : 0.35) * dt)).clampLength(0, FLIGHT_SPEED);
  pos.set(...s.position).addScaledVector(vel, dt);
  s.position = pos.toArray() as V3; s.velocity = vel.toArray() as V3; s.quaternion = q.toArray() as Q4;
}