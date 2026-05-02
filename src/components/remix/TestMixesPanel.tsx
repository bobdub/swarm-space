/**
 * TestMixesPanel — small sandbox to combine 2–3 elements/molecules and
 * preview the resulting blended compound (color + shell tags + a quick
 * derived family hint).
 *
 * SCAFFOLD STAGE — pure derivation; no field tick, no mint, no persistence.
 * Hooks into `moleculeCatalog` so every input is gated by the periodic
 * table. The "result" is the same `blendColor` used by the Builder Bar so
 * the user can predict what their mix will look like as a prefab.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Beaker, Plus, X } from 'lucide-react';
import { listElements } from '@/lib/remix/moleculeCatalog';
import { blendColor } from '@/lib/virtualHub/compoundCatalog';

interface Slot { symbol: string; count: number; }

const STARTER: Slot[] = [
  { symbol: 'H', count: 2 },
  { symbol: 'O', count: 1 },
];

export function TestMixesPanel() {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<Slot[]>(STARTER);
  const elements = useMemo(() => listElements(), []);

  const result = useMemo(() => {
    const valid = slots.filter((s) => s.symbol && s.count > 0);
    if (valid.length === 0) return null;
    return {
      color: blendColor(valid),
      formula: valid.map((s) => `${s.symbol}${s.count > 1 ? s.count : ''}`).join('·'),
      shells: Array.from(new Set(valid.map((s) => elements.find((e) => e.symbol === s.symbol)?.shell ?? 0))).sort(),
    };
  }, [slots, elements]);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="h-7 w-fit gap-1 text-[11px]"
        aria-label="Open Test Mixes sandbox"
      >
        <Beaker className="h-3.5 w-3.5" />
        Test Mixes
      </Button>
    );
  }

  return (
    <div role="form" aria-label="Test mixes" className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/40 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/90">
          <Beaker className="h-3.5 w-3.5" />
          Test Mixes
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="h-6 w-6"
          aria-label="Close test mixes"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {slots.map((s, i) => (
          <div key={i} className="flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-[10px]">
            <select
              value={s.symbol}
              onChange={(e) => setSlots((p) => p.map((x, j) => j === i ? { ...x, symbol: e.target.value } : x))}
              className="bg-transparent text-[10px] outline-none"
              aria-label={`Slot ${i + 1} symbol`}
            >
              {elements.slice(0, 30).map((e) => <option key={e.symbol} value={e.symbol}>{e.symbol}</option>)}
            </select>
            <input
              type="number"
              min={1}
              max={20}
              value={s.count}
              onChange={(e) => setSlots((p) => p.map((x, j) => j === i ? { ...x, count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } : x))}
              className="w-8 bg-transparent text-[10px] outline-none"
              aria-label={`Slot ${i + 1} count`}
            />
            <button
              type="button"
              onClick={() => setSlots((p) => p.filter((_, j) => j !== i))}
              aria-label="Remove slot"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        {slots.length < 4 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setSlots((p) => [...p, { symbol: 'H', count: 1 }])}
            className="h-6 w-6"
            aria-label="Add slot"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {result && (
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className="h-5 w-5 rounded-sm border border-border/40"
            style={{ backgroundColor: result.color }}
            aria-hidden="true"
          />
          <span className="font-mono text-foreground/90">{result.formula}</span>
          <span className="text-muted-foreground">shells n={result.shells.join(',')}</span>
        </div>
      )}
    </div>
  );
}

export default TestMixesPanel;