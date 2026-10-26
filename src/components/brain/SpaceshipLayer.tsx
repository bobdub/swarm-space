import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Home, Octagon, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BRAIN_SPACESHIP_URL } from '@/assets/brainSpaceship';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getEarthPose, EARTH_RADIUS, BODY_CENTER_HEIGHT, worldPosToLocalNormal } from '@/lib/brain/earth';
import { feetRadiusAt } from '@/lib/brain/groundHeight';
import { getAvatarById, loadHubPrefs } from '@/lib/virtualHub/avatars';
import { isPeerMuted } from '@/lib/brain/mutedPeersStore';
import { getRoomPresences, onRoomPresenceRemoved } from '@/lib/streaming/webrtcSignalingBridge.standalone';
import { shipPadPose, shipSiteNormal } from '@/lib/brain/spaceshipSite';
import { chargeShipLaunch, consumeShipAdmission } from '@/lib/brain/spaceshipLaunch';
import { advanceFlight, BOARD_HOLD_MS, COUNTDOWN_MS, ASCENT_MS, SPACE_ALTITUDE, countdownAt, type ShipState, type V3, type Q4 } from '@/lib/brain/spaceshipRules';
import { acceptShip, getShips, getPilotShip, setLocalShip, padClaim, sweepShips, removeShip, useShipsVersion } from '@/lib/brain/spaceshipStore';
import { leaveSeat } from '@/lib/pub/seating';
import { seatLockFor } from '@/lib/pub/seatLock';
import { leaveTable } from '@/lib/pub/gameTableStore';

export const spaceshipInput = { throttle: 0, yaw: 0, pitch: 0, brake: false };
export const spaceshipTouchInput = { throttle: 0, pitch: 0 };
function shipPalette() {
  const css = getComputedStyle(document.documentElement);
  return { hull: `hsl(${css.getPropertyValue('--ship-hull').trim()})`, panel: `hsl(${css.getPropertyValue('--ship-panel').trim()})`, engine: `hsl(${css.getPropertyValue('--accent').trim()})`, pad: `hsl(${css.getPropertyValue('--ship-pad').trim()})` };
}
export function activeLocalShip(selfId: string): ShipState | undefined {
  return getShipsForSelf(selfId);
}
let localFlight: ShipState | undefined;
function getShipsForSelf(id: string) { return localFlight?.pilotId === id && localFlight.phase !== 'ended' && localFlight.phase !== 'claim' ? localFlight : undefined; }

function ShipArtifact({ pilot, cockpit = false }: { pilot?: string; cockpit?: boolean }) {
  const colors = useMemo(shipPalette, []);
  const { scene } = useGLTF(BRAIN_SPACESHIP_URL);
  const model = useMemo(() => {
    const obj = scene.clone(true);
    const box = new THREE.Box3().setFromObject(obj), center = box.getCenter(new THREE.Vector3());
    obj.position.set(-center.x * 4, -box.min.y * 4, -center.z * 4);
    obj.scale.setScalar(4);
    obj.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    return obj;
  }, [scene]);
  const avatar = getAvatarById(pilot);
  return <>
    {!cockpit && <primitive object={model} />}
    {!cockpit && pilot && <group position={[0, 1.2, 0]}>{avatar.render({ scale: 0.8 })}</group>}
    {/* Open canopy frame: no opaque windshield, no second render pass. */}
    <group position={[0, 2.3, -0.2]}>
      {[-1.5, 1.5].map(x => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[0.08, 1.7, 2.8]} /><meshStandardMaterial color={colors.hull} metalness={0.6} roughness={0.35} /></mesh>)}
      <mesh position={[0, -0.75, -1.1]}><boxGeometry args={[3.1, 0.16, 0.25]} /><meshStandardMaterial color={colors.panel} roughness={0.6} /></mesh>
    </group>
  </>;
}
function ShipView({ state, local }: { state: ShipState; local: boolean }) {
  const colors = useMemo(shipPalette, []);
  const group = useRef<THREE.Group>(null);
  const seeded = useRef(false);
  useFrame((_, rawDt) => {
    if (!group.current) return;
    const current = local ? localFlight : getPilotShip(state.roomId, state.pilotPeerId);
    if (!current) { group.current.visible = false; return; }
    const t = seeded.current && !local ? 1 - Math.exp(-12 * Math.min(rawDt, 0.05)) : 1;
    group.current.position.lerp(new THREE.Vector3(...current.position), t);
    group.current.quaternion.slerp(new THREE.Quaternion(...current.quaternion), t);
    seeded.current = true;
  });
  return <group ref={group}>
    <Suspense fallback={null}><ShipArtifact pilot={state.avatarId} cockpit={local} /></Suspense>
    {(state.phase === 'launch' || state.phase === 'flight' || state.phase === 'return') && <mesh position={[0, 0.6, 3.6]} rotation-x={Math.PI / 2}><coneGeometry args={[0.7, 3, 12]} /><meshBasicMaterial color={colors.engine} transparent opacity={0.75} /></mesh>}
  </group>;
}

export function SpaceshipLayer({ selfId, roomId, enabled }: { selfId: string; roomId: string; enabled: boolean }) {
  useShipsVersion();
  const physics = getBrainPhysics();
  const colors = useMemo(shipPalette, []);
  const pad = useRef<THREE.Group>(null);
  const lease = useRef<ReturnType<typeof physics.acquireBodyControl>>(null);
  const meshRef = useRef<Awaited<ReturnType<typeof loadMesh>> | null>(null);
  const [near, setNear] = useState(false), [progress, setProgress] = useState(0), [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const held = useRef(0), charging = useRef(false), mounted = useRef(true), lastSend = useRef(0);
  const returning = useRef<{ from: V3; q: Q4; at: number } | null>(null);
  const padState = padClaim(roomId, clock);
  const flight = activeLocalShip(selfId);
  const blocked = Boolean(padState && padState.pilotPeerId !== meshRef.current?.getPeerId());
  const nearRef = useRef(false);
  const generation = useRef(0);
  async function loadMesh() { const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone'); return getSwarmMeshStandalone(); }
  function publish(s: ShipState) {
    s.seq++;
    setLocalShip(s);
    meshRef.current?.broadcast('brain:ship:v1', { ...s });
  }
  function exit() {
    const s = localFlight;
    if (!s || s.pilotId !== selfId) return;
    const pose = getEarthPose(), padPose = shipPadPose(pose);
    const n = new THREE.Vector3(...shipSiteNormal()).multiplyScalar(feetRadiusAt(shipSiteNormal()) + BODY_CENTER_HEIGHT);
    n.applyQuaternion(new THREE.Quaternion(...pose.spinQuat)).add(new THREE.Vector3(...pose.center));
    // Exit beside, not inside, the craft.
    n.add(new THREE.Vector3(6, 0, 0).applyQuaternion(new THREE.Quaternion(...padPose.quaternion)));
    const exitNormal = worldPosToLocalNormal(n.toArray() as V3, pose);
    n.sub(new THREE.Vector3(...pose.center)).setLength(feetRadiusAt(exitNormal) + BODY_CENTER_HEIGHT).add(new THREE.Vector3(...pose.center));
    lease.current?.update(n.toArray() as V3); lease.current?.release(); lease.current = null;
    const body = physics.getBody(selfId);
    if (body) { body.meta = { ...body.meta, attachedTo: 'earth-surface' }; body.local = undefined; body.prevLocal = undefined; body.vel = [0, 0, 0]; }
    s.phase = 'ended'; publish(s); localFlight = undefined; returning.current = null;
    spaceshipInput.throttle = 0; spaceshipInput.yaw = 0; spaceshipInput.pitch = 0; spaceshipInput.brake = false;
    spaceshipTouchInput.throttle = 0; spaceshipTouchInput.pitch = 0;
  }
  useEffect(() => {
    mounted.current = true;
    const epoch = ++generation.current;
    let off: (() => void) | undefined;
    void loadMesh().then(mesh => {
      if (!mounted.current || generation.current !== epoch) return;
      meshRef.current = mesh;
      off = mesh.onMessage('brain:ship:v1', (sender, raw) => {
        if (sender === mesh.getPeerId()) return;
        const member = getRoomPresences(roomId).find(p => p.peerId === sender);
        if (!member || !raw || typeof raw !== 'object' || (raw as ShipState).pilotId !== member.userId) return;
        acceptShip(raw, sender, roomId);
      });
    });
    const departed = onRoomPresenceRemoved((room, peer) => { if (room === roomId) removeShip(room, peer); });
    const timer = window.setInterval(() => {
      setClock(Date.now());
      const mesh = meshRef.current;
      if (mesh) sweepShips(roomId, new Set([mesh.getPeerId(), ...getRoomPresences(roomId).map(p => p.peerId)]));
    }, 200);
    const release = () => exit();
    window.addEventListener('pagehide', release);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); off?.(); departed(); window.removeEventListener('pagehide', release); exit(); lease.current?.release(); lease.current = null; meshRef.current = null; };
  }, [selfId, roomId]);
  async function board() {
    const mesh = meshRef.current;
    if (!mesh || charging.current || localFlight || !enabled || !nearRef.current || padClaim(roomId)) return;
    charging.current = true; held.current = 0; setBusy(true); setProgress(0);
    const epoch = generation.current;
    const p = shipPadPose();
    const s: ShipState = { version: 1, roomId, pilotPeerId: mesh.getPeerId(), pilotId: selfId, session: crypto.randomUUID(), seq: 0, startedAt: Date.now(), phase: 'claim', position: p.position, quaternion: p.quaternion, velocity: [0, 0, 0], avatarId: loadHubPrefs().avatarId };
    publish(s);
    try {
      // Claim arbitration precedes payment; the earliest peer claim wins.
      await new Promise(resolve => setTimeout(resolve, 750));
      if (!mounted.current || generation.current !== epoch || !nearRef.current || padClaim(roomId)?.session !== s.session) throw new Error('Launchpad is occupied or out of reach');
      const lock = seatLockFor(selfId); if (lock) leaveTable(lock.tableId, selfId); leaveSeat();
      lease.current = physics.acquireBodyControl(selfId);
      if (!lease.current) throw new Error('Avatar is unavailable for boarding');
      await chargeShipLaunch(selfId, s.session, () => mounted.current && generation.current === epoch);
      if (!mounted.current || generation.current !== epoch) { lease.current?.release(); lease.current = null; s.phase = 'ended'; publish(s); return; }
      s.phase = 'countdown'; s.startedAt = Date.now(); localFlight = s; publish(s);
      consumeShipAdmission(selfId);
    } catch (err) {
      lease.current?.release(); lease.current = null; s.phase = 'ended'; publish(s);
      if (mounted.current) toast.error(err instanceof Error ? err.message : 'Launch failed');
    } finally { charging.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return; if (e.code === 'KeyE' && !e.repeat && nearRef.current) held.current = performance.now(); if (e.code === 'Space' && activeLocalShip(selfId)) { e.preventDefault(); spaceshipInput.brake = true; } };
    const up = (e: KeyboardEvent) => { if (e.code === 'KeyE') { held.current = 0; setProgress(0); } if (e.code === 'Space') spaceshipInput.brake = false; };
    const clear = () => { held.current = 0; spaceshipInput.brake = false; spaceshipInput.throttle = 0; spaceshipInput.yaw = 0; spaceshipInput.pitch = 0; spaceshipTouchInput.throttle = 0; spaceshipTouchInput.pitch = 0; setProgress(0); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); clear(); };
  }, [selfId]);
  useFrame((_, rawDt) => {
    const now = Date.now(), p = shipPadPose();
    if (pad.current) { pad.current.position.set(...p.position); pad.current.quaternion.set(...p.quaternion); pad.current.visible = !padClaim(roomId, now) || padClaim(roomId, now)?.phase === 'claim'; }
    const body = physics.getBody(selfId);
    const close = enabled && !localFlight && !!body && new THREE.Vector3(...body.pos).distanceTo(new THREE.Vector3(...p.position)) < 8;
    if (close !== nearRef.current) { nearRef.current = close; setNear(close); }
    if (held.current) {
      if (!close || padClaim(roomId, now)) { held.current = 0; setProgress(0); }
      else { const amount = Math.min(1, (performance.now() - held.current) / BOARD_HOLD_MS); setProgress(amount); if (amount >= 1) void board(); }
    }
    const s = localFlight;
    if (!s || s.pilotId !== selfId) return;
    if (s.phase === 'countdown' || s.phase === 'launch') {
      const elapsed = now - s.startedAt - COUNTDOWN_MS;
      const t = THREE.MathUtils.clamp(elapsed / ASCENT_MS, 0, 1), eased = t * t * (3 - 2 * t);
      const lift = shipPadPose(getEarthPose(), SPACE_ALTITUDE * eased);
      s.position = lift.position; s.quaternion = lift.quaternion;
      s.phase = elapsed < 0 ? 'countdown' : t < 1 ? 'launch' : 'flight';
    } else if (s.phase === 'flight') {
      advanceFlight(s, { ...spaceshipInput, throttle: THREE.MathUtils.clamp(spaceshipInput.throttle + spaceshipTouchInput.throttle, -1, 1), pitch: spaceshipTouchInput.pitch }, rawDt);
      // Hull collision: approach the atmosphere only via the return autopilot.
      const pose = getEarthPose(), rel = new THREE.Vector3(...s.position).sub(new THREE.Vector3(...pose.center));
      if (rel.length() < EARTH_RADIUS + 550) { rel.setLength(EARTH_RADIUS + 550).add(new THREE.Vector3(...pose.center)); s.position = rel.toArray() as V3; s.velocity = [0, 0, 0]; }
    } else if (s.phase === 'return' && returning.current) {
      const r = returning.current, t = THREE.MathUtils.clamp((now - r.at) / ASCENT_MS, 0, 1), smooth = t * t * (3 - 2 * t);
      // Great-circle return stays above the globe instead of cutting through it.
      const center = new THREE.Vector3(...getEarthPose().center);
      const start = new THREE.Vector3(...r.from).sub(center), end = new THREE.Vector3(...p.position).sub(center);
      const fromN = start.clone().normalize(), toN = end.clone().normalize();
      const arc = new THREE.Quaternion().setFromUnitVectors(fromN, toN);
      const traverse = new THREE.Quaternion().slerp(arc, Math.min(1, smooth / 0.8));
      const radius = smooth < 0.8 ? Math.max(start.length(), EARTH_RADIUS + SPACE_ALTITUDE) : THREE.MathUtils.lerp(Math.max(start.length(), EARTH_RADIUS + SPACE_ALTITUDE), end.length(), (smooth - 0.8) / 0.2);
      s.position = fromN.applyQuaternion(traverse).multiplyScalar(radius).add(center).toArray() as V3;
      s.quaternion = new THREE.Quaternion(...r.q).slerp(new THREE.Quaternion(...p.quaternion), smooth).toArray() as Q4;
      s.velocity = [0, 0, 0]; if (t === 1) { exit(); return; }
    }
    const passenger = new THREE.Vector3(0, 1.7, 0).applyQuaternion(new THREE.Quaternion(...s.quaternion)).add(new THREE.Vector3(...s.position));
    lease.current?.update(passenger.toArray() as V3, s.velocity);
    if (now - lastSend.current >= 200 && !document.hidden) { lastSend.current = now; publish(s); }
  });
  const remote = getShips(roomId).filter(s => s.phase !== 'claim' && s.phase !== 'ended' && s.pilotId !== selfId && !isPeerMuted(s.pilotPeerId) && !isPeerMuted(s.pilotId));
  const flightButton = (label: string, icon: React.ReactNode, axis: 'throttle' | 'pitch', value: number) => <Button type="button" variant="secondary" size="icon" title={label} aria-label={label} className="touch-none" onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); spaceshipTouchInput[axis] = value; }} onPointerUp={() => { spaceshipTouchInput[axis] = 0; }} onPointerCancel={() => { spaceshipTouchInput[axis] = 0; }} onLostPointerCapture={() => { spaceshipTouchInput[axis] = 0; }}>{icon}</Button>;
  return <>
    <group ref={pad}>
      <mesh position={[0, 0.05, 0]}><cylinderGeometry args={[6, 6, 0.1, 32]} /><meshStandardMaterial color={colors.pad} roughness={0.9} /></mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, 0.12, 0]}><torusGeometry args={[5.6, 0.07, 6, 40]} /><meshBasicMaterial color={colors.engine} /></mesh>
      <Suspense fallback={<Html center><span className="bg-background text-foreground p-2">Preparing spacecraft…</span></Html>}><ShipArtifact /></Suspense>
      <pointLight position={[0, 3, 0]} intensity={14} distance={20} />
    </group>
    {remote.map(s => <ShipView key={s.session} state={s} local={false} />)}
    {flight && <ShipView state={flight} local />}
    {createPortal(<>
      {near && !flight && <div className="fixed bottom-40 left-1/2 z-40 -translate-x-1/2 w-64 max-w-[85vw] text-center">
        <Button type="button" className="w-full touch-none gap-2" disabled={busy || blocked} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); held.current = performance.now(); }} onPointerUp={() => { held.current = 0; setProgress(0); }} onPointerCancel={() => { held.current = 0; setProgress(0); }} onLostPointerCapture={() => { held.current = 0; setProgress(0); }}><Rocket className="h-4 w-4" />{busy ? 'Preparing launch…' : blocked ? 'Launchpad occupied' : 'Launch to Space (5 SWARM)'}</Button>
        <div role="progressbar" aria-valuenow={Math.round(progress * 100)} className="h-1 mt-1 bg-muted overflow-hidden"><div className="h-full bg-accent origin-left" style={{ transform: `scaleX(${progress})` }} /></div>
        <span className="text-xs text-muted-foreground">500 game credits fallback</span>
      </div>}
      {flight && <div className="fixed inset-0 pointer-events-none z-30">
        <div className="absolute top-28 left-1/2 -translate-x-1/2 text-center bg-background/80 text-foreground px-4 py-2 rounded-md">
          <div className="text-sm">{flight.phase === 'countdown' ? 'Launch countdown' : flight.phase === 'launch' ? 'Launching to space' : flight.phase === 'return' ? 'Returning to launchpad' : 'Spaceflight'}</div>
          {flight.phase === 'countdown' ? <div className="text-4xl font-mono tabular-nums">{countdownAt(flight.startedAt, clock)}</div> : <div className="text-xs font-mono">{Math.round(Math.hypot(...flight.velocity))} m/s</div>}
        </div>
        {flight.phase === 'flight' && <div className="absolute bottom-28 left-1/2 -translate-x-1/2 flex gap-1 pointer-events-auto bg-background/80 p-2 rounded-md">
          {flightButton('Pitch up', <ArrowUp className="h-4 w-4" />, 'pitch', 1)}
          {flightButton('Pitch down', <ArrowDown className="h-4 w-4" />, 'pitch', -1)}
          {flightButton('Thrust', <Rocket className="h-4 w-4" />, 'throttle', 1)}
          <Button type="button" variant="secondary" size="icon" title="Brake" aria-label="Brake" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); spaceshipInput.brake = true; }} onPointerUp={() => { spaceshipInput.brake = false; }} onPointerCancel={() => { spaceshipInput.brake = false; }} onLostPointerCapture={() => { spaceshipInput.brake = false; }}><Octagon className="h-4 w-4" /></Button>
          <Button type="button" variant="secondary" size="icon" title="Return to bar" aria-label="Return to bar" onClick={() => { returning.current = { from: [...flight.position], q: [...flight.quaternion], at: Date.now() }; flight.phase = 'return'; publish(flight); }}><Home className="h-4 w-4" /></Button>
        </div>}
      </div>}
    </>, document.body)}
  </>;
}
