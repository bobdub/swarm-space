import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  beginEarthFrame,
  endEarthFrame,
  getEarthPose,
  setEarthPoseTime,
  worldPosToLocalNormal,
  type Vec3,
} from '../../earth';
import { UqrcPhysics, PHYSICS_HZ } from '../../uqrcPhysics';
import { isSwimmingAt } from '../../groundHeight';
import { _resetDecksForTest } from '../deckSupport';
import { toBoatFrame } from '../boatDeck';
import { getVillageDockSite, starboardOf } from '../dockSite';
import {
  MAX_ROWERS,
  ROW_CALM_SEA,
  ROW_ROUGH_SEA,
  SEA_MAX,
  Vessel,
  _resetVillageBoatForTest,
  hullCapsule,
  resolveHullContact,
  rowersAllowed,
} from '../vessel';
import { OAR_SPOTS } from '../boatLayout';
import {
  Fleet,
  OARS_SPOT,
  decodeBoatPresence,
  deadReckon,
  deckPointOn,
  encodeVessel,
  frameOf,
  getFleet,
  type FleetBoat,
} from '../fleet';
import { _resetCrewForTest, setCrewInput, setFoodPurse, takeRole } from '../crew';
import { boatActionFor, mountVillageBoat } from '../villageBoat';

const T0 = (Date.UTC(2026, 10, 20) - Date.UTC(2026, 0, 1)) / 1000;
const DT = 1 / PHYSICS_HZ;
const CALM = (): Vec3 => [0, 0, 0];

function angle(a: Vec3, b: Vec3): number {
  // atan2 of |a×b| and a·b: exact for tiny angles and for vectors a
  // hair off unit length (the wire rounds to 1e-8).
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}
const metres = (a: Vec3, b: Vec3) => angle(a, b) * EARTH_RADIUS;

let t = T0;
function advance() {
  t += DT;
  setEarthPoseTime(t);
  endEarthFrame(); beginEarthFrame();
}

beforeEach(() => {
  t = T0;
  setEarthPoseTime(t); endEarthFrame(); beginEarthFrame();
  _resetVillageBoatForTest();
  _resetCrewForTest();
});
afterEach(() => {
  _resetDecksForTest();
  _resetCrewForTest();
  setEarthPoseTime(null);
});

describe('boat presence on the wire', () => {
  it('round-trips through JSON and rejects junk', () => {
    const v = new Vessel('x', 0, { n: getVillageDockSite()!.boatCenter, heading: getVillageDockSite()!.boatHeading });
    v.motion.vel = [0.5, -0.25, 0.125];
    v.cmd.sail = 0.75; v.cmd.wheel = -0.5; v.people = 3; v.heave.sink = 0.02;
    const wire = { v: encodeVessel('dock-1', v, 1234.5), d: { o: 'peerA', id: 'dock-1', x: 0.3, z: -1.2 }, r: { o: 'peerA', id: 'dock-1', s: 1, tn: -0.5 } };
    const back = decodeBoatPresence(JSON.parse(JSON.stringify(wire)))!;
    expect(back).toEqual(wire);
    expect(metres(back.v!.n, v.motion.n)).toBeLessThan(0.001);
    expect(decodeBoatPresence({ v: { id: 'x', n: [1, 2] } })).toBeUndefined();
    expect(decodeBoatPresence('boat')).toBeUndefined();
    expect(decodeBoatPresence({ d: { o: null, id: 'dock', x: 1, z: 2 } })).toEqual({ d: { o: null, id: 'dock', x: 1, z: 2 } });
  });

  it('dead-reckons a sailing, turning boat to within 0.5 m after 1 s', () => {
    const site = getVillageDockSite()!;
    const v = new Vessel('x', 0, { n: site.boatCenter, heading: site.boatHeading });
    const wind = (b: Vessel): Vec3 => { const s = starboardOf(b.motion.n, b.motion.heading); return [s[0] * 0.9, s[1] * 0.9, s[2] * 0.9]; };
    v.cmd.sail = 1;
    for (let i = 0; i < 60 * 30; i++) v.stepMotion(DT, wind(v));
    v.cmd.wheel = 0.4;
    for (let i = 0; i < 60 * 3; i++) v.stepMotion(DT, wind(v));
    const wire = encodeVessel('x', v, 100);
    for (let i = 0; i < 60; i++) v.stepMotion(DT, wind(v));
    const at = deadReckon(wire, 101);
    expect(v.speed()).toBeGreaterThan(5);
    expect(metres(at.n, v.motion.n)).toBeLessThan(0.5);
  });

  it("a silent owner's boat drifts to a stop", () => {
    const site = getVillageDockSite()!;
    const v = new Vessel('x', 0, { n: site.boatCenter, heading: site.boatHeading });
    v.motion.vel = [site.boatHeading[0] * 5, site.boatHeading[1] * 5, site.boatHeading[2] * 5];
    const wire = encodeVessel('x', v, 0);
    const a = deadReckon(wire, 20);
    const b = deadReckon(wire, 60);
    expect(metres(a.n, b.n)).toBeLessThan(0.1);
    expect(metres(site.boatCenter, b.n)).toBeLessThan(5 * 5.01);
  });
});

describe('remote strokes', () => {
  it('takes one stroke per presence, so a quiet rower lapses even while replayed', () => {
    const A = new Fleet({ selfPeer: () => 'peerA', registerDecks: false, localCrew: false });
    const aBoat = A.claimDock()!;
    const r = { o: 'peerA', id: aBoat.wireId, s: 1, tn: 0 };
    A.remoteRow('peerB', r, 10, 5000);
    expect(aBoat.rowers.get('peerB')?.at).toBe(10);
    // The same presence replayed later (another peer's update re-ran the
    // scene effect) does not refresh the stroke.
    for (let i = 1; i <= 30; i++) { t = 10 + i * 0.1; setEarthPoseTime(t); A.remoteRow('peerB', r, t, 5000); }
    expect(aBoat.rowers.get('peerB')?.at).toBe(10);
    advance();
    A.tick(null, DT, CALM);
    expect(aBoat.rowers.has('peerB')).toBe(false);
    expect(aBoat.vessel.cmd.row).toBe(0);
    // A fresh presence does.
    A.remoteRow('peerB', r, t, 5333);
    expect(aBoat.rowers.get('peerB')?.at).toBe(t);
  });
});

describe('several rowers', () => {
  /** Peers B.. pull every tick on A's boat for `secs`; returns the boat. */
  function rowWith(rowers: number, sea: number, secs = 6) {
    const A = new Fleet({ selfPeer: () => 'peerA', registerDecks: false, localCrew: false });
    const boat = A.claimDock()!;
    const start = boat.vessel.motion.n;
    let stamp = 0;
    let maxRow = 0;
    for (let i = 0; i < secs * PHYSICS_HZ; i++) {
      advance();
      for (let k = 0; k < rowers; k++) {
        A.remoteRow(`rower${k}`, { o: 'peerA', id: boat.wireId, s: 1, tn: 0 }, t, ++stamp);
      }
      boat.vessel.sea = sea;
      boat.vessel.seaTarget = sea;
      A.tick(null, DT, CALM);
      maxRow = Math.max(maxRow, boat.vessel.cmd.row);
    }
    return { maxRow, moved: metres(start, boat.vessel.motion.n) };
  }

  it('every bench pulls together on a calm day, and the boat goes faster for it', () => {
    expect(OAR_SPOTS).toHaveLength(MAX_ROWERS);
    expect(rowersAllowed(1)).toBe(MAX_ROWERS);
    expect(rowersAllowed(ROW_CALM_SEA)).toBe(MAX_ROWERS);
    const one = rowWith(1, 1);
    const six = rowWith(6, 1);
    expect(one.maxRow).toBe(1);
    expect(six.maxRow).toBe(6);
    expect(six.moved).toBeGreaterThan(one.moved * 2);
  });

  it('a rough sea lets fewer strokes count, down to one in a gale', () => {
    expect(rowersAllowed(ROW_ROUGH_SEA)).toBe(1);
    expect(rowersAllowed(SEA_MAX)).toBe(1);
    const mid = rowersAllowed((ROW_CALM_SEA + ROW_ROUGH_SEA) / 2);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(MAX_ROWERS);
    expect(rowWith(6, SEA_MAX, 1).maxRow).toBe(1);
  });

  it('a rower on each oar place is offered that place', () => {
    const A = getFleet();
    const boat = A.dock()!;
    for (const [x, z] of OAR_SPOTS) {
      const a = boatActionFor(deckPointOn(boat, x, z + 0.1));
      expect(a).toMatchObject({ kind: 'take', role: 'oars', spot: [x, z] });
    }
  });
});

describe('hulls bump instead of passing through', () => {
  it('pushes an overlapping boat clear and stops it closing', () => {
    const site = getVillageDockSite()!;
    const other = hullCapsule(site.boatCenter, site.boatHeading);
    const s = starboardOf(site.boatCenter, site.boatHeading);
    const v = new Vessel('x', 0, { n: site.boatCenter, heading: site.boatHeading });
    // Overlapping, 1 m to starboard, moving toward the other hull.
    v.motion = { ...v.motion, n: (() => { const n: Vec3 = [site.boatCenter[0] + s[0] / EARTH_RADIUS, site.boatCenter[1] + s[1] / EARTH_RADIUS, site.boatCenter[2] + s[2] / EARTH_RADIUS]; const l = Math.hypot(...n); return [n[0] / l, n[1] / l, n[2] / l] as Vec3; })(), vel: [-s[0] * 2, -s[1] * 2, -s[2] * 2] };
    const out = resolveHullContact(v.motion, other);
    expect(metres(out.n, site.boatCenter)).toBeGreaterThan(2.59);
    const closing = out.vel[0] * -s[0] + out.vel[1] * -s[1] + out.vel[2] * -s[2];
    expect(closing).toBeLessThan(1e-6);
  });
});

describe('two worlds, one sail', () => {
  type P = UqrcPhysics & { tick(): void };

  function walker(physics: P, id: string, pos: [number, number, number]) {
    physics.addBody({ id, kind: id === 'self' ? 'self' : 'avatar', pos, vel: [0, 0, 0], mass: 1, trust: 0.5, meta: { attachedTo: 'earth-surface' } });
  }
  function placeOnBoat(physics: P, id: string, boat: FleetBoat) {
    const pose = getEarthPose();
    const b = physics.getBody(id)!;
    const r = Math.hypot(b.pos[0] - pose.center[0], b.pos[1] - pose.center[1], b.pos[2] - pose.center[2]);
    const n = worldPosToLocalNormal(b.pos, pose);
    const { x, z } = toBoatFrame(frameOf(boat), n, EARTH_RADIUS);
    return { x, z, n, feet: r - BODY_SHELL_RADIUS - FOOT_CUSHION };
  }

  it('B stands on A\'s boat while A sails it; the dock refills; B swims when A leaves', () => {
    const site = getVillageDockSite()!;
    // World A: the owner, no bodies of its own here (registerDecks off so
    // both worlds can share this test process).
    const A = new Fleet({ selfPeer: () => 'peerA', registerDecks: false, localCrew: false });
    const aBoat = A.claimDock()!;
    expect(aBoat.kind).toBe('mine');
    aBoat.vessel.cmd.sail = 1;
    const wind = (n: Vec3): Vec3 => { const s = starboardOf(n, aBoat.vessel.motion.heading); return [s[0] * 0.9, s[1] * 0.9, s[2] * 0.9]; };

    // World B: the viewer, with physics and decks.
    const B = getFleet();
    B.setSelfPeer(() => 'peerB');
    const physics = new UqrcPhysics() as P;
    const unmount = mountVillageBoat(physics, { wind: CALM });
    B.applyRemote('peerA', A.presenceFor(null)!.v, t);
    const bBoat = B.list().find((b) => b.kind === 'remote')!;
    expect(bBoat).toBeTruthy();
    walker(physics, 'self', deckPointOn(bBoat, 0.3, -0.8));

    let worstBoat = 0;
    let worstSlide = 0;
    let start: { x: number; z: number } | null = null;
    for (let i = 0; i < 60 * 20; i++) {
      advance();
      A.tick(null, DT, wind);
      if (i % 20 === 0) {
        const p = A.presenceFor(null)!;
        // B's presence sends its deck spot; round-trip it through JSON as the mesh would.
        B.applyRemote('peerA', decodeBoatPresence(JSON.parse(JSON.stringify(p)))!.v, t);
      }
      physics.tick();
      if (i === 60) start = placeOnBoat(physics, 'self', bBoat);
      if (i > 60) {
        worstBoat = Math.max(worstBoat, metres(bBoat.vessel.motion.n, aBoat.vessel.motion.n));
        const q = placeOnBoat(physics, 'self', bBoat);
        worstSlide = Math.max(worstSlide, Math.hypot(q.x - start!.x, q.z - start!.z));
      }
    }
    expect(metres(aBoat.vessel.motion.n, site.boatCenter)).toBeGreaterThan(60);
    expect(worstBoat).toBeLessThan(0.5);
    expect(worstSlide).toBeLessThan(0.15);
    // B's own presence puts B on A's boat.
    const bp = B.presenceFor(physics.getBody('self')!.pos)!;
    expect(bp.d).toMatchObject({ o: 'peerA', id: aBoat.wireId });
    // In A's world, that deck spot resolves to A's own boat.
    expect(A.resolveDeck(bp.d!)).toBe(aBoat);

    // The dock refilled once A sailed clear, in both worlds.
    const aDock = A.dock()!;
    expect(aDock.key).not.toBe(aBoat.key);
    expect(aDock.visible).toBe(true);
    expect(B.dock()!.visible).toBe(true);

    // Only the owner takes the wheel: B by A's helm is offered nothing.
    const helmPos = deckPointOn(bBoat, 0, 3.0);
    expect(boatActionFor(helmPos)?.kind === 'take' && (boatActionFor(helmPos) as { role: string }).role === 'helm').toBe(false);

    // A leaves the room: the boat goes, B drops into the sea and swims.
    B.retainPeers(new Set());
    expect(B.list().some((b) => b.kind === 'remote')).toBe(false);
    for (let i = 0; i < 60 * 4; i++) { advance(); physics.tick(); }
    const pose = getEarthPose();
    const self = physics.getBody('self')!;
    const r = Math.hypot(self.pos[0] - pose.center[0], self.pos[1] - pose.center[1], self.pos[2] - pose.center[2]);
    expect(isSwimmingAt(worldPosToLocalNormal(self.pos, pose), r - BODY_SHELL_RADIUS - FOOT_CUSHION)).toBe(true);
    unmount();
  });

  it('a rower on someone else\'s boat pushes it in the owner\'s world, and pays in Food', () => {
    const A = new Fleet({ selfPeer: () => 'peerA', registerDecks: false, localCrew: false });
    const aBoat = A.claimDock()!;
    const n0 = aBoat.vessel.motion.n;
    const B = getFleet();
    B.setSelfPeer(() => 'peerB');
    let food = 5;
    setFoodPurse({ has: () => food > 0, spendOne: () => (food > 0 ? (food--, true) : false) });
    const physics = new UqrcPhysics() as P;
    const unmount = mountVillageBoat(physics, { wind: CALM });
    B.applyRemote('peerA', A.presenceFor(null)!.v, t);
    const bBoat = B.list().find((b) => b.kind === 'remote')!;
    walker(physics, 'self', deckPointOn(bBoat, OARS_SPOT[0], OARS_SPOT[1]));
    for (let i = 0; i < 30; i++) { advance(); physics.tick(); }
    takeRole('oars', 'self', bBoat.key);
    setCrewInput({ row: 1 });
    for (let i = 0; i < 60 * 40; i++) {
      advance();
      if (i % 20 === 0) {
        const bp = B.presenceFor(physics.getBody('self')!.pos)!;
        if (bp.r) A.remoteRow('peerB', decodeBoatPresence(JSON.parse(JSON.stringify(bp)))!.r!, t);
        B.applyRemote('peerA', A.presenceFor(null)!.v, t);
      }
      A.tick(null, DT, CALM);
      physics.tick();
    }
    expect(aBoat.vessel.speed()).toBeGreaterThan(1.7);
    const rowed = metres(aBoat.vessel.motion.n, n0);
    expect(rowed).toBeGreaterThan(60);
    expect(5 - food).toBeGreaterThanOrEqual(1);
    // B is still at the oars, on the boat, in B's world.
    const q = placeOnBoat(physics, 'self', bBoat);
    expect(Math.hypot(q.x - OARS_SPOT[0], q.z - OARS_SPOT[1])).toBeLessThan(0.1);
    // Rowing stops when B goes quiet: the owner drops the stroke after 1 s.
    setCrewInput({ row: 0 });
    for (let i = 0; i < 60 * 30; i++) { advance(); A.tick(null, DT, CALM); }
    expect(aBoat.vessel.speed()).toBeLessThan(0.3);
    unmount();
  });
});
