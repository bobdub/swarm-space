/**
 * BrainBuilderBar — Sims-style dock for placing UQRC prefabs.
 *
 * SCAFFOLD STAGE — the bar renders sections + asset tiles and tracks
 * selection through `useBrainBuilder`. Ghost preview, magnetic snap, and
 * commit-via-`builderBlockEngine` are wired in a follow-up. Selecting a
 * tile here only marks intent; it never touches the field.
 *
 * UQRC display:
 *   • Swatch     = compound color blended from real element colors.
 *   • Tooltip    = mass, water-resistance, flammability, shell tags.
 *   • Magnetic   = toggle (default ON); meaning "minimize ‖[D_μ,D_ν]‖".
 */
import { useMemo } from 'react';
import { X, Magnet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  PREFAB_SECTIONS,
  listPrefabsBySection,
  type PrefabSectionId,
  type Prefab,
} from '@/lib/brain/prefabHouseCatalog';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';

interface BrainBuilderBarProps {
  builder: UseBrainBuilder;
}

export function BrainBuilderBar({ builder }: BrainBuilderBarProps) {
  const {
    magnetic,
    setMagnetic,
    activeSection,
    setActiveSection,
    selectedPrefabId,
    selectPrefab,
    exitBuild,
  } = builder;

  const items = useMemo(() => listPrefabsBySection(activeSection), [activeSection]);

  return (
    <div
      role="form"
      aria-label="Brain Builder Bar"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-border/40 bg-background/85 px-3 py-2 backdrop-blur-md"
    >
      {/* Top row — prefab label + Magnetic toggle + exit */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            House
          </span>
          <span className="text-[11px] text-muted-foreground">UQRC prefabs</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Magnet className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Magnetic</span>
            <Switch
              checked={magnetic}
              onCheckedChange={setMagnetic}
              aria-label="Toggle magnetic snap"
            />
          </label>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Exit Builder Mode"
            onClick={exitBuild}
            className="h-7 w-7"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Prefab sections">
        {PREFAB_SECTIONS.map((s) => (
          <SectionTab
            key={s.id}
            id={s.id}
            label={s.label}
            active={activeSection === s.id}
            onSelect={() => setActiveSection(s.id)}
          />
        ))}
      </div>

      {/* Asset tiles */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((p) => (
          <PrefabTile
            key={p.id}
            prefab={p}
            selected={selectedPrefabId === p.id}
            onSelect={() => selectPrefab(selectedPrefabId === p.id ? null : p.id)}
          />
        ))}
        {items.length === 0 && (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">
            No prefabs in this section yet.
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTab({
  id,
  label,
  active,
  onSelect,
}: {
  id: PrefabSectionId;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={[
        'whitespace-nowrap rounded-full px-3 py-1 text-[11px] transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/40 text-muted-foreground hover:bg-muted/70',
      ].join(' ')}
      data-section-id={id}
    >
      {label}
    </button>
  );
}

function PrefabTile({
  prefab,
  selected,
  onSelect,
}: {
  prefab: Prefab;
  selected: boolean;
  onSelect: () => void;
}) {
  const tooltip = [
    `${prefab.label} — ${prefab.formula}`,
    `mass ${prefab.mass.toFixed(0)} kg`,
    `H₂O resist ${(prefab.waterResistance * 100).toFixed(0)}%`,
    `flammable ${(prefab.flammability * 100).toFixed(0)}%`,
    `shells n=${prefab.shellTags.join(',')}`,
  ].join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      title={tooltip}
      aria-pressed={selected}
      className={[
        'flex min-w-[72px] flex-col items-center gap-1 rounded-md border px-2 py-1.5 transition-all',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/50 bg-background/60 hover:border-border',
      ].join(' ')}
    >
      <span
        className="h-7 w-7 rounded-sm border border-border/40"
        style={{ backgroundColor: prefab.color }}
        aria-hidden="true"
      />
      <span className="max-w-[80px] truncate text-[10px] font-medium text-foreground/90">
        {prefab.label}
      </span>
      <span className="text-[9px] text-muted-foreground">{prefab.formula}</span>
    </button>
  );
}

export default BrainBuilderBar;