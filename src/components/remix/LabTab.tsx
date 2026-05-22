/**
 * LabTab — the Elemental Alchemy Lab creator surface.
 *
 * SCAFFOLD STAGE — composes the vector canvas, element picker, and a
 * UQRC live-stats strip backed by `labField`. The 4 Hz tick scheduler,
 * `u(t)` projection render, and Mint flow are wired in follow-ups.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw, ArrowLeft, FlaskConical, Hammer, Send } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VectorCanvas } from './VectorCanvas';
import { ElementPicker } from './ElementPicker';
import { TestMixesPanel } from './TestMixesPanel';
import { LabErrorBoundary } from './LabErrorBoundary';
import { ProjectPicker } from './ProjectPicker';
import { resetLab, subscribeLab, type LabFieldStats } from '@/lib/remix/labField';
import { getMolecule } from '@/lib/remix/moleculeCatalog';
import { mintMolecule } from '@/lib/remix/lab.bus';
import { forgeMoleculeAsTool } from '@/lib/brain/tool.bus';
import {
  submitMoleculeToProject,
  getActiveProjectId,
  setActiveProjectId,
} from '@/lib/remix/labProjectBridge';
import {
  subscribeHarvested,
  spendHarvested,
  getHarvested,
} from '@/lib/remix/harvestedInventory';
import type { SizePreset } from '@/lib/remix/labMint';
import { SIZE_PRESETS } from '@/lib/remix/labMint';
import { useToast } from '@/hooks/use-toast';

/**
 * Default brush — wood (cellulose). Concrete hex so canvas 2D can render it
 * without CSS-variable resolution. Matches `#wood` in the basics shortcuts.
 */
const DEFAULT_STROKE = '#a47148';
const DEFAULT_BRUSH_ID = 'mol:cellulose_wood';

export function LabTab() {
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_BRUSH_ID);
  const [strokeColor, setStrokeColor] = useState<string>(DEFAULT_STROKE);
  const [stats, setStats] = useState<LabFieldStats>({ ticks: 0, qScore: 0 });
  const [minting, setMinting] = useState(false);
  const [forging, setForging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(() => {
    const fromUrl = searchParams.get('projectId');
    if (fromUrl) { setActiveProjectId(fromUrl); return fromUrl; }
    return getActiveProjectId();
  });
  const [sizePreset, setSizePreset] = useState<SizePreset>('small');
  const [harvested, setHarvested] = useState<{ symbol: string; count: number }[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => subscribeLab(setStats), []);
  useEffect(() => subscribeHarvested(setHarvested), []);

  // If URL projectId changes mid-session, follow it.
  useEffect(() => {
    const fromUrl = searchParams.get('projectId');
    if (fromUrl && fromUrl !== projectId) {
      setActiveProjectId(fromUrl);
      setProjectId(fromUrl);
    }
  }, [searchParams, projectId]);

  const handleSelect = (id: string, color: string) => {
    setSelectedId(id);
    setStrokeColor(color);
  };

  const moleculeId = selectedId?.startsWith('mol:') ? selectedId.slice(4) : null;
  const molecule = moleculeId ? getMolecule(moleculeId) : undefined;

  // Live deduction — per ~100 px of stroke length, debit one formula unit
  // of the current molecule from the harvested inventory.
  const handleStrokeCommit = (lengthPx: number) => {
    if (!molecule) return;
    const units = Math.max(1, Math.round(lengthPx / 100));
    const parts = molecule.constituents.map((c) => ({
      symbol: c.symbol,
      count: c.count * units,
    }));
    const ok = spendHarvested(parts);
    if (!ok) {
      const missing = parts
        .filter((p) => getHarvested(p.symbol) < p.count)
        .map((p) => p.symbol)
        .join(', ');
      toast({
        title: 'Not enough chemicals',
        description: `Need more ${missing}. Harvest in-world to refill.`,
        variant: 'destructive',
      });
    }
  };

  const handleMint = async () => {
    if (!molecule || minting) return;
    setMinting(true);
    try {
      const actorId =
        (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) ||
        'local';
      const rec = await mintMolecule({
        molecule,
        actorId,
        projectId: projectId ?? undefined,
        sizePreset,
      });
      toast({
        title: 'Minted to World',
        description: `${rec.prefab.label} added to the Builder Bar.`,
      });
    } catch (err) {
      console.error('[LabTab] mint failed', err);
      toast({
        title: 'Mint failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setMinting(false);
    }
  };

  const handleForge = async () => {
    if (!molecule || forging) return;
    setForging(true);
    try {
      const actorId =
        (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) ||
        'local';
      const rec = await forgeMoleculeAsTool({ molecule, actorId });
      toast({
        title: 'Tool forged',
        description: `${rec.tool.label} ready in the sculpting catalog.`,
      });
    } catch (err) {
      console.error('[LabTab] forge failed', err);
      toast({
        title: 'Forge failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setForging(false);
    }
  };

  const handleSubmit = async () => {
    if (!molecule || !projectId || submitting) return;
    setSubmitting(true);
    try {
      const actorId =
        (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) ||
        'local';
      const rec = await submitMoleculeToProject({
        projectId,
        molecule,
        actorId,
        sizePreset,
      });
      toast({
        title: 'Submitted to project',
        description: `${rec.moleculeName} sent to the selected Brain and minted to your Builder Bar.`,
      });
    } catch (err) {
      console.error('[LabTab] submit failed', err);
      toast({
        title: 'Submit failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const chemicalsPanel = useMemo(() => {
    if (harvested.length === 0) {
      return <span className="text-[10px] text-muted-foreground">No chemicals harvested yet.</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {harvested.map((h) => (
          <span
            key={h.symbol}
            className="rounded-full bg-muted/40 px-1.5 py-[1px] text-[10px] text-foreground/80"
          >
            {h.symbol} ×{h.count}
          </span>
        ))}
      </div>
    );
  }, [harvested]);

  return (
    <div className="grid h-[calc(100vh-13rem)] grid-cols-1 gap-3 md:grid-cols-[1fr_240px]">
      {/* Canvas + HUD */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => navigate('/')}
              className="h-7 gap-1 text-[11px]"
              aria-label="Return to Builder Mode"
              title="Back to Builder"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Builder
            </Button>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary">
              Lab
            </span>
            <span className="hidden sm:inline">Draw, assign elements, evolve in UQRC.</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <ProjectPicker value={projectId} onChange={setProjectId} />
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
        <div className="flex items-center gap-2 rounded-md border border-border/30 bg-background/40 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Chemicals</span>
          {chemicalsPanel}
        </div>
        <div className="flex-1">
          <LabErrorBoundary>
            <VectorCanvas strokeColor={strokeColor} onStrokeCommit={handleStrokeCommit} />
          </LabErrorBoundary>
        </div>
        <TestMixesPanel />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {selectedId
              ? `Brush bound to ${selectedId.replace('el:', '').replace('mol:', '')}`
              : 'Pick an element or molecule to assign your strokes.'}
          </span>
          <div className="flex items-center gap-2">
          <Select value={sizePreset} onValueChange={(v) => setSizePreset(v as SizePreset)}>
            <SelectTrigger className="h-8 w-[140px] text-[11px]" aria-label="Mint size">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((k) => (
                <SelectItem key={k} value={k} className="text-[11px]">
                  {SIZE_PRESETS[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!molecule || !projectId || submitting}
            onClick={handleSubmit}
            className="h-8 gap-1 text-[11px]"
            title={
              !projectId
                ? 'Pick a project first'
                : molecule
                  ? `Submit ${molecule.name} to the selected project Brain`
                  : 'Pick a molecule to submit'
            }
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? 'Submitting…' : 'Submit to Project'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!molecule || forging}
            onClick={handleForge}
            className="h-8 gap-1 text-[11px]"
            title={
              molecule
                ? `Forge ${molecule.name} as a sculpting Tool`
                : 'Pick a molecule to forge'
            }
          >
            <Hammer className="h-3.5 w-3.5" />
            {forging ? 'Forging…' : 'Forge as Tool'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!molecule || minting}
            onClick={handleMint}
            className="h-8 gap-1 text-[11px]"
            title={
              molecule
                ? `Mint ${molecule.name} as a placeable Builder asset`
                : 'Pick a molecule to mint'
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            {minting ? 'Minting…' : 'Mint as Asset'}
          </Button>
          </div>
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