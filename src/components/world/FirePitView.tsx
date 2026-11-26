/**
 * FirePitView — a ring of stones, and a campfire in it while it burns.
 *
 * Whether the fire burns is read from `fireStore` (`burnUntil`), a pure
 * function of the shared fuel facts and the clock, so every peer shows
 * flames over the same pit at the same time and they die down together.
 * Drawn in the placement's local frame (y is up, origin at the base).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  burnUntil,
  subscribeFire,
  isFireFull,
  MAX_BURN_MS,
  BURN_MS_PER_WOOD,
  WOOD_PER_FUEL,
} from '@/lib/world/fireStore';
import { materialTotals, subscribeMaterials } from '@/lib/world/materials';
import { addWoodToFire } from '@/lib/world/fireActions';
import {
  COOKABLE_FOODS,
  GRILL_SLOTS,
  cookableFor,
  grillJobs,
  heldRaw,
  subscribeGrill,
  type GrillJob,
} from '@/lib/world/cooking';
import { attachGrillToasts, cookOnFire } from '@/lib/world/cookingActions';
import { subscribeHarvested } from '@/lib/remix/harvestedInventory';

const STONES = 9;

function useFireBurnUntil(pitId: string): number {
  const [until, setUntil] = useState(() => burnUntil(pitId));
  useEffect(() => {
    const update = () => setUntil(burnUntil(pitId));
    update();
    return subscribeFire(update);
  }, [pitId]);
  return until;
}

/** This player's food on this pit's grill. */
function useGrillJobs(pitId: string): GrillJob[] {
  const [jobs, setJobs] = useState<GrillJob[]>(() => grillJobs(pitId));
  useEffect(() => {
    attachGrillToasts();
    const update = () => setJobs(grillJobs(pitId));
    update();
    return subscribeGrill(update);
  }, [pitId]);
  return jobs;
}

/** Raw food this player could put on the grill, by kind. */
function useRawFood(): Record<string, number> {
  const read = () => Object.fromEntries(COOKABLE_FOODS.map((f) => [f.raw, heldRaw(f.raw)]));
  const [held, setHeld] = useState<Record<string, number>>(read);
  useEffect(() => subscribeHarvested(() => setHeld(read())), []);
  return held;
}

/** How each food looks on the grill: size (× pit width) and raw colour. */
const GRILL_LOOK: Record<string, { len: number; r: number; raw: string; done: string }> = {
  egg: { len: 0.04, r: 0.04, raw: '#fff7e6', done: '#ffe9a8' },
  fish: { len: 0.14, r: 0.035, raw: '#9fb6c8', done: '#8a5a2b' },
  chicken: { len: 0.08, r: 0.06, raw: '#f2c9b0', done: '#9a5a22' },
  shark: { len: 0.18, r: 0.05, raw: '#7d8a96', done: '#6b3f1f' },
};

/** Re-renders once a second while `until` is in the future. */
function useNow(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) { setNow(Date.now()); return; }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return now;
}

function formatBurnLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function FirePitView({
  pitId,
  width,
  height,
  highlight = false,
}: {
  pitId: string;
  width: number;
  height: number;
  highlight?: boolean;
}) {
  const until = useFireBurnUntil(pitId);
  const now = useNow(until);
  const lit = until > now;
  // Fuller fires burn taller.
  const strength = lit ? 0.55 + 0.45 * Math.min(1, (until - now) / (MAX_BURN_MS * 0.5)) : 0;

  const ringR = width * 0.4;
  const stoneSize = width * 0.11;
  const stones = useMemo(() => {
    const out: { pos: [number, number, number]; rot: [number, number, number]; s: number }[] = [];
    for (let i = 0; i < STONES; i++) {
      const a = (i / STONES) * Math.PI * 2;
      const jitter = 0.85 + ((i * 37) % 7) / 20;
      out.push({
        pos: [Math.cos(a) * ringR, stoneSize * 0.6 * jitter, Math.sin(a) * ringR],
        rot: [i * 0.7, a, i * 1.3],
        s: stoneSize * jitter,
      });
    }
    return out;
  }, [ringR, stoneSize]);

  const flames = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!lit) return;
    const t = clock.getElapsedTime();
    if (flames.current) {
      flames.current.children.forEach((c, i) => {
        const k = 1 + 0.18 * Math.sin(t * (7 + i * 2.3) + i) + 0.08 * Math.sin(t * 17 + i * 5);
        c.scale.set(1, k * strength, 1);
        c.rotation.y = t * (0.6 + i * 0.2);
      });
    }
    if (light.current) {
      light.current.intensity = (3.2 + 0.9 * Math.sin(t * 11) + 0.5 * Math.sin(t * 23)) * strength;
    }
  });

  const logLen = width * 0.55;
  const logR = width * 0.045;
  const fireH = Math.max(0.5, width * 0.6);
  const grillY = logR * 3 + fireH * 0.45;
  const barR = Math.max(0.006, width * 0.012);
  const jobs = useGrillJobs(pitId);

  return (
    <group>
      {/* Hearth: a dark ash bed inside the ring. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[ringR * 0.95, 20]} />
        <meshStandardMaterial
          color={lit ? '#3a1a0a' : '#2b2724'}
          emissive={lit ? '#ff5a12' : '#000000'}
          emissiveIntensity={lit ? 0.35 * strength : 0}
          roughness={1}
        />
      </mesh>
      {stones.map((st, i) => (
        <mesh key={i} position={st.pos} rotation={st.rot} castShadow receiveShadow>
          <dodecahedronGeometry args={[st.s, 0]} />
          <meshStandardMaterial
            color="#8a8580"
            roughness={0.95}
            emissive={highlight ? '#f59e0b' : '#000000'}
            emissiveIntensity={highlight ? 0.25 : 0}
          />
        </mesh>
      ))}
      {/* Crossed logs: charred when cold, glowing at the ends when lit. */}
      {[0, Math.PI / 2, Math.PI / 4].map((yaw, i) => (
        <mesh
          key={i}
          position={[0, logR * (1.2 + i * 1.6), 0]}
          rotation={[0, yaw, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[logR, logR * 1.1, logLen, 7]} />
          <meshStandardMaterial
            color={lit ? '#5a3418' : '#1f1a17'}
            emissive={lit ? '#ff3d00' : '#000000'}
            emissiveIntensity={lit ? 0.4 * strength : 0}
            roughness={0.9}
          />
        </mesh>
      ))}
      {/* The grill: a grate on two stone posts, over the flames. */}
      <group position={[0, grillY, 0]}>
        {[-1, 1].map((side) => (
          <mesh key={`post${side}`} position={[side * ringR * 0.95, -grillY / 2, 0]} castShadow>
            <boxGeometry args={[stoneSize * 0.7, grillY, stoneSize * 0.7]} />
            <meshStandardMaterial color="#6f6a66" roughness={0.95} />
          </mesh>
        ))}
        {[-2, -1, 0, 1, 2].map((k) => (
          <mesh key={`bar${k}`} position={[0, 0, k * ringR * 0.22]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[barR, barR, ringR * 2, 5]} />
            <meshStandardMaterial
              color={lit ? '#3b2a22' : '#2a2a2a'}
              metalness={0.6}
              roughness={0.5}
              emissive={lit ? '#ff4d00' : '#000000'}
              emissiveIntensity={lit ? 0.05 * strength : 0}
            />
          </mesh>
        ))}
        {jobs.map((job, i) => {
          const look = GRILL_LOOK[job.raw] ?? GRILL_LOOK.fish;
          const food = cookableFor(job.raw);
          const t = food ? Math.min(1, Math.max(0, (now - job.startedAt) / food.cookMs)) : 0;
          const color = new THREE.Color(look.raw).lerp(new THREE.Color(look.done), t);
          const slot = (i - (Math.min(jobs.length, GRILL_SLOTS) - 1) / 2) * ringR * 0.5;
          return (
            <mesh
              key={job.id}
              position={[slot, barR + look.r * width * 0.8, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1, 1, 0.75]}
              castShadow
            >
              <capsuleGeometry args={[look.r * width, look.len * width, 4, 8]} />
              <meshStandardMaterial color={color} roughness={0.8} />
            </mesh>
          );
        })}
      </group>
      {lit && (
        <>
          <group ref={flames} position={[0, logR * 3, 0]}>
            {[
              { x: 0, z: 0, r: 0.22, h: 1, c: '#ff7a1a' },
              { x: 0.08, z: 0.05, r: 0.15, h: 0.8, c: '#ffb020' },
              { x: -0.07, z: -0.06, r: 0.14, h: 0.75, c: '#ff5a10' },
              { x: 0.02, z: -0.09, r: 0.1, h: 0.6, c: '#ffe066' },
            ].map((f, i) => (
              <group key={i} position={[f.x * width, 0, f.z * width]}>
              <mesh position={[0, (f.h * fireH) / 2, 0]}>
                <coneGeometry args={[f.r * width, f.h * fireH, 8, 1, true]} />
                <meshBasicMaterial
                  color={f.c}
                  transparent
                  opacity={0.82}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
              </group>
            ))}
          </group>
          <pointLight
            ref={light}
            position={[0, height + fireH * 0.6, 0]}
            color="#ff9a3c"
            intensity={3.2}
            distance={9}
            decay={2}
          />
        </>
      )}
    </group>
  );
}

/**
 * The chip over a fire pit: how long it has left, and a button to light
 * it or add Wood. Anyone in reach can feed anyone's pit.
 */
export function FirePitControls({
  pitId,
  selfId,
  onClose,
  compact = false,
}: {
  pitId: string;
  selfId: string;
  onClose?: () => void;
  /** Inline inside another chip (the owner's Edit/Delete row). */
  compact?: boolean;
}) {
  const until = useFireBurnUntil(pitId);
  const now = useNow(until);
  const [wood, setWood] = useState(() => materialTotals().wood);
  useEffect(() => subscribeMaterials((t) => setWood(t.wood)), []);
  const lit = until > now;
  const full = isFireFull(pitId, now);
  const noWood = wood < WOOD_PER_FUEL;
  const label = lit ? 'Add wood' : 'Light fire';
  const button = (
    <button
      type="button"
      data-testid="fire-pit-add-wood"
      disabled={full}
      title={
        full
          ? 'The pit is full of wood'
          : noWood
            ? 'You need Wood. Chop a tree and pick up the logs.'
            : `Uses ${WOOD_PER_FUEL} Wood · burns ${Math.round(BURN_MS_PER_WOOD / 60_000)} min`
      }
      onClick={(e) => {
        e.stopPropagation();
        addWoodToFire(pitId, selfId);
      }}
      style={{
        appearance: 'none',
        border: 'none',
        borderRadius: 999,
        padding: '4px 10px',
        fontWeight: 700,
        cursor: full ? 'not-allowed' : 'pointer',
        background: full || noWood ? 'hsla(0,0%,100%,0.08)' : 'hsla(25,95%,55%,0.35)',
        color: full || noWood ? 'hsla(0,0%,100%,0.55)' : '#fed7aa',
      }}
    >
      🔥 {label} · 🪵 {WOOD_PER_FUEL}{compact && lit ? ` · ${formatBurnLeft(until - now)} left` : ''}
    </button>
  );
  const grill = <GrillButtons pitId={pitId} lit={lit} now={now} />;
  if (compact) return <>{button}{grill}</>;
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="fire-pit-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 999,
        background: 'hsla(20,60%,8%,0.92)',
        border: `2px solid ${lit ? 'hsla(25,95%,55%,0.8)' : 'hsla(0,0%,100%,0.25)'}`,
        boxShadow: lit ? '0 0 16px hsla(25,95%,55%,0.5)' : 'none',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: 'white',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 600, padding: '0 4px' }}>
        {lit ? `Burning · ${formatBurnLeft(until - now)}` : 'Cold'}
      </span>
      <span style={{ opacity: 0.7 }}>🪵 {wood}</span>
      {button}
      {grill}
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            appearance: 'none', border: 'none', background: 'transparent',
            color: 'hsla(0,0%,100%,0.7)', cursor: 'pointer', padding: '0 4px', fontSize: 14,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function grillButtonStyle(enabled: boolean): CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderRadius: 999,
    padding: '4px 8px',
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'not-allowed',
    background: enabled ? 'hsla(35,90%,50%,0.3)' : 'hsla(0,0%,100%,0.08)',
    color: enabled ? '#fde68a' : 'hsla(0,0%,100%,0.55)',
    whiteSpace: 'nowrap',
  };
}

/**
 * The grill: one button per raw food this player holds (put one on), and
 * a countdown for each piece already cooking. Cooking needs the fire lit.
 */
function GrillButtons({ pitId, lit, now }: { pitId: string; lit: boolean; now: number }) {
  const jobs = useGrillJobs(pitId);
  const held = useRawFood();
  const full = jobs.length >= GRILL_SLOTS;
  const foods = COOKABLE_FOODS.filter((f) => (held[f.raw] ?? 0) > 0);
  if (foods.length === 0 && jobs.length === 0) return null;
  return (
    <span data-testid="fire-pit-grill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {jobs.map((job) => {
        const f = cookableFor(job.raw);
        if (!f) return null;
        const left = Math.max(0, Math.ceil((job.doneAt - now) / 1000));
        return (
          <span
            key={job.id}
            data-testid="fire-pit-grill-job"
            title={`${f.rawLabel} cooking into ${f.label}`}
            style={{ padding: '2px 6px', borderRadius: 999, background: 'hsla(25,95%,55%,0.18)', color: '#fed7aa' }}
          >
            {f.icon}→{f.cookedIcon} {left}s
          </span>
        );
      })}
      {foods.map((f) => {
        const enabled = lit && !full;
        return (
          <button
            key={f.raw}
            type="button"
            data-testid={`fire-pit-cook-${f.raw}`}
            disabled={!enabled}
            title={
              !lit
                ? 'Light the fire to cook'
                : full
                  ? `The grill holds ${GRILL_SLOTS} at a time`
                  : `Grill 1 ${f.rawLabel} into ${f.label} (${Math.round(f.cookMs / 1000)} s) · rows ${f.rowMetres} m`
            }
            onClick={(e) => {
              e.stopPropagation();
              cookOnFire(pitId, f.raw);
            }}
            style={grillButtonStyle(enabled)}
          >
            Cook {f.icon} {held[f.raw]}
          </button>
        );
      })}
    </span>
  );
}
