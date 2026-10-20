import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { GRAFFITI_PALETTE, graffitiHoldMs, REINFORCE_CREDITS, REINFORCE_SWARM } from '@/lib/world/wallInteractionRules';
import { recordWallInteraction } from '@/lib/world/wallInteractionsStore';
import { reinforceWall } from '@/lib/world/wallReinforce';
import { addReaction } from '@/lib/interactions';

interface Props {
  placementId: string;
  ownerId: string;
  selfId: string;
  postId: string | null;
  priorStamps: number;
  onClose: () => void;
}

/** Visitor-only chip: Reinforce (fixed tip) and Graffiti (hold an emoji to stamp). */
export function WallViewerControls({ placementId, ownerId, selfId, postId, priorStamps, onClose }: Props) {
  const [mode, setMode] = useState<'menu' | 'graffiti'>('menu');
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const holdMs = graffitiHoldMs(priorStamps);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setHolding(null);
    setProgress(0);
  };

  const begin = (emoji: string) => {
    const start = performance.now();
    setHolding(emoji);
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / holdMs);
      setProgress(p);
      if (p >= 1) {
        recordWallInteraction({ placementId, kind: 'graffiti', actorId: selfId, emoji });
        if (postId) void addReaction(postId, emoji).catch(() => {});
        toast.success(`Graffiti ${emoji} stamped`);
        stop();
        onClose();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const reinforce = async () => {
    setBusy(true);
    try {
      const paid = await reinforceWall({ placementId, actorId: ownerId });
      toast.success(`Wall reinforced · ${paid} tipped to the builder`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reinforce failed');
    } finally { setBusy(false); }
  };

  const secs = Math.round(holdMs / 100) / 10;
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={chip}>
      {mode === 'menu' ? (
        <>
          <button type="button" disabled={busy} onClick={reinforce} style={{ ...btn, color: '#fcd34d' }}
            title={`Tip ${REINFORCE_SWARM} SWARM (or ${REINFORCE_CREDITS} credits) to the builder`}>
            {busy ? 'Tipping…' : 'Reinforce'}
          </button>
          <button type="button" onClick={() => setMode('graffiti')} style={{ ...btn, color: '#7dd3fc' }}>Graffiti</button>
          <button type="button" onClick={onClose} style={btn} aria-label="Close">✕</button>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {GRAFFITI_PALETTE.map((e) => (
              <button key={e} type="button" aria-label={`Hold to stamp ${e}`}
                onPointerDown={(ev) => { ev.stopPropagation(); begin(e); }}
                onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
                style={{ ...btn, minWidth: 34, fontSize: 18, padding: '2px 6px', position: 'relative',
                  background: holding === e
                    ? `conic-gradient(hsla(45,95%,60%,0.85) ${progress * 360}deg, hsla(0,0%,100%,0.08) 0deg)`
                    : btn.background }}>
                {e}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 10, opacity: 0.8 }}>Hold {secs}s to stamp</span>
        </div>
      )}
    </div>
  );
}

const chip: React.CSSProperties = {
  display: 'flex', gap: 6, padding: '6px 8px', borderRadius: 999,
  background: 'hsla(265,70%,8%,0.92)', border: '2px solid hsla(45,90%,60%,0.6)',
  boxShadow: '0 0 16px hsla(45,90%,60%,0.35)', fontFamily: 'system-ui, sans-serif',
  fontSize: 12, color: 'white', whiteSpace: 'nowrap', touchAction: 'none',
};
const btn: React.CSSProperties = {
  appearance: 'none', border: 'none', background: 'hsla(0,0%,100%,0.08)', color: 'white',
  borderRadius: 999, padding: '4px 10px', fontWeight: 700, cursor: 'pointer', minWidth: 48,
};
