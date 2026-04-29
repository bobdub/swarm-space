/**
 * LabTab — the Elemental Alchemy Lab creator surface.
 *
 * SCAFFOLD STAGE — composes the vector canvas, element picker, and a
 * UQRC live-stats strip backed by `labField`. The 4 Hz tick scheduler,
 * `u(t)` projection render, and Mint flow are wired in follow-ups.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw } from 'lucide-react';
import { VectorCanvas } from './VectorCanvas';
import { ElementPicker } from './ElementPicker';
import { resetLab, subscribeLab, type LabFieldStats } from '@/lib/remix/labField';

const DEFAULT_STROKE = 'hsl(var(--primary))';

export function LabTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [strokeColor, setStrokeColor] = useState<string>(DEFAULT_STROKE);
  const [stats, setStats] = useState<LabFieldStats>({ ticks: 0, qScore: 0 });

  useEffect(() => subscribeLab(setStats), []);

  const handleSelect = (id: string, color: string) => {
    setSelectedId(id);
    setStrokeColor(color);
  };

  return (
    <div className="grid h-[calc(100vh-13rem)] grid-cols-1 gap-3 md:grid-cols-[1fr_240px]">
      {/* Canvas + HUD */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary">
              Lab
            </span>
            <span>Draw, assign elements, evolve in UQRC.</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>ticks {stats.ticks}</span>
            <span>Q {stats.qScore.toFixed(4)}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => resetLab()}
              className="h-7 gap-1 text-[11px]"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </div>
        <div className="flex-1">
          <VectorCanvas strokeColor={strokeColor} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {selectedId
              ? `Brush bound to ${selectedId.replace('el:', '').replace('mol:', '')}`
              : 'Pick an element or molecule to assign your strokes.'}
          </span>
          <Button
            type="button"
            size="sm"
            disabled
            className="h-8 gap-1 text-[11px]"
            title="Mint coming online with the field tick — scaffold stage."
          >
            <Sparkles className="h-3.5 w-3.5" />
            Mint as Asset
          </Button>
        </div>
      </div>

      {/* Picker */}
      <aside className="rounded-md border border-border/40 bg-background/40 p-2">
        <ElementPicker selectedId={selectedId} onSelect={handleSelect} />
      </aside>
    </div>
  );
}

export default LabTab;