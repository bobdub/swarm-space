/**
 * AssetsTab — gallery of minted Lab assets scoped to the active project.
 *
 * Shows every `MintedRecord` whose `projectId` matches the active project
 * (sourced from `labProjectBridge`). Each card can be imported into the
 * user's Builder Bar — but only if the user actually holds the required
 * chemical atoms (read from `harvestedInventory`). Otherwise the import
 * button is disabled with a tooltip listing what's missing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Atom, Lock, Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  subscribeMintedPrefabs,
  type MintedRecord,
} from '@/lib/remix/mintedPrefabsStore';
import { getActiveProjectId } from '@/lib/remix/labProjectBridge';
import {
  subscribeHarvested,
  getHarvested,
} from '@/lib/remix/harvestedInventory';
import {
  isAssetImported,
  importAsset,
  subscribeImportedAssets,
} from '@/lib/remix/importedAssets';
import { registerCustomPrefab } from '@/lib/brain/prefabHouseCatalog';
import { ProjectPicker } from './ProjectPicker';

function requirementsFor(rec: MintedRecord): { symbol: string; count: number }[] {
  const constituents = (rec.prefab as unknown as {
    constituents?: { symbol: string; count: number }[];
  }).constituents;
  return Array.isArray(constituents) ? constituents : [];
}

export function AssetsTab() {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string | null>(() => getActiveProjectId());
  const [mints, setMints] = useState<MintedRecord[]>([]);
  // Subscribe so harvested/imported deltas trigger re-render even though
  // we read the values directly inside the render loop.
  const [, setHarvestedTick] = useState(0);
  const [, setImportedTick] = useState(0);

  useEffect(() => subscribeMintedPrefabs(setMints), []);
  useEffect(() => subscribeHarvested(() => setHarvestedTick((n) => n + 1)), []);
  useEffect(() => subscribeImportedAssets(() => setImportedTick((n) => n + 1)), []);

  const scoped = useMemo(
    () => mints.filter((m) => projectId && m.projectId === projectId),
    [mints, projectId],
  );

  const handleImport = (rec: MintedRecord) => {
    const reqs = requirementsFor(rec);
    const missing = reqs.filter((r) => getHarvested(r.symbol) < r.count);
    if (missing.length > 0) {
      toast({
        title: 'Missing chemicals',
        description: `Need: ${missing.map((m) => `${m.count}× ${m.symbol}`).join(', ')}. Harvest in-world first.`,
        variant: 'destructive',
      });
      return;
    }
    try {
      registerCustomPrefab(rec.prefab);
      importAsset(rec.id);
      toast({
        title: 'Imported to Builder',
        description: `${rec.prefab.label} is now in your Builder Bar.`,
      });
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">Project Assets</h2>
          <p className="text-[11px] text-muted-foreground">
            Minted assets from the current project. Import them into your Builder Bar if you hold the chemicals.
          </p>
        </div>
        <ProjectPicker value={projectId} onChange={setProjectId} />
      </div>

      {!projectId ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/40 p-8 text-center">
          <Atom className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">Pick a project to see its minted assets.</p>
        </div>
      ) : scoped.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/40 p-8 text-center">
          <Atom className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            No assets minted in this project yet. Open the Lab to create one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {scoped.map((rec) => {
            const reqs = requirementsFor(rec);
            const missing = reqs.filter((r) => getHarvested(r.symbol) < r.count);
            const locked = missing.length > 0;
            const imported = isAssetImported(rec.id);
            return (
              <article
                key={rec.id}
                className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-foreground/90">
                      {rec.prefab.label}
                    </h3>
                    <p className="truncate text-[10px] text-muted-foreground">
                      by {rec.actorId.slice(0, 8)} · {new Date(rec.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Locked" />}
                </div>

                {reqs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {reqs.map((r) => {
                      const have = getHarvested(r.symbol);
                      const ok = have >= r.count;
                      return (
                        <span
                          key={r.symbol}
                          className={`rounded-full px-1.5 py-[1px] text-[10px] ${
                            ok ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
                          }`}
                        >
                          {r.count}× {r.symbol}
                          <span className="ml-1 opacity-60">({have})</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant={imported ? 'ghost' : locked ? 'outline' : 'default'}
                    onClick={() => handleImport(rec)}
                    className="h-7 gap-1 text-[11px]"
                    title={
                      locked
                        ? `Need: ${missing.map((m) => `${m.count}× ${m.symbol}`).join(', ')}`
                        : imported
                          ? 'Already in your Builder Bar'
                          : 'Add to your Builder Bar'
                    }
                  >
                    {imported ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    {imported ? 'Imported' : 'Import to Builder'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AssetsTab;