/**
 * ElementPicker — searchable list of real elements + common molecules.
 * Source of truth: `src/lib/remix/moleculeCatalog.ts`, which is in turn
 * gated by `SHELL_DEFS ∪ INNER_SYMBOLS`. Selecting an item only marks
 * intent — the field is touched in a follow-up via `labField`.
 */
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  searchPeriodic,
  type ElementEntry,
  type Molecule,
} from '@/lib/remix/moleculeCatalog';

interface ElementPickerProps {
  selectedId: string | null;
  onSelect: (id: string, color: string) => void;
}

export function ElementPicker({ selectedId, onSelect }: ElementPickerProps) {
  const [query, setQuery] = useState('');
  const { elements, molecules } = useMemo(() => searchPeriodic(query), [query]);

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
  onSelect,
}: {
  entry: ElementEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${entry.symbol} · n=${entry.shell} · M≈${entry.atomicMass}`}
      className={[
        'flex flex-col items-center gap-0.5 rounded-md border px-1 py-1 text-[10px] transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/50 bg-background/60 hover:border-border',
      ].join(' ')}
    >
      <span
        className="h-4 w-4 rounded-full border border-border/40"
        style={{ backgroundColor: entry.color }}
        aria-hidden="true"
      />
      <span className="font-medium text-foreground/90">{entry.symbol}</span>
      <span className="text-[9px] text-muted-foreground">n={entry.shell}</span>
    </button>
  );
}

function MoleculeRow({
  mol,
  selected,
  onSelect,
}: {
  mol: Molecule;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'flex items-center gap-2 rounded-md border px-2 py-1 text-left text-[11px] transition-all',
        selected
          ? 'border-primary bg-primary/10'
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
    </button>
  );
}

export default ElementPicker;