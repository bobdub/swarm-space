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
 * - F or the Cast button casts; when a fish bites, F or "Reel in!" lands
 *   it for +1 Food (`sea/fishing.ts`).
 *
 * Inputs go to `sea/crew.ts`; the boat reads them each physics tick.
 */

import { useEffect, useRef, useState } from 'react';
import { moveInput } from '@/lib/brain/moveInput';
import {
  OUT_OF_FOOD_NOTE,
  getCrewRole,
  getMastHold,
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
import {
  BITE_WINDOW_S,
  castOrReel,
  getFishing,
  setFishingReward,
  subscribeFishing,
  type FishingState,
} from '@/lib/brain/sea/fishing';
import { fishingDepth } from '@/lib/brain/sea/villageBoat';

function useFishing(): FishingState {
  const [f, setF] = useState<FishingState>({ ...getFishing() });
  useEffect(() => subscribeFishing(() => setF({ ...getFishing() })), []);
  return f;
}

function fishingLine(f: FishingState): string {
  if (f.phase === 'caught') return 'Caught a fish! +1 Food';
  if (f.phase === 'missed') return 'It got away.';
  if (f.phase === 'bite') return 'Fish on! Reel in!';
  if (f.phase === 'waiting') return f.tooFast ? 'Too fast: the line trails. Slow below 1.5 m/s.' : 'Line out. Waiting for a bite…';
  return 'Cast your line.';
}

function useCrewRole(): CrewRole | null {
  const [role, setRole] = useState<CrewRole | null>(getCrewRole());
  useEffect(() => subscribeCrew(() => setRole(getCrewRole())), []);
  return role;
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

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
  const [readout, setReadout] = useState({ sail: 0, speed: 0, wind: 0, windFrom: 0, food: 0, out: false, mast: null as 1 | -1 | null });

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
      castOrReel(getEarthPoseTime(), fishingDepth());
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
    ? mobile ? 'Joystick turns the wheel · hold the mast for the sail' : 'A/D wheel · W/S sail · or hold the mast'
    : role === 'oars'
      ? mobile ? 'Joystick rows and turns' : 'W/S row · A/D turn'
      : mobile ? 'Tap Cast, then Reel in when a fish bites' : 'F casts · F reels in when a fish bites';
  const lineOut = fishing.phase === 'waiting' || fishing.phase === 'bite';
  const castButton = role === 'rod' ? (
    <button
      type="button"
      data-testid="fishing-cast"
      onPointerDown={(e) => { e.preventDefault(); castOrReel(getEarthPoseTime(), fishingDepth()); }}
      className="absolute z-[70] left-1/2 -translate-x-1/2 rounded-full border px-5 py-2 text-sm font-semibold text-white select-none"
      style={{
        bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 16.5rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 10.5rem)',
        background: fishing.phase === 'bite' ? 'hsla(38,90%,40%,0.95)' : 'hsla(265,70%,8%,0.85)',
        borderColor: fishing.phase === 'bite' ? 'hsla(38,90%,70%,0.9)' : 'hsla(180,80%,60%,0.55)',
        touchAction: 'none',
      }}
      aria-label={fishing.phase === 'bite' ? `Reel in (${BITE_WINDOW_S} seconds)` : lineOut ? 'Reel in the line' : 'Cast the line'}
    >
      {fishing.phase === 'bite' ? 'Reel in!' : lineOut ? 'Reel in' : 'Cast'}
    </button>
  ) : null;
  return (
    <>
    {castButton}
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
        <div className={fishing.phase === 'bite' ? 'font-semibold text-amber-300' : fishing.phase === 'caught' ? 'text-emerald-300' : ''} data-testid="fishing-line">
          {fishingLine(fishing)}
        </div>
      )}
      {role === 'oars' && readout.out && <div className="text-amber-300">{OUT_OF_FOOD_NOTE}</div>}
      <div className="mt-1 opacity-70">{hint}</div>
    </div>
    </>
  );
}
