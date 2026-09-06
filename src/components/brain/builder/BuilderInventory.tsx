/**
 * BuilderInventory — the transparent middle-of-screen build panel.
 *
 * Replaces the bottom prefab dock as the place you choose what to make.
 * The world stays visible (and audible) behind it: the backdrop is a soft
 * wash, not an opaque sheet, and mic / camera / chat are untouched.
 *
 * Everything here is a lens over existing state:
 *   • totals come from `materials.ts`, which folds the element bag into
 *     Wood / Stone / Water / Fibre / Food — nothing is re-persisted;
 *   • costs are derived from each prefab's `constituents`, never typed;
 *   • picking an item only sets `builder.selectPrefab`, which arms the
 *     ghost. The lattice is still written solely by the block engine.
 *
 * Project rules: `role="form"` (no native <form>), every button
 * `type="button"`.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Hammer } from 'lucide-react';
import {
  listPrefabsBySection,
  type Prefab,
  type PrefabSectionId,
} from '@/lib/brain/prefabHouseCatalog';
import {
  MATERIALS,
  materialTotals,
  subscribeMaterials,
  prefabCostFor,
  formatCost,
  checkAffordable,
  describeMissing,
  type MaterialId,
} from '@/lib/world/materials';
import { getToolAny } from '@/lib/brain/toolCatalog';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';

export interface InventorySection {
  id: string;
  label: string;
  /** Catalog sections folded into this panel section. */
  sources: PrefabSectionId[];
}

/** Plain-words grouping of the catalog. */
export const INVENTORY_SECTIONS: InventorySection[] = [
  { id: 'gathered', label: 'Gathered', sources: [] },
  { id: 'structures', label: 'Structures', sources: ['foundations', 'floors', 'walls'] },
  { id: 'openings', label: 'Doors & Windows', sources: ['doors', 'windows'] },
  { id: 'roofs', label: 'Roofs', sources: ['roofs'] },
  { id: 'tools', label: 'Tools', sources: ['tools', 'consumables'] },
];

interface BuilderInventoryProps {
  open: boolean;
  builder: UseBrainBuilder;
  onClose: () => void;
  /** Equip a catalog tool straight into the hand slot. */
  onEquipTool?: (prefabId: string) => void;
}

export function BuilderInventory({ open, builder, onClose, onEquipTool }: BuilderInventoryProps) {
  const [sectionId, setSectionId] = useState<string>('structures');
  const [totals, setTotals] = useState<Record<MaterialId, number>>(() => materialTotals());

  useEffect(() => subscribeMaterials(setTotals), []);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const section = useMemo(
    () => INVENTORY_SECTIONS.find((s) => s.id === sectionId) ?? INVENTORY_SECTIONS[1],
    [sectionId],
  );

  const items = useMemo<Prefab[]>(() => {
    const out: Prefab[] = [];
    for (const src of section.sources) out.push(...listPrefabsBySection(src));
    return out;
  }, [section]);

  if (!open) return null;

  const pick = (prefab: Prefab) => {
    if (getToolAny(prefab.id)) {
      onEquipTool?.(prefab.id);
      onClose();
      return;
    }
    builder.selectPrefab(prefab.id);
    onClose();
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-3 animate-in fade-in duration-200"
      data-testid="builder-inventory"
    >
      <div
        role="form"
        aria-label="Build inventory"
        className="pointer-events-auto flex max-h-[76vh] w-[min(96vw,860px)] flex-col overflow-hidden rounded-2xl border border-primary/30 bg-background/55 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] backdrop-blur-md"
      >
        {/* Totals strip */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <Hammer className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {MATERIALS.map((m) => (
              <span
                key={m.id}
                data-testid={`material-total-${m.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px]"
                title={`${m.label}: ${totals[m.id]}`}
              >
                <span aria-hidden="true">{m.icon}</span>
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-semibold tabular-nums text-foreground">{totals[m.id]}</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close inventory"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sections */}
          <div
            role="tablist"
            aria-label="Inventory sections"
            className="flex w-[132px] shrink-0 flex-col gap-1 border-r border-border/40 p-2"
          >
            {INVENTORY_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === section.id}
                data-testid={`inventory-section-${s.id}`}
                onClick={() => setSectionId(s.id)}
                className={[
                  'rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors',
                  s.id === section.id
                    ? 'bg-primary/20 font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted/50',
                ].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Tiles */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {section.id === 'gathered' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {MATERIALS.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-col items-center gap-1 rounded-xl border border-border/50 bg-muted/25 px-2 py-3"
                  >
                    <span className="text-2xl" aria-hidden="true">{m.icon}</span>
                    <span className="text-[12px] font-medium">{m.label}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-primary">
                      {totals[m.id]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                {items.map((p) => (
                  <InventoryTile
                    key={p.id}
                    prefab={p}
                    totals={totals}
                    selected={builder.selectedPrefabId === p.id}
                    onPick={() => pick(p)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="col-span-full px-2 py-6 text-center text-[12px] text-muted-foreground">
                    Nothing in this section yet.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
          Pick an item to place a ghost · B or Esc to close
        </div>
      </div>
    </div>
  );
}

function InventoryTile({
  prefab,
  totals,
  selected,
  onPick,
}: {
  prefab: Prefab;
  totals: Record<MaterialId, number>;
  selected: boolean;
  onPick: () => void;
}) {
  const cost = useMemo(() => prefabCostFor(prefab), [prefab]);
  const afford = useMemo(() => checkAffordable(cost, totals), [cost, totals]);
  const missing = describeMissing(afford.missing);

  return (
    <button
      type="button"
      disabled={!afford.ok}
      onClick={onPick}
      data-testid={`inventory-tile-${prefab.id}`}
      data-affordable={afford.ok ? 'true' : 'false'}
      title={afford.ok ? `${prefab.label} — ${formatCost(cost)}` : `${prefab.label} — ${missing}`}
      className={[
        'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition-all',
        afford.ok
          ? 'border-border/60 bg-muted/30 hover:border-primary/60 hover:bg-primary/10'
          : 'cursor-not-allowed border-border/30 bg-muted/10 opacity-40',
        selected ? 'ring-2 ring-primary' : '',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="h-9 w-9 rounded-md border border-white/15"
        style={{
          background: prefab.color,
          boxShadow: `0 0 14px -4px ${prefab.color}`,
        }}
      />
      <span className="w-full truncate text-[12px] font-medium">{prefab.label}</span>
      <span className="w-full text-[10px] leading-tight text-muted-foreground">
        {formatCost(cost)}
      </span>
      {!afford.ok && (
        <span className="w-full text-[9px] leading-tight text-amber-400/90">{missing}</span>
      )}
    </button>
  );
}
