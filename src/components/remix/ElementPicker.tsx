/**
 * ElementPicker — searchable list of real elements + common molecules.
 * Source of truth: `src/lib/remix/moleculeCatalog.ts`, which is in turn
 * gated by `SHELL_DEFS ∪ INNER_SYMBOLS`. Selecting an item only marks
 * intent — the field is touched in a follow-up via `labField`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  searchPeriodic,
  type ElementEntry,
  type Molecule,
} from '@/lib/remix/moleculeCatalog';
import {
  getHarvested,
  subscribeHarvested,
} from '@/lib/remix/harvestedInventory';

interface ElementPickerProps {
  selectedId: string | null;
  onSelect: (id: string, color: string) => void;
}

export function ElementPicker({ selectedId, onSelect }: ElementPickerProps) {
  const [query, setQuery] = useState('');
  const [, setTick] = useState(0);
  const { elements, molecules } = useMemo(() => searchPeriodic(query), [query]);

  // Re-render when the harvested inventory changes so lock overlays update.
  useEffect(() => subscribeHarvested(() => setTick((n) => n + 1)), []);

  return (
    <div role="form" aria-label="Element picker" className="flex h-full flex-col gap-2">
      <Input
        type="text"
        placeholder="Search H, O, water, glucose…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="flex-1 overflow-y-auto pr-1">
        <Section title="Elements">
          <div className="grid grid-cols-4 gap-1">
            {elements.map((e) => (
              <ElementChip
                key={e.symbol}
                entry={e}
                locked={getHarvested(e.symbol) <= 0}
                selected={selectedId === `el:${e.symbol}`}
                onSelect={() => onSelect(`el:${e.symbol}`, e.color)}
              />
            ))}
            {elements.length === 0 && (
              <div className="col-span-4 px-1 py-2 text-[10px] text-muted-foreground">
                No matching element.
              </div>
            )}
          </div>
        </Section>
        <Section title="Molecules">
          <div className="flex flex-col gap-1">
            {molecules.map((m) => (
              <MoleculeRow
                key={m.id}
                mol={m}
                locked={m.constituents.some((c) => getHarvested(c.symbol) < c.count)}
                selected={selectedId === `mol:${m.id}`}
                onSelect={() => onSelect(`mol:${m.id}`, m.color)}
              />
            ))}
            {molecules.length === 0 && (
              <div className="px-1 py-2 text-[10px] text-muted-foreground">
                No matching molecule.
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function ElementChip({
  entry,
  selected,
  locked,
  onSelect,
}: {
  entry: ElementEntry;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  const held = getHarvested(entry.symbol);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={
        locked
          ? `${entry.symbol} locked — harvest in-world to unlock`
          : `${entry.symbol} · n=${entry.shell} · M≈${entry.atomicMass} · held ${held}`
      }
      className={[
        'relative flex flex-col items-center gap-0.5 rounded-md border px-1 py-1 text-[10px] transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : locked
            ? 'border-border/30 bg-background/30 opacity-60 hover:opacity-90'
            : 'border-border/50 bg-background/60 hover:border-border',
      ].join(' ')}
    >
      <span
        className="h-4 w-4 rounded-full border border-border/40"
        style={{ backgroundColor: entry.color }}
        aria-hidden="true"
      />
      <span className="font-medium text-foreground/90">{entry.symbol}</span>
      <span className="text-[9px] text-muted-foreground">{locked ? 'locked' : `×${held}`}</span>
      {locked && (
        <Lock
          className="pointer-events-none absolute right-0.5 top-0.5 h-2.5 w-2.5 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function MoleculeRow({
  mol,
  selected,
  locked,
  onSelect,
}: {
  mol: Molecule;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  const need = mol.constituents
    .map((c) => `${c.count}× ${c.symbol} (have ${getHarvested(c.symbol)})`)
    .join(', ');
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={locked ? `${mol.name} locked — needs ${need}` : `${mol.name} · ${mol.formula}`}
      className={[
        'relative flex items-center gap-2 rounded-md border px-2 py-1 text-left text-[11px] transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : locked
            ? 'border-border/30 bg-background/30 opacity-60 hover:opacity-90'
            : 'border-border/50 bg-background/60 hover:border-border',
      ].join(' ')}
    >
      <span
        className="h-4 w-4 shrink-0 rounded-sm border border-border/40"
        style={{ backgroundColor: mol.color }}
        aria-hidden="true"
      />
      <span className="flex flex-col leading-tight">
        <span className="font-medium text-foreground/90">{mol.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {mol.formula} · shells n={mol.shellTags.join(',')}
        </span>
      </span>
      {locked && (
        <Lock className="ml-auto h-3 w-3 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

export default ElementPicker;