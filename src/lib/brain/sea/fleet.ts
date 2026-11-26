/**
 * fleet — every boat in this player's world.
 *
 * Decided with bobdub: every player gets their own boat; anyone can board
 * any boat; only the owner takes its wheel.
 *
 * - The dock boat lies at the village berth, the same in every world.
 *   Taking its wheel or its oars makes it yours, and the dock refills: a
 *   fresh boat appears at the berth once yours has sailed clear.
 * - One boat each. Taking the dock boat again recalls your old boat if it
 *   is empty; if people are aboard it stays and you are told so.
 * - Your boat is simulated here (`vessel.ts`) and sent to the room in your
 *   presence (`BoatPresence.v`). Other players' boats arrive the same way
 *   and are dead-reckoned on the shared Earth clock, eased over 0.5 s.
 * - Everyone on a deck sends where on it they stand (`d`), so viewers draw
 *   them on that deck spot instead of at a lagging world position.
 * - A rower on someone else's boat sends their stroke (`r`); the owner's
 *   world adds it as a force and drops it after 1 s of silence. Food is
 *   spent on the rower's own device.
 * - Owner silent for 3 s: the boat drifts to a stop. Owner gone: the boat
 *   is removed and anyone aboard drops into the sea and swims.
 * - Every visible boat registers its deck and walls, so you can stand on,
 *   swim against and bump into anyone's boat. Boats you sail push off
 *   other hulls and the jetty instead of passing through.
 */

import {
  BODY_SHELL_RADIUS,
  EARTH_RADIUS,
  FOOT_CUSHION,
  earthLocalToWorld,
  getEarthPose,
  getEarthPoseTime,
  quatRotate,
  type Vec3,
} from '../earth';
import type { UqrcPhysics } from '../uqrcPhysics';
import { HALF_L, railHalfWidthAt } from './boatHull';
import { boatDeck, fromBoatFrame, toBoatFrame, type BoatFrame } from './boatDeck';
import { registerDeckSurface } from './deckSupport';
import { JETTY_WIDTH, getVillageDockSite, starboardOf, travel } from './dockSite';
import {
  Vessel,
  hullCapsule,
  newDockVessel,
  onVesselReset,
  resolveHullContact,
  rowersAllowed,
  seaStateFor,
  type Capsule,
} from './vessel';
import { HELM_SPOT, OARS_SPOT } from './boatLayout';
import { ROD_SPOTS, updateFishing } from './fishing';
import {
  canRow,
  chargeRowing,
  getCrewBoatKey,
  getCrewInput,
  getCrewRole,
  getCrewSelfId,
  getCrewSpot,
  leaveRole,
  setCrewBoatKey,
  type CrewRole,
} from './crew';

// ── Wire format ─────────────────────────────────────────────────────

/** The owner's boat, as sent in presence. */
export interface VesselWire {
  id: string;
  /** Centre (Earth-local unit normal). */
  n: Vec3;
  /** Heading (Earth-local unit tangent). */
  h: Vec3;
  /** Velocity (Earth-local tangent, m/s). */
  v: Vec3;
  /** Turn rate (rad/s). */
  yr: number;
  /** Wheel −1..1, sail 0..1. */
  w: number;
  s: number;
  /** Load sinkage (m) and people aboard. */
  k: number;
  p: number;
  /** Shared Earth clock at the moment of this state (s). */
  t: number;
}

/** Where a player stands on a deck. `o` is the owner's peer id (null for
 *  the dock boat, which is the same boat in every world). */
export interface DeckWire {
  o: string | null;
  id: string;
  x: number;
  z: number;
}

/** A rower's stroke on someone else's boat. */
export interface RowWire {
  o: string;
  id: string;
  s: number;
  tn: number;
}

export interface BoatPresence {
  v?: VesselWire;
  d?: DeckWire;
  r?: RowWire;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r8 = (x: number) => Math.round(x * 1e8) / 1e8;
const v8 = (v: Vec3): Vec3 => [r8(v[0]), r8(v[1]), r8(v[2])];

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isVec(x: unknown): x is Vec3 {
  return Array.isArray(x) && x.length === 3 && x.every(isNum);
}
function isStr(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0 && x.length < 128;
}

/** Validate a presence `boat` field from the network. Unknown → undefined. */
export function decodeBoatPresence(raw: unknown): BoatPresence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: BoatPresence = {};
  const v = o.v as Record<string, unknown> | undefined;
  if (v && typeof v === 'object' && isStr(v.id) && isVec(v.n) && isVec(v.h) && isVec(v.v)
    && isNum(v.yr) && isNum(v.w) && isNum(v.s) && isNum(v.k) && isNum(v.p) && isNum(v.t)) {
    out.v = { id: v.id, n: v.n, h: v.h, v: v.v, yr: v.yr, w: v.w, s: v.s, k: v.k, p: v.p, t: v.t };
  }
  const d = o.d as Record<string, unknown> | undefined;
  if (d && typeof d === 'object' && (d.o === null || isStr(d.o)) && isStr(d.id) && isNum(d.x) && isNum(d.z)) {
    out.d = { o: d.o as string | null, id: d.id, x: d.x, z: d.z };
  }
  const r = o.r as Record<string, unknown> | undefined;
  if (r && typeof r === 'object' && isStr(r.o) && isStr(r.id) && isNum(r.s) && isNum(r.tn)) {
    out.r = { o: r.o, id: r.id, s: Math.max(-1, Math.min(1, r.s)), tn: Math.max(-1, Math.min(1, r.tn)) };
  }
  return out.v || out.d || out.r ? out : undefined;
}

export function encodeVessel(id: string, vessel: Vessel, t: number): VesselWire {
  const m = vessel.motion;
  return {
    id,
    n: v8(m.n),
    h: v8(m.heading),
    v: [r6(m.vel[0]), r6(m.vel[1]), r6(m.vel[2])],
    yr: r6(m.yawRate),
    w: r6(vessel.cmd.wheel),
    s: r6(vessel.cmd.sail),
    k: r6(vessel.heave.sink),
    p: vessel.people,
    t: r6(t),
  };
}

// ── Dead reckoning ──────────────────────────────────────────────────

/** Seconds of full-speed extrapolation before a silent boat drifts down. */
export const OWNER_SILENT_S = 3;
const DRIFT_TAU_S = 2;
/** Easing time toward the dead-reckoned target (s). */
const EASE_S = 0.5;

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function tangentAt(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}
function yaw(t: Vec3, n: Vec3, a: number): Vec3 {
  const s = starboardOf(n, t);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return norm([t[0] * c + s[0] * sn, t[1] * c + s[1] * sn, t[2] * c + s[2] * sn]);
}

/** Where a boat sent as `w` is at shared time `now`. While the owner is
 *  live the boat follows the arc its turn rate gives (velocity swinging
 *  with the bow); after OWNER_SILENT_S it runs straight and drifts down. */
export function deadReckon(w: VesselWire, now: number): { n: Vec3; h: Vec3 } {
  const dt = Math.max(0, now - w.t);
  const speed = Math.hypot(w.v[0], w.v[1], w.v[2]);
  const run = Math.min(dt, OWNER_SILENT_S);
  const drift = dt > OWNER_SILENT_S ? DRIFT_TAU_S * (1 - Math.exp(-(dt - OWNER_SILENT_S) / DRIFT_TAU_S)) : 0;
  let n = w.n;
  let h = w.h;
  let dir = speed > 1e-9 ? norm(w.v) : w.h;
  // The arc, in steps of at most 0.1 s.
  const steps = Math.max(1, Math.ceil(run / 0.1));
  const step = run / steps;
  for (let i = 0; i < steps; i++) {
    const d = speed * step;
    if (d > 1e-9) {
      const nn = travel(n, dir, d);
      dir = norm(tangentAt(dir, nn));
      h = norm(tangentAt(h, nn));
      n = nn;
    }
    if (w.yr !== 0) {
      dir = yaw(dir, n, w.yr * step);
      h = yaw(h, n, w.yr * step);
    }
  }
  if (drift > 0 && speed * drift > 1e-9) {
    const nn = travel(n, dir, speed * drift);
    h = norm(tangentAt(h, nn));
    n = nn;
  }
  return { n, h };
}

// ── The fleet ───────────────────────────────────────────────────────

export type BoatKind = 'dock' | 'mine' | 'remote';

export interface FleetBoat {
  /** Unique key in this world. */
  key: string;
  /** Id the owner uses on the wire. */
  wireId: string;
  /** Owner's peer id; null for the dock boat. */
  owner: string | null;
  kind: BoatKind;
  vessel: Vessel;
  /** False while the dock boat waits for the berth to clear. */
  visible: boolean;
  remote?: VesselWire;
  /** Viewer side: how far the shown boat sits off the dead-reckoned one
   *  (a tangent offset in unit-normal terms, and a heading angle). It
   *  decays over EASE_S so a fresh state never makes the boat jump. */
  ease?: { dn: Vec3; dh: number };
  /** Owner side: strokes from rowers in other worlds. */
  rowers: Map<string, { s: number; tn: number; at: number }>;
  deckOff?: () => void;
}

/** Berth is "clear" once no other boat's centre is this close (m). */
const BERTH_CLEAR_M = 12;
/** How often the wind is re-read from the field (ticks). */
const WIND_EVERY_TICKS = 15;
const WHEEL_RATE = 2;
const SAIL_RATE = 0.4;
/** Rower silence after which their stroke is dropped (s). */
const ROWER_TIMEOUT_S = 1;

export { HELM_SPOT, OARS_SPOT, OAR_SPOTS } from './boatLayout';

export interface BodyPlace {
  x: number;
  z: number;
  feet: number;
  aboveDeck: number;
}

export function frameOf(boat: FleetBoat): BoatFrame {
  return { center: boat.vessel.motion.n, heading: boat.vessel.motion.heading };
}

export function placeOn(boat: FleetBoat, pos: [number, number, number], t: number): BodyPlace | null {
  const pose = getEarthPose();
  const rx = pos[0] - pose.center[0];
  const ry = pos[1] - pose.center[1];
  const rz = pos[2] - pose.center[2];
  const r = Math.hypot(rx, ry, rz);
  if (!(r > 1e-6)) return null;
  const n = quatRotate(pose.invSpinQuat, [rx / r, ry / r, rz / r]);
  const c = boat.vessel.motion.n;
  if (dot(n, c) < Math.cos(12 / EARTH_RADIUS)) {
    // Far from this boat: report a place well off its deck.
    return { x: 1e3, z: 1e3, feet: r - BODY_SHELL_RADIUS - FOOT_CUSHION, aboveDeck: 0 };
  }
  const { x, z } = toBoatFrame(frameOf(boat), n, EARTH_RADIUS);
  const feet = r - BODY_SHELL_RADIUS - FOOT_CUSHION;
  return { x, z, feet, aboveDeck: feet - boat.vessel.deckTopAt(t) };
}

export function isOnDeck(p: BodyPlace): boolean {
  if (p.z < -HALF_L || p.z > HALF_L) return false;
  if (Math.abs(p.x) > railHalfWidthAt(p.z)) return false;
  return p.aboveDeck > -0.45 && p.aboveDeck < 1.6;
}

/** World position standing at (x, z) on `boat`'s deck now. */
export function deckPointOn(boat: FleetBoat, x: number, z: number): [number, number, number] {
  const top = boat.vessel.deckTopAt(getEarthPoseTime());
  const n = fromBoatFrame(frameOf(boat), x, z, EARTH_RADIUS);
  const r = BODY_SHELL_RADIUS + top + FOOT_CUSHION + 0.02;
  return earthLocalToWorld([n[0] * r, n[1] * r, n[2] * r], getEarthPose());
}

export interface FleetOptions {
  /** This player's mesh peer id (stable for the session). */
  selfPeer?: () => string;
  /** Register decks with `deckSupport` (off for a second test world). */
  registerDecks?: boolean;
  /** Follow this device's crew role (off for a second test world, which
   *  shares the crew module with the first). */
  localCrew?: boolean;
}

export class Fleet {
  boats = new Map<string, FleetBoat>();
  private dockSeq = 0;
  private selfPeerFn: () => string;
  private registerDecks: boolean;
  private localCrew: boolean;
  private listeners = new Set<() => void>();
  private tickCount = 0;
  private wind: Vec3 = [0, 0, 0];

  constructor(opts: FleetOptions = {}) {
    this.selfPeerFn = opts.selfPeer ?? (() => 'local');
    this.registerDecks = opts.registerDecks ?? true;
    this.localCrew = opts.localCrew ?? true;
  }

  private crewKey(): string | null {
    return this.localCrew ? getCrewBoatKey() : null;
  }

  private crewRole(): CrewRole | null {
    return this.localCrew ? getCrewRole() : null;
  }

  setSelfPeer(fn: () => string): void {
    this.selfPeerFn = fn;
  }

  selfPeer(): string {
    return this.selfPeerFn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* ignore */ }
    }
  }

  private add(boat: FleetBoat): FleetBoat {
    this.boats.set(boat.key, boat);
    if (this.registerDecks) this.attachDeck(boat);
    this.emit();
    return boat;
  }

  private attachDeck(boat: FleetBoat): void {
    const inner = boatDeck({
      id: `boat-deck:${boat.key}`,
      frame: () => frameOf(boat),
      radius: EARTH_RADIUS,
      top: () => boat.vessel.deckTopAt(getEarthPoseTime()),
      boardingShut: () => !boat.vessel.canBoard(),
    });
    boat.deckOff = registerDeckSurface({
      id: inner.id,
      elevationAt: (n) => (boat.visible ? inner.elevationAt(n) : null),
      confine: (n, feet, radius) => (boat.visible && inner.confine ? inner.confine(n, feet, radius) : null),
    });
  }

  /** Register decks for boats created before mounting. */
  attachAllDecks(): void {
    if (!this.registerDecks) return;
    for (const b of this.boats.values()) if (!b.deckOff) this.attachDeck(b);
  }

  detachAllDecks(): void {
    for (const b of this.boats.values()) { b.deckOff?.(); b.deckOff = undefined; }
  }

  remove(key: string): void {
    const b = this.boats.get(key);
    if (!b) return;
    b.deckOff?.();
    this.boats.delete(key);
    if (this.crewKey() === key) leaveRole();
    this.emit();
  }

  /** The dock boat (created on demand). */
  dock(): FleetBoat | null {
    if (!getVillageDockSite()) return null;
    for (const b of this.boats.values()) if (b.kind === 'dock') return b;
    const key = `dock-${++this.dockSeq}`;
    return this.add({
      key, wireId: key, owner: null, kind: 'dock', vessel: newDockVessel(key),
      visible: true, rowers: new Map(),
    });
  }

  mine(): FleetBoat | undefined {
    for (const b of this.boats.values()) if (b.kind === 'mine') return b;
    return undefined;
  }

  get(key: string): FleetBoat | undefined {
    if (key === 'dock') return this.dock() ?? undefined;
    return this.boats.get(key);
  }

  list(): FleetBoat[] {
    return Array.from(this.boats.values());
  }

  /** The boat this player is concerned with: crewed, else owned, else dock. */
  focus(): FleetBoat | null {
    const key = this.crewKey();
    if (key) {
      const b = this.get(key);
      if (b) return b;
    }
    return this.mine() ?? this.dock();
  }

  /** Would claiming the dock boat be refused (old boat out with people)? */
  claimBlocked(): boolean {
    const mine = this.mine();
    return !!mine && mine.vessel.people > 0;
  }

  /**
   * Make the dock boat this player's. Returns the claimed boat, or null
   * when the old boat still has people aboard.
   */
  claimDock(): FleetBoat | null {
    const dock = this.dock();
    if (!dock) return null;
    const old = this.mine();
    if (old) {
      if (old.vessel.people > 0) return null;
      this.remove(old.key);
    }
    dock.kind = 'mine';
    dock.owner = this.selfPeer();
    dock.visible = true;
    // The dock refills (hidden until the berth is clear).
    const fresh = this.dock();
    if (fresh) fresh.visible = false;
    this.emit();
    return dock;
  }

  /** Another player's boat state (or its absence) from their presence. */
  applyRemote(peer: string, wire: VesselWire | undefined, now = getEarthPoseTime()): void {
    if (peer === this.selfPeer()) return;
    const existing = this.list().find((b) => b.kind === 'remote' && b.owner === peer);
    if (!wire) {
      if (existing) this.remove(existing.key);
      return;
    }
    let boat = existing;
    if (boat && boat.wireId !== wire.id) {
      this.remove(boat.key);
      boat = undefined;
    }
    if (!boat) {
      const v = new Vessel(`${peer}/${wire.id}`, 0, { n: wire.n, heading: wire.h });
      boat = this.add({
        key: `${peer}/${wire.id}`, wireId: wire.id, owner: peer, kind: 'remote',
        vessel: v, visible: true, rowers: new Map(),
      });
      // Start exactly where it should be now; ease from then on.
      const at = deadReckon(wire, now);
      v.motion = { ...v.motion, n: at.n, heading: at.h };
    }
    else if (boat.remote !== wire) {
      // Hand over from what is shown now to the new state without a jump.
      const at = deadReckon(wire, now);
      const cur = boat.vessel.motion;
      const dn = tangentAt([cur.n[0] - at.n[0], cur.n[1] - at.n[1], cur.n[2] - at.n[2]], at.n);
      const h = norm(tangentAt(cur.heading, at.n));
      const dh = Math.atan2(dot(h, starboardOf(at.n, at.h)), dot(h, at.h));
      boat.ease = { dn, dh };
    }
    boat.remote = wire;
  }

  /** Forget everything from a peer that left. */
  dropPeer(peer: string): void {
    this.rowStamps.delete(peer);
    for (const b of this.list()) {
      if (b.kind === 'remote' && b.owner === peer) this.remove(b.key);
      b.rowers.delete(peer);
    }
  }

  /** Keep only boats of peers still in the room. */
  retainPeers(peers: Set<string>): void {
    for (const b of this.list()) {
      if (b.kind === 'remote' && b.owner && !peers.has(b.owner)) this.remove(b.key);
    }
    for (const peer of Array.from(this.rowStamps.keys())) if (!peers.has(peer)) this.rowStamps.delete(peer);
  }

  /** Presence stamp of the last stroke taken from each remote rower. */
  private rowStamps = new Map<string, number>();

  /**
   * A stroke from a rower in another world (owner side). `stamp` is the
   * presence's send time: a stroke is taken once per presence, so a rower
   * who goes quiet is not kept pulling by replays of their last presence,
   * and their stroke lapses after ROWER_TIMEOUT_S.
   */
  remoteRow(peer: string, r: RowWire, now = getEarthPoseTime(), stamp?: number): void {
    const mine = this.mine();
    if (!mine || r.o !== this.selfPeer() || r.id !== mine.wireId) return;
    if (stamp !== undefined) {
      if (this.rowStamps.get(peer) === stamp) return;
      this.rowStamps.set(peer, stamp);
    }
    mine.rowers.set(peer, { s: r.s, tn: r.tn, at: now });
  }

  /** The boat a deck reference from the wire points to in this world. */
  resolveDeck(d: DeckWire): FleetBoat | undefined {
    if (d.o === null) return this.dock() ?? undefined;
    if (d.o === this.selfPeer()) {
      const mine = this.mine();
      return mine && mine.wireId === d.id ? mine : undefined;
    }
    return this.list().find((b) => b.kind === 'remote' && b.owner === d.o && b.wireId === d.id);
  }

  /** The visible boat whose deck `pos` stands on, with the place. */
  boatUnder(pos: [number, number, number], t = getEarthPoseTime()): { boat: FleetBoat; place: BodyPlace } | null {
    for (const b of this.boats.values()) {
      if (!b.visible) continue;
      const p = placeOn(b, pos, t);
      if (p && isOnDeck(p)) return { boat: b, place: p };
    }
    return null;
  }

  /** What to put in this player's presence. */
  presenceFor(selfPos: [number, number, number] | null, t = getEarthPoseTime()): BoatPresence | undefined {
    const out: BoatPresence = {};
    const mine = this.mine();
    if (mine) out.v = encodeVessel(mine.wireId, mine.vessel, t);
    if (selfPos) {
      const on = this.boatUnder(selfPos, t);
      if (on) {
        const b = on.boat;
        out.d = {
          o: b.kind === 'dock' ? null : b.kind === 'mine' ? this.selfPeer() : b.owner,
          id: b.kind === 'dock' ? 'dock' : b.wireId,
          x: r6(on.place.x),
          z: r6(on.place.z),
        };
      }
    }
    const key = this.crewKey();
    const crewBoat = key ? this.get(key) : undefined;
    if (this.crewRole() === 'oars' && crewBoat?.kind === 'remote' && crewBoat.owner) {
      const input = getCrewInput();
      if ((Math.abs(input.row) > 0.05 || Math.abs(input.rowTurn) > 0.05) && canRow()) {
        out.r = { o: crewBoat.owner, id: crewBoat.wireId, s: r6(input.row), tn: r6(input.rowTurn) };
      }
    }
    return out.v || out.d || out.r ? out : undefined;
  }

  private jettyCapsule(): Capsule | null {
    const site = getVillageDockSite();
    if (!site) return null;
    return { a: site.jettyStart, b: site.jettyEnd, radius: JETTY_WIDTH / 2 };
  }

  /**
   * One physics tick: claim, float, sail, reckon, collide, carry, pin.
   */
  tick(
    physics: UqrcPhysics | null,
    dt: number,
    windFn: (n: Vec3) => Vec3,
    seaFn: (n: Vec3) => number = () => 0,
  ): void {
    const t = getEarthPoseTime();
    const dock = this.dock();

    // A crew role on the dock boat claims it.
    let crewKey = this.crewKey();
    const role = this.crewRole();
    if (role && crewKey === 'dock' && dock) { crewKey = dock.key; setCrewBoatKey(crewKey); }
    if (role && crewKey) {
      const b = this.boats.get(crewKey);
      if (!b) leaveRole();
      else if (b.kind === 'dock' && role !== 'rod') {
        // The wheel or the oars make the dock boat yours; fishing off it
        // does not.
        if (!this.claimDock()) leaveRole();
      } else if (b.kind === 'remote' && role === 'helm') {
        leaveRole(); // only the owner takes the wheel
      }
    }
    crewKey = this.crewKey();

    // The fresh dock boat shows once the berth is clear.
    const fresh = this.dock();
    if (fresh) {
      const berth = fresh.vessel.motion.n;
      let clear = true;
      for (const b of this.boats.values()) {
        if (b === fresh) continue;
        if (Math.acos(Math.min(1, dot(b.vessel.motion.n, berth))) * EARTH_RADIUS < BERTH_CLEAR_M) { clear = false; break; }
      }
      if (clear !== fresh.visible) { fresh.visible = clear; this.emit(); }
    }

    // Who stands on which deck (in the frames the physics just used).
    const aboard = new Map<string, { id: string; x: number; z: number }[]>();
    if (physics) {
      for (const body of physics.getBodies()) {
        if (body.kind !== 'self' && body.kind !== 'avatar') continue;
        if (body.meta?.attachedTo !== 'earth-surface') continue;
        const on = this.boatUnder(body.pos, t);
        if (!on) continue;
        const list = aboard.get(on.boat.key) ?? [];
        list.push({ id: body.id, x: on.place.x, z: on.place.z });
        aboard.set(on.boat.key, list);
      }
    }

    if (this.tickCount++ % WIND_EVERY_TICKS === 0) {
      // Each boat's sea from the weather where it floats.
      for (const b of this.boats.values()) {
        try {
          const w = windFn(b.vessel.motion.n);
          b.vessel.seaTarget = seaStateFor(Math.hypot(w[0], w[1], w[2]), seaFn(b.vessel.motion.n));
        } catch { /* keep the last sea */ }
      }
      const focus = this.mine() ?? dock;
      try { this.wind = focus ? windFn(focus.vessel.motion.n) : [0, 0, 0]; } catch { this.wind = [0, 0, 0]; }
    }

    const input = getCrewInput();
    const selfId = getCrewSelfId();
    const jetty = this.jettyCapsule();
    for (const b of this.boats.values()) {
      const v = b.vessel;
      const before = frameOf(b);
      const n0 = v.motion.n;
      if (b.kind === 'remote' && b.remote) {
        // Dead reckoning on the shared clock, plus a fading hand-over offset.
        const w = b.remote;
        const at = deadReckon(w, t);
        let n = at.n;
        let h = at.h;
        if (b.ease) {
          const e = Math.exp(-dt / EASE_S);
          const { dn } = b.ease;
          b.ease.dn = [dn[0] * e, dn[1] * e, dn[2] * e];
          b.ease.dh *= e;
          n = norm([at.n[0] + b.ease.dn[0], at.n[1] + b.ease.dn[1], at.n[2] + b.ease.dn[2]]);
          h = yaw(norm(tangentAt(at.h, n)), n, b.ease.dh);
          if (Math.hypot(...b.ease.dn) * EARTH_RADIUS < 1e-4 && Math.abs(b.ease.dh) < 1e-5) b.ease = undefined;
        }
        const silent = t - w.t > OWNER_SILENT_S;
        v.motion = { n, heading: norm(tangentAt(h, n)), vel: silent ? [0, 0, 0] : w.v, yawRate: w.yr, aground: false };
        v.cmd.wheel = w.w;
        v.cmd.sail = silent ? Math.max(0, v.cmd.sail - SAIL_RATE * dt) : w.s;
        v.heave.sink += (w.k - v.heave.sink) * Math.min(1, dt / EASE_S);
        v.people = w.p;
        v.wind = this.wind;
        v.stepSea(dt);
      } else {
        v.setPeople((aboard.get(b.key) ?? []).length);
        v.step(dt);
        if (b.kind === 'mine') {
          const mineCrew = crewKey === b.key ? role : null;
          v.cmd.wheel = approach(v.cmd.wheel, mineCrew === 'helm' ? input.wheel : 0, WHEEL_RATE, dt);
          if (mineCrew === 'helm' && input.sail !== 0) {
            v.cmd.sail = approach(v.cmd.sail, input.sail > 0 ? 1 : 0, SAIL_RATE, dt);
          }
          // Every rower's stroke adds up, as many as the sea lets keep
          // time together (all the benches on a calm day, one in a gale).
          const strokes: { s: number; tn: number }[] = [];
          if (mineCrew === 'oars' && (Math.abs(input.row) > 0.05 || Math.abs(input.rowTurn) > 0.05) && canRow()) {
            strokes.push({ s: input.row, tn: input.rowTurn });
          }
          for (const [peer, s] of b.rowers) {
            if (t - s.at > ROWER_TIMEOUT_S) { b.rowers.delete(peer); continue; }
            strokes.push(s);
          }
          let row = 0;
          let turn = 0;
          for (const s of strokes.slice(0, rowersAllowed(v.sea))) {
            row += Math.max(-1, Math.min(1, s.s));
            turn += Math.max(-1, Math.min(1, s.tn));
          }
          v.cmd.row = row;
          v.cmd.rowTurn = turn;
          v.stepMotion(dt, this.wind);
          // Bump other hulls and the jetty.
          for (const o of this.boats.values()) {
            if (o === b || !o.visible) continue;
            v.motion = resolveHullContact(v.motion, hullCapsule(o.vessel.motion.n, o.vessel.motion.heading));
          }
          if (jetty) v.motion = resolveHullContact(v.motion, jetty);
        } else {
          v.wind = this.wind;
        }
      }

      // The local angler's line on this boat.
      if (role === 'rod' && crewKey === b.key) updateFishing(t, v.speed());

      // Food for the local rower on this boat.
      if (role === 'oars' && crewKey === b.key && (Math.abs(input.row) > 0.05 || Math.abs(input.rowTurn) > 0.05)) {
        chargeRowing(Math.acos(Math.min(1, dot(n0, v.motion.n))) * EARTH_RADIUS);
      }

      // Carry everyone on this deck; hold the crew at their station.
      if (!physics) continue;
      const after = frameOf(b);
      // The deck also rises and falls with the swell; riders go with it
      // (the step about to come), so a rough sea never leaves them behind.
      const rise = v.deckTopAt(t + dt) - v.deckTopAt(t);
      const moved = before.center !== after.center || before.heading !== after.heading || Math.abs(rise) > 1e-7;
      const pose = getEarthPose();
      for (const a of aboard.get(b.key) ?? []) {
        const body = physics.getBody(a.id);
        if (!body) continue;
        let x = a.x;
        let z = a.z;
        const pinned = !!role && crewKey === b.key && a.id === selfId;
        if (pinned) [x, z] = role === 'helm' ? HELM_SPOT : getCrewSpot() ?? (role === 'oars' ? OARS_SPOT : ROD_SPOTS[0]);
        if (!pinned && !moved) continue;
        const rx = body.pos[0] - pose.center[0];
        const ry = body.pos[1] - pose.center[1];
        const rz = body.pos[2] - pose.center[2];
        let r = Math.hypot(rx, ry, rz) + rise;
        if (pinned) r = BODY_SHELL_RADIUS + v.deckTopAt(t) + FOOT_CUSHION;
        const n = fromBoatFrame(after, x, z, EARTH_RADIUS);
        const local: Vec3 = [n[0] * r, n[1] * r, n[2] * r];
        const w = earthLocalToWorld(local, pose);
        body.pos[0] = w[0]; body.pos[1] = w[1]; body.pos[2] = w[2];
        if (pinned) { body.vel[0] = 0; body.vel[1] = 0; body.vel[2] = 0; }
        if (body.local) { body.local[0] = local[0]; body.local[1] = local[1]; body.local[2] = local[2]; }
      }
    }

    // A crew member who left the deck gives up the station.
    if (physics && role && crewKey && selfId) {
      const list = aboard.get(crewKey) ?? [];
      if (!list.some((a) => a.id === selfId)) leaveRole();
    }
  }

  reset(): void {
    this.detachAllDecks();
    this.boats.clear();
    this.rowStamps.clear();
    this.dockSeq = 0;
    this.tickCount = 0;
    this.wind = [0, 0, 0];
    this.emit();
  }
}

function approach(value: number, target: number, rate: number, dt: number): number {
  const d = target - value;
  const max = rate * dt;
  return value + Math.max(-max, Math.min(max, d));
}

let fleet: Fleet | null = null;

export function getFleet(): Fleet {
  if (!fleet) fleet = new Fleet();
  return fleet;
}

export function _resetFleetForTest(): void {
  fleet?.reset();
}

onVesselReset(() => fleet?.reset());
