/**
 * ShipWheel — the controls while you crew the boat.
 *
 * At the helm:
 * - A / D or the joystick turn the wheel (it eases back to centre when
 *   let go). The joystick shows a ship's wheel turning with it.
 * - W raises the sail, S lowers it. On touch, press and hold the mast.
 * At the oars:
 * - W / S or joystick forward/back row ahead or back water; A / D or
 *   joystick left/right pull one oar harder to turn.
 * - Rowing spends Food (1 per 60 m). At 0 Food the oars stop.
 * At a rod:
 * - F or the Cast button casts; when a fish bites, F or "Hook it!" hooks
 *   it. Then it fights: strike (F, the Reel button, or a click on the bar)
 *   while the marker is in the gold zone. Three good strikes land it for
 *   +1 Food; two bad ones and it gets away (`sea/fishing.ts`).
 * Aground (your own boat, at the wheel or the oars):
 * - R or the Push off button shoves her off toward deeper water.
 *
 * Inputs go to `sea/crew.ts`; the boat reads them each physics tick.
 */

import { useEffect, useRef, useState } from 'react';
import { moveInput } from '@/lib/brain/moveInput';
import {
  OUT_OF_FOOD_NOTE,
  getCrewRole,
  getMastHold,
  holdSail,
  stopMastHold,
  isOutOfFood,
  setCrewInput,
  setFoodPurse,
  subscribeCrew,
  type CrewRole,
} from '@/lib/brain/sea/crew';
import { getVillageBoat } from '@/lib/brain/sea/vessel';
import { materialTotals, spendMaterials } from '@/lib/world/materials';
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { toast } from 'sonner';
import {
  BITE_WINDOW_S,
  FIGHT_HITS,
  FIGHT_MISSES,
  castOrReel,
  getFishing,
  markerAt,
  setFishingReward,
  subscribeFishing,
  type FishingState,
} from '@/lib/brain/sea/fishing';
import { fishingDepth, fishingSchoolNear, myBoatAground, pushOffMyBoat } from '@/lib/brain/sea/villageBoat';

function useFishing(): FishingState {
  const [f, setF] = useState<FishingState>({ ...getFishing() });
  useEffect(() => subscribeFishing(() => setF({ ...getFishing() })), []);
  return f;
}

function fishingLine(f: FishingState): string {
  if (f.phase === 'caught') return 'Caught a fish! +1 Food';
  if (f.phase === 'missed') return 'It got away.';
  if (f.phase === 'bite') return 'Fish on! Hook it!';
  if (f.phase === 'fight') return 'Fighting! Strike while the marker is in the gold zone.';
  if (f.phase === 'waiting') return f.tooFast ? 'Too fast: the line trails. Slow below 1.5 m/s.' : 'Line out. Waiting for a bite…';
  return 'Cast your line.';
}

function useCrewRole(): CrewRole | null {
  const [role, setRole] = useState<CrewRole | null>(getCrewRole());
  useEffect(() => subscribeCrew(() => setRole(getCrewRole())), []);
  return role;
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function pushOff(): void {
  const r = pushOffMyBoat();
  if (r === 'stuck') toast.message('She won\'t budge', { description: 'No deeper water close by. Try the oars: row astern or turn her.', id: 'push-off' });
}

/** The reeling fight: strike while the marker is inside the gold zone. */
function FightBar({ fishing, mobile }: { fishing: FishingState; mobile: boolean }) {
  const markerRef = useRef<HTMLDivElement>(null);
  const f = fishing.fight;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = markerRef.current;
      if (el) el.style.left = `${markerAt(getEarthPoseTime()) * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (fishing.phase !== 'fight' || !f) return null;
  const flash = f.last && getEarthPoseTime() - f.lastAt < 0.6 ? f.last : null;
  return (
    <div
      className="absolute z-[70] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 select-none"
      style={{ bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 19.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 13.5rem)' }}
    >
      <div className="flex gap-3 text-xs text-white" aria-live="polite">
        <span data-testid="fight-hits">{'🐟'.repeat(f.hits)}{'·'.repeat(FIGHT_HITS - f.hits)} {f.hits}/{FIGHT_HITS}</span>
        <span className="text-rose-300" data-testid="fight-misses">{'✕'.repeat(f.misses)}{'·'.repeat(FIGHT_MISSES - f.misses)}</span>
      </div>
      <button
        type="button"
        data-testid="fight-bar"
        aria-label="Strike while the marker is in the gold zone"
        onPointerDown={(e) => { e.preventDefault(); castOrReel(getEarthPoseTime(), fishingDepth(), fishingSchoolNear()); }}
        className="relative h-7 rounded-full border overflow-hidden"
        style={{
          width: mobile ? 240 : 300,
          background: 'hsla(265,70%,8%,0.85)',
          borderColor: flash === 'hit' ? 'hsla(140,80%,60%,0.95)' : flash === 'miss' ? 'hsla(0,80%,60%,0.95)' : 'hsla(180,80%,60%,0.55)',
          touchAction: 'none',
        }}
      >
        <div
          className="absolute inset-y-0"
          style={{
            left: `${(f.zoneC - f.zoneW / 2) * 100}%`,
            width: `${f.zoneW * 100}%`,
            background: 'hsla(42,95%,55%,0.75)',
          }}
        />
        <div
          ref={markerRef}
          className="absolute inset-y-0 -translate-x-1/2"
          style={{ width: 4, background: 'white', boxShadow: '0 0 6px white' }}
        />
      </button>
    </div>
  );
}

/** A ship's wheel drawn over the joystick while you hold the helm. */
export function CrewJoystickSkin() {
  const role = useCrewRole();
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (role !== 'helm') return;
    let raf = 0;
    const loop = () => {
      const turns = getVillageBoat().cmd.wheel * 1.5;
      if (ref.current) ref.current.style.transform = `rotate(${turns * 360}deg)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [role]);
  if (role !== 'helm') return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-[hsla(265,70%,8%,0.85)]"
      data-testid="joystick-wheel"
    >
      <svg ref={ref} viewBox="-50 -50 100 100" className="h-[88%] w-[88%]" aria-hidden="true">
        <circle r="34" fill="none" stroke="hsl(30,45%,55%)" strokeWidth="7" />
        <circle r="7" fill="hsl(30,45%,40%)" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={Math.sin(a) * 7}
              y1={-Math.cos(a) * 7}
              x2={Math.sin(a) * 46}
              y2={-Math.cos(a) * 46}
              stroke="hsl(30,45%,50%)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
  );
}

/** Keyboard + joystick → crew input, and the small boat readout. */
export function ShipControls({ mobile }: { mobile: boolean }) {
  const role = useCrewRole();
  const keys = useRef<Record<string, boolean>>({});
  const [readout, setReadout] = useState({ sail: 0, speed: 0, wind: 0, windFrom: 0, food: 0, out: false, mast: null as 1 | -1 | null, school: false, aground: false });

  // Food comes out of the gathered inventory on this device, and a fish
  // goes into it.
  useEffect(() => {
    setFoodPurse({
      has: () => materialTotals().food > 0,
      spendOne: () => spendMaterials({ food: 1 }),
    });
    setFishingReward(() => recordHarvestForResource('food', 1));
    return () => { setFoodPurse(null); setFishingReward(null); };
  }, []);
  const fishing = useFishing();

  // F casts and reels at a rod.
  useEffect(() => {
    if (role !== 'rod') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      castOrReel(getEarthPoseTime(), fishingDepth(), fishingSchoolNear());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role]);

  // R pushes off when aground.
  useEffect(() => {
    if (role !== 'helm' && role !== 'oars') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyR' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      pushOff();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const map: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd' };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => { const k = map[e.code]; if (k && !typing(e)) keys.current[k] = true; };
    const up = (e: KeyboardEvent) => { const k = map[e.code]; if (k) keys.current[k] = false; };
    const clear = () => { keys.current = {}; };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    let raf = 0;
    let frame = 0;
    const loop = () => {
      const k = keys.current;
      const kx = (k.d ? 1 : 0) - (k.a ? 1 : 0);
      const ky = (k.w ? 1 : 0) - (k.s ? 1 : 0);
      if (role === 'helm') {
        const mast = getMastHold();
        setCrewInput({ wheel: clamp1(kx + moveInput.right), sail: mast ?? ky, row: 0, rowTurn: 0 });
      } else if (role === 'rod') {
        setCrewInput({ wheel: 0, sail: 0, row: 0, rowTurn: 0 });
      } else {
        setCrewInput({ wheel: 0, sail: 0, row: clamp1(ky + moveInput.fwd), rowTurn: clamp1(kx + moveInput.right) });
      }
      if ((frame++ & 7) === 0) {
        const boat = getVillageBoat();
        const w = boat.windOnBow();
        setReadout({
          sail: boat.cmd.sail,
          speed: boat.speed(),
          wind: w.speed,
          windFrom: w.from,
          food: materialTotals().food,
          out: isOutOfFood(),
          mast: getMastHold(),
          school: role === 'rod' && fishingSchoolNear(),
          aground: myBoatAground(),
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', clear);
      keys.current = {};
      setCrewInput({ wheel: 0, sail: 0, row: 0, rowTurn: 0 });
    };
  }, [role]);

  if (!role) return null;
  const knots = readout.speed * 1.944;
  const deg = Math.round((readout.windFrom * 180) / Math.PI);
  const windSide = Math.abs(deg) < 3 ? 'dead ahead' : Math.abs(deg) > 177 ? 'astern' : `${Math.abs(deg)}° ${deg > 0 ? 'starboard' : 'port'}`;
  const hint = role === 'helm'
    ? mobile ? 'Joystick turns the wheel · hold Raise sail to get under way' : 'A/D wheel · W/S or hold Raise / Lower sail'
    : role === 'oars'
      ? mobile ? 'Push the joystick forward to row, sideways to turn' : 'W/S row · A/D turn'
      : mobile ? 'Tap Cast, Hook it when a fish bites, then tap in the gold zone' : 'F casts · F hooks · F strikes in the gold zone';
  const lineOut = fishing.phase === 'waiting' || fishing.phase === 'bite' || fishing.phase === 'fight';
  const hot = fishing.phase === 'bite' || fishing.phase === 'fight';
  const castButton = role === 'rod' ? (
    <button
      type="button"
      data-testid="fishing-cast"
      onPointerDown={(e) => { e.preventDefault(); castOrReel(getEarthPoseTime(), fishingDepth(), fishingSchoolNear()); }}
      className="absolute z-[70] left-1/2 -translate-x-1/2 rounded-full border px-5 py-2 text-sm font-semibold text-white select-none"
      style={{
        bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 16.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 10.5rem)',
        background: hot ? 'hsla(38,90%,40%,0.95)' : 'hsla(265,70%,8%,0.85)',
        borderColor: hot ? 'hsla(38,90%,70%,0.9)' : 'hsla(180,80%,60%,0.55)',
        touchAction: 'none',
      }}
      aria-label={fishing.phase === 'bite' ? `Hook the fish (${BITE_WINDOW_S} seconds)` : fishing.phase === 'fight' ? 'Strike' : lineOut ? 'Reel in the line' : 'Cast the line'}
    >
      {fishing.phase === 'bite' ? 'Hook it!' : fishing.phase === 'fight' ? 'Reel!' : lineOut ? 'Reel in' : 'Cast'}
    </button>
  ) : null;
  const sailButton = (dir: 1 | -1, label: string) => (
    <button
      type="button"
      data-testid={dir > 0 ? 'sail-raise' : 'sail-lower'}
      onPointerDown={(e) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        holdSail(dir);
      }}
      onPointerUp={() => stopMastHold()}
      onPointerCancel={() => stopMastHold()}
      onContextMenu={(e) => e.preventDefault()}
      className="rounded-full border px-4 py-2 text-sm font-semibold text-white select-none"
      style={{
        background: readout.mast === dir ? 'hsla(180,70%,30%,0.95)' : 'hsla(265,70%,8%,0.85)',
        borderColor: 'hsla(180,80%,60%,0.55)',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
      }}
      aria-label={`Hold to ${label.toLowerCase()}`}
    >
      {dir > 0 ? '▲' : '▼'} {label}
    </button>
  );
  const sailButtons = role === 'helm' ? (
    <div
      className="absolute z-[70] left-1/2 -translate-x-1/2 flex gap-2"
      style={{ bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 16.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 10.5rem)' }}
    >
      {sailButton(1, 'Raise sail')}
      {sailButton(-1, 'Lower sail')}
    </div>
  ) : null;
  const pushOffButton = (role === 'helm' || role === 'oars') && readout.aground ? (
    <button
      type="button"
      data-testid="push-off"
      onPointerDown={(e) => { e.preventDefault(); pushOff(); }}
      className="absolute z-[70] left-1/2 -translate-x-1/2 rounded-full border px-5 py-2 text-sm font-semibold text-white select-none"
      style={{
        bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 19.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 13.5rem)',
        background: 'hsla(28,85%,38%,0.95)',
        borderColor: 'hsla(38,90%,70%,0.9)',
        touchAction: 'none',
      }}
      aria-label="Push off the ground"
    >
      Push off{mobile ? '' : ' (R)'}
    </button>
  ) : null;
  return (
    <>
    {castButton}
    {sailButtons}
    {pushOffButton}
    {role === 'rod' && <FightBar fishing={fishing} mobile={mobile} />}
    <div
      data-testid="ship-readout"
      className="pointer-events-none absolute left-1/2 z-[70] -translate-x-1/2 rounded-xl border px-3 py-2 text-xs text-white"
      style={{
        top: mobile ? '4.5rem' : '4rem',
        background: 'hsla(265,70%,8%,0.8)',
        borderColor: 'hsla(180,80%,60%,0.4)',
        minWidth: 220,
      }}
    >
      <div className="font-semibold">{role === 'helm' ? 'At the helm' : role === 'oars' ? 'At the oars' : 'Fishing'}</div>
      <div className="mt-1 flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{ display: 'inline-block', transform: `rotate(${deg + 180}deg)` }}
          title="Wind direction relative to the bow"
        >
          ↑
        </span>
        <span>Wind {readout.wind.toFixed(1)} m/s from {windSide}</span>
      </div>
      <div>Speed {readout.speed.toFixed(1)} m/s ({knots.toFixed(1)} kn)</div>
      {role === 'helm' && (
        <div>
          Sail {Math.round(readout.sail * 100)}%
          {readout.mast ? (readout.mast > 0 ? ' · raising' : ' · lowering') : ''}
        </div>
      )}
      {(role === 'oars' || role === 'rod') && <div>Food {readout.food}</div>}
      {role === 'rod' && (
        <div className={hot ? 'font-semibold text-amber-300' : fishing.phase === 'caught' ? 'text-emerald-300' : ''} data-testid="fishing-line">
          {fishingLine(fishing)}
        </div>
      )}
      {role === 'rod' && readout.school && (
        <div className="text-sky-300" data-testid="fishing-school">A school of fish is under the boat. Bites come fast here.</div>
      )}
      {role === 'oars' && readout.out && <div className="text-amber-300">{OUT_OF_FOOD_NOTE}</div>}
      {(role === 'helm' || role === 'oars') && readout.aground && (
        <div className="font-semibold text-amber-300" data-testid="aground">Aground! Push off, or row astern.</div>
      )}
      <div className="mt-1 opacity-70">{hint}</div>
    </div>
    </>
  );
}
