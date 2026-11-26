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
import { ChevronDown, ChevronUp, Wind, Undo2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
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
import { recordPlayerHarvest } from '@/lib/world/playerHarvest';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { toast } from 'sonner';
import {
  BITE_WINDOW_S,
  FIGHT_MISSES,
  castOrReel,
  getFishing,
  markerAt,
  setFishingReward,
  setSharkCheck,
  subscribeFishing,
  type FishingState,
} from '@/lib/brain/sea/fishing';
import { fishingDepth, fishingSchoolNear, fishingShark, fishingSharkStillThere, myBoatAground, pushOffMyBoat } from '@/lib/brain/sea/villageBoat';
import { recordSharkCaught } from '@/lib/brain/sea/sharks';

/** The one press at a rod: cast, hook, strike or wind in. */
function rodPress(): void {
  castOrReel(getEarthPoseTime(), fishingDepth(), fishingSchoolNear(), fishingShark());
}

function useFishing(): FishingState {
  const [f, setF] = useState<FishingState>({ ...getFishing() });
  useEffect(() => subscribeFishing(() => setF({ ...getFishing() })), []);
  return f;
}

function fishingLine(f: FishingState): string {
  const shark = f.on === 'shark';
  if (f.phase === 'caught') return shark ? 'Shark +1' : 'Fish +1';
  if (f.phase === 'missed') return 'It got away.';
  if (f.phase === 'bite') return shark ? 'Shark bite!' : 'Fish bite!';
  if (f.phase === 'fight') return shark ? 'Shark · reeling' : 'Fish · reeling';
  if (f.phase === 'waiting') return f.tooFast ? 'Too fast · slow down' : 'Waiting for a bite';
  return 'Line ready';
}

export function useCrewRole(): CrewRole | null {
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
      className="absolute z-[70] right-36 bottom-[calc(env(safe-area-inset-bottom,0px)+6.25rem)] flex flex-col items-center gap-1 select-none"
    >
      <div className="flex gap-3 text-xs text-white" aria-live="polite">
        <span data-testid="fight-hits">{(fishing.on === 'shark' ? '🦈' : '🐟').repeat(f.hits)}{'·'.repeat(Math.max(0, f.need - f.hits))} {f.hits}/{f.need}</span>
        <span className="text-rose-300" data-testid="fight-misses">{'✕'.repeat(f.misses)}{'·'.repeat(FIGHT_MISSES - f.misses)}</span>
      </div>
      <button
        type="button"
        data-testid="fight-bar"
        aria-label="Strike while the marker is in the gold zone"
        onPointerDown={(e) => { e.preventDefault(); rodPress(); }}
        className="relative h-7 rounded-full border overflow-hidden"
        style={{
          width: `min(${mobile ? 180 : 220}px, calc(100vw - 10rem))`,
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
export function ShipControls({ mobile, readoutTarget }: { mobile: boolean; readoutTarget: HTMLDivElement | null }) {
  const role = useCrewRole();
  const keys = useRef<Record<string, boolean>>({});
  const [readout, setReadout] = useState({ sail: 0, speed: 0, wind: 0, windFrom: 0, food: 0, out: false, mast: null as 1 | -1 | null, school: false, shark: false, aground: false });

  // Food comes out of the gathered inventory on this device, and a fish
  // goes into it.
  useEffect(() => {
    setFoodPurse({
      has: () => materialTotals().food > 0,
      spendOne: () => spendMaterials({ food: 1 }),
    });
    setFishingReward((_food, kind, sharkId) => {
      // A catch is its own good (sold at the Trading Stand), not Food.
      recordPlayerHarvest(kind === 'shark' ? 'shark' : 'fish', 1);
      // A landed shark is gone from the sea for everyone for a while.
      if (kind === 'shark' && sharkId) recordSharkCaught(sharkId);
    });
    setSharkCheck(fishingSharkStillThere);
    return () => { setFoodPurse(null); setFishingReward(null); setSharkCheck(null); };
  }, []);
  const fishing = useFishing();

  // F casts and reels at a rod.
  useEffect(() => {
    if (role !== 'rod') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      rodPress();
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
          shark: role === 'rod' && !!fishingShark(),
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
  const lineOut = fishing.phase === 'waiting' || fishing.phase === 'bite' || fishing.phase === 'fight';
  const hot = fishing.phase === 'bite' || fishing.phase === 'fight';
  const castButton = role === 'rod' ? (
    <Button
      type="button"
      variant={hot ? 'secondary' : 'outline'}
      data-testid="fishing-cast"
      onPointerDown={(e) => { e.preventDefault(); rodPress(); }}
      className="h-11 w-28 shrink-0 rounded-full border-accent/50 bg-background/80 px-2 text-[11px] text-foreground select-none touch-none"
      aria-label={fishing.phase === 'bite' ? `Hook the fish (${BITE_WINDOW_S} seconds)` : fishing.phase === 'fight' ? 'Strike' : lineOut ? 'Reel in the line' : 'Cast the line'}
    >
      {fishing.phase === 'bite' ? 'Hook!' : fishing.phase === 'fight' ? 'Reel!' : lineOut ? 'Reel in' : 'Cast'}
    </Button>
  ) : null;
  const sailButton = (dir: 1 | -1, label: string) => (
    <Button
      type="button"
      variant="ghost"
      data-testid={dir > 0 ? 'sail-raise' : 'sail-lower'}
      onPointerDown={(e) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        holdSail(dir);
      }}
      onPointerUp={() => stopMastHold()}
      onPointerCancel={() => stopMastHold()}
      onLostPointerCapture={() => stopMastHold()}
      onContextMenu={(e) => e.preventDefault()}
      className={`shrink-0 rounded-full border border-accent/50 text-foreground select-none touch-none ${readout.mast === dir ? 'bg-secondary/90' : 'bg-background/80'} h-11 w-11 p-0`}
      style={{
        WebkitTouchCallout: 'none',
      }}
      aria-label={`Hold to ${label.toLowerCase()}`}
    >
      {dir > 0 ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </Button>
  );
  const sailButtons = role === 'helm' ? (
    <>
      {sailButton(1, 'Raise sail')}
      {sailButton(-1, 'Lower sail')}
    </>
  ) : null;
  const pushOffButton = (role === 'helm' || role === 'oars') && readout.aground ? (
    <Button
      type="button"
      variant="outline"
      data-testid="push-off"
      onPointerDown={(e) => { e.preventDefault(); pushOff(); }}
      className="absolute right-full mr-1 h-11 w-11 shrink-0 rounded-full border-accent/50 bg-background/80 p-0 text-foreground select-none touch-none"
      aria-label="Push off the ground"
    >
      <Undo2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  ) : null;
  return (
    <>
    <div className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+6.25rem)] z-[70] flex h-11 w-28 items-center justify-center gap-1">
      {castButton}
      {sailButtons}
      {pushOffButton}
    </div>
    {role === 'rod' && <FightBar fishing={fishing} mobile={mobile} />}
    {readoutTarget && createPortal(
      <div data-testid="ship-readout" className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 tabular-nums">
        <span>{role === 'helm' ? 'Helm' : role === 'oars' ? 'Oars' : 'Fishing'}</span>
        <span aria-label={`Speed ${knots.toFixed(1)} knots`}>{knots.toFixed(1)} kn</span>
        <span className="flex items-center gap-0.5" aria-label={`Wind ${readout.wind.toFixed(1)} meters per second from ${windSide}`}>
          <Wind className="h-2.5 w-2.5" aria-hidden="true" />
          {readout.wind.toFixed(1)} m/s · {Math.abs(deg)}°{deg > 0 ? ' R' : deg < 0 ? ' L' : ''}
        </span>
        {role === 'helm' ? <span>Sail {Math.round(readout.sail * 100)}%</span> : <span>Food {readout.food}</span>}
        {role === 'rod' && <span className={hot ? 'font-semibold text-accent' : ''} data-testid="fishing-line">{fishingLine(fishing)}</span>}
        {role === 'rod' && readout.shark && <span data-testid="fishing-shark">Shark nearby</span>}
        {role === 'rod' && readout.school && <span data-testid="fishing-school">Fish below</span>}
        {role === 'oars' && readout.out && <span className="text-destructive" aria-label={OUT_OF_FOOD_NOTE}>No food</span>}
        {(role === 'helm' || role === 'oars') && readout.aground && <span className="font-semibold text-destructive" data-testid="aground">Aground</span>}
      </div>, readoutTarget,
    )}
    </>
  );
}
