/**
 * LabTab — the Elemental Alchemy Lab creator surface.
 *
 * SCAFFOLD STAGE — composes the vector canvas, element picker, and a
 * UQRC live-stats strip backed by `labField`. The 4 Hz tick scheduler,
 * `u(t)` projection render, and Mint flow are wired in follow-ups.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, RotateCcw, ArrowLeft, FlaskConical } from 'lucide-react';
import { VectorCanvas } from './VectorCanvas';
import { ElementPicker } from './ElementPicker';
import { TestMixesPanel } from './TestMixesPanel';
import { resetLab, subscribeLab, type LabFieldStats } from '@/lib/remix/labField';
import { getMolecule } from '@/lib/remix/moleculeCatalog';
import { mintMolecule } from '@/lib/remix/lab.bus';
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
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => subscribeLab(setStats), []);

  const handleSelect = (id: string, color: string) => {
    setSelectedId(id);
    setStrokeColor(color);
  };

  const moleculeId = selectedId?.startsWith('mol:') ? selectedId.slice(4) : null;
  const molecule = moleculeId ? getMolecule(moleculeId) : undefined;

  const handleMint = async () => {
    if (!molecule || minting) return;
    setMinting(true);
    try {
      const actorId =
        (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) ||
        'local';
      const rec = await mintMolecule({ molecule, actorId });
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
        <TestMixesPanel />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {selectedId
              ? `Brush bound to ${selectedId.replace('el:', '').replace('mol:', '')}`
              : 'Pick an element or molecule to assign your strokes.'}
          </span>
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

      {/* Picker */}
      <aside className="rounded-md border border-border/40 bg-background/40 p-2">
        <ElementPicker selectedId={selectedId} onSelect={handleSelect} />
      </aside>
    </div>
  );
}

export default LabTab;