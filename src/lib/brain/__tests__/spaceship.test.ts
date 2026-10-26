import { describe, it, expect, beforeEach } from 'vitest';
import { launchPayment, countdownAt, padAvailableAt, advanceFlight, FLIGHT_SPEED, type ShipState } from '../spaceshipRules';
import { acceptShip, getPilotShip, resetShips, padClaim, sweepShips } from '../spaceshipStore';
import { UqrcPhysics } from '../uqrcPhysics';
import { shipPadPose, shipSiteNormal } from '../spaceshipSite';
import { groundElevationAt } from '../groundHeight';

function state(): ShipState { return { version: 1, roomId: 'room', pilotPeerId: 'peer-a', pilotId: 'user-a', session: 'one', seq: 1, startedAt: 1000, phase: 'countdown', position: [100, 200, 300], quaternion: [0, 0, 0, 1], velocity: [0, 0, 0], avatarId: 'rabbit' }; }
beforeEach(resetShips);
describe('spaceship launch rules', () => {
  it('charges five SWARM first', () => { expect(launchPayment(5, 1000)).toEqual({ asset: 'swarm', amount: 5 }); });
  it('falls back to game credits at the existing 100:1 denomination', () => { expect(launchPayment(0, 500)).toEqual({ asset: 'credits', amount: 500 }); expect(launchPayment(0, 499)).toBeNull(); });
  it('counts down from ten before launch', () => { expect(countdownAt(1000, 1000)).toBe(10); expect(countdownAt(1000, 10_000)).toBe(1); expect(countdownAt(1000, 11_000)).toBe(0); });
  it('replaces a ship ten seconds after departure', () => { expect(padAvailableAt(1000)).toBe(21_000); acceptShip(state(), 'peer-a', 'room', 1000); expect(padClaim('room', 20_999)).toBeDefined(); expect(padClaim('room', 21_000)).toBeUndefined(); });
  it('spawns on real dry terrain', () => { expect(groundElevationAt(shipSiteNormal())).toBeGreaterThan(2); expect(shipPadPose().position.every(Number.isFinite)).toBe(true); });
});
describe('pilot-owned shared ships', () => {
  it('rejects impersonation, wrong rooms, malformed orientations', () => { expect(acceptShip(state(), 'peer-b', 'room')).toBe(false); expect(acceptShip(state(), 'peer-a', 'elsewhere')).toBe(false); expect(acceptShip({ ...state(), quaternion: [0, 0, 0, 0] }, 'peer-a', 'room')).toBe(false); });
  it('rejects reordered frames and cannot resurrect an ended flight', () => { expect(acceptShip(state(), 'peer-a', 'room')).toBe(true); expect(acceptShip(state(), 'peer-a', 'room')).toBe(false); expect(acceptShip({ ...state(), seq: 2, phase: 'ended' }, 'peer-a', 'room')).toBe(true); expect(acceptShip({ ...state(), seq: 3 }, 'peer-a', 'room')).toBe(false); });
  it('removes departed and silent pilots', () => { acceptShip(state(), 'peer-a', 'room', 1000); sweepShips('room', new Set(['peer-a']), 16_001); expect(getPilotShip('room', 'peer-a')).toBeUndefined(); acceptShip(state(), 'peer-a', 'room', 1000); sweepShips('room', new Set(), 1001); expect(getPilotShip('room', 'peer-a')).toBeUndefined(); });
});
describe('space controls', () => {
  it('thrust follows the window direction and caps speed below causal light', () => { const s = state(); for (let i = 0; i < 1000; i++) advanceFlight(s, { throttle: 1, yaw: 0, pitch: 0, brake: false }, 0.05); expect(s.position[2]).toBeLessThan(300); expect(Math.hypot(...s.velocity)).toBeLessThanOrEqual(FLIGHT_SPEED); });
  it('braking uses frame-rate independent damping', () => { const a = state(), b = state(); a.velocity = [0, 0, -100]; b.velocity = [0, 0, -100]; for (let i = 0; i < 20; i++) advanceFlight(a, { throttle: 0, yaw: 0, pitch: 0, brake: true }, 0.05); for (let i = 0; i < 100; i++) advanceFlight(b, { throttle: 0, yaw: 0, pitch: 0, brake: true }, 0.01); expect(a.velocity[2]).toBeCloseTo(b.velocity[2], 6); });
  it('the passenger lease survives gravity ticks and stale release cannot steal control', () => {
    const p = new UqrcPhysics(); p.addBody({ id: 'pilot', kind: 'self', pos: [100, 200, 300], vel: [0, 0, 0], mass: 1, trust: 1, meta: { attachedTo: 'earth-surface' } });
    const lease = p.acquireBodyControl('pilot'); if (!lease) throw new Error('Missing lease');
    expect(p.acquireBodyControl('pilot')).toBeNull(); lease.update([100, 200, 300]);
    (p as unknown as { tick(): void }).tick(); expect(p.getBody('pilot')?.pos).toEqual([100, 200, 300]); expect(p.getBody('pilot')?.local).toBeUndefined();
    lease.release(); const newer = p.acquireBodyControl('pilot'); lease.release(); expect(p.isBodyControlled('pilot')).toBe(true); newer?.release(); expect(p.isBodyControlled('pilot')).toBe(false);
  });
});