/**
 * LabTab — the Elemental Lab creator surface.
 *
 * Draw with the things you gather. The brush picker shows Wood, Stone,
 * Fiber, Water, Honey, Gems and Gold with your live stock; each ~100 px
 * of stroke spends one unit from your bag. What you drew becomes a
 * Molecule (via `labMaterials.compositionToMolecule`) that can be:
 *
 *   • minted as a placeable asset into the chosen Brain (Main Brain or one
 *     of your projects), or
 *   • forged into a tool whose purpose (Cut, Pick, Dig, Gather) is stamped
 *     into its spec, so its swing runs the matching interaction in-world.
 *
 * The target defaults to the Brain the Lab was opened from: the project
 * when launched from a project, otherwise the Main Brain.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, RotateCcw, ArrowLeft, Hammer, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VectorCanvas } from './VectorCanvas';
import { LabErrorBoundary } from './LabErrorBoundary';
import { ProjectPicker } from './ProjectPicker';
import { resetLab, subscribeLab, type LabFieldStats } from '@/lib/remix/labField';
import { mintMolecule } from '@/lib/remix/lab.bus';
import { forgeMoleculeAsTool } from '@/lib/brain/tool.bus';
import { FORGE_TOOL_ACTIONS, type ForgeToolAction } from '@/lib/brain/toolForge';
import {
  isMainBrainTarget,
  resolveDefaultLabTarget,
  setActiveProjectId,
  submitMoleculeToProject,
} from '@/lib/remix/labProjectBridge';
import {
  LAB_MATERIALS,
  compositionToMolecule,
  compositionTotal,
  defaultCreationName,
  getLabMaterial,
  labMaterialStocks,
  refundLabMaterial,
  spendLabMaterial,
  subscribeLabMaterialStocks,
  unitsForStroke,
  type LabComposition,
  type LabMaterialId,
} from '@/lib/remix/labMaterials';
import type { SizePreset } from '@/lib/remix/labMint';
import { SIZE_PRESETS } from '@/lib/remix/labMint';
import { getCurrentUser } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

function actorId(): string {
  try {
    const id = getCurrentUser()?.id;
    if (id) return id;
  } catch { /* fall through */ }
  return (typeof localStorage !== 'undefined' && localStorage.getItem('peerId')) || 'local';
}

export function LabTab() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [materialId, setMaterialId] = useState<LabMaterialId>('wood');
  const [stocks, setStocks] = useState<Record<LabMaterialId, number>>(() => labMaterialStocks());
  const [composition, setComposition] = useState<LabComposition>({});
  const [name, setName] = useState('');
  const [toolAction, setToolAction] = useState<ForgeToolAction>('chop');
  const [sizePreset, setSizePreset] = useState<SizePreset>('small');
  const [stats, setStats] = useState<LabFieldStats>({ ticks: 0, qScore: 0 });
  const [busy, setBusy] = useState<'mint' | 'forge' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [target, setTarget] = useState<string>(() =>
    resolveDefaultLabTarget({ projectId: searchParams.get('projectId'), target: searchParams.get('target') }),
  );

  // Leaving the Lab with an unminted drawing returns its materials.
  const compositionRef = useRef<LabComposition>({});
  compositionRef.current = composition;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const m of LAB_MATERIALS) refundLabMaterial(m.id, compositionRef.current[m.id] ?? 0);
    };
  }, []);

  /** A failed mint/forge gives its reserved drawing back (or its materials, if the Lab closed). */
  const releaseReserved = (reserved: LabComposition) => {
    if (mountedRef.current) setComposition(reserved);
    else for (const m of LAB_MATERIALS) refundLabMaterial(m.id, reserved[m.id] ?? 0);
  };

  useEffect(() => subscribeLab(setStats), []);
  useEffect(() => subscribeLabMaterialStocks(setStocks), []);

  // Follow the URL if the Lab is re-opened from another Brain mid-session.
  useEffect(() => {
    const next = resolveDefaultLabTarget({ projectId: searchParams.get('projectId'), target: searchParams.get('target') });
    setTarget(next);
    if (!isMainBrainTarget(next)) setActiveProjectId(next);
  }, [searchParams]);

  // Escape leaves the fullscreen canvas.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const material = getLabMaterial(materialId);
  const drawn = compositionTotal(composition);
  const onMainBrain = isMainBrainTarget(target);
  const targetLabel = onMainBrain ? 'Main Brain' : 'Project';
  const creationName = name.trim() || defaultCreationName(composition);

  const handleStrokeCommit = (lengthPx: number) => {
    const units = unitsForStroke(lengthPx);
    if (units <= 0) return;
    if (!spendLabMaterial(materialId, units)) {
      toast({
        title: `Not enough ${material.label}`,
        description: `That stroke needs ${units} ${material.label}. Gather more in the world.`,
        variant: 'destructive',
      });
      return;
    }
    setComposition((c) => ({ ...c, [materialId]: (c[materialId] ?? 0) + units }));
  };

  /** Clear the drawing. Unminted materials go back to the bag. */
  const clearDrawing = (refund: boolean) => {
    if (refund) {
      for (const m of LAB_MATERIALS) refundLabMaterial(m.id, composition[m.id] ?? 0);
    }
    setComposition({});
    setClearSignal((n) => n + 1);
  };

  const molecule = useMemo(() => compositionToMolecule(composition, creationName), [composition, creationName]);

  const handleMint = async () => {
    if (!molecule || busy) return;
    setBusy('mint');
    // Reserve the drawing's materials now: leaving or clearing the Lab while
    // this awaits must not refund them on top of the finished asset.
    const reserved = composition;
    setComposition({});
    compositionRef.current = {};
    try {
      const who = actorId();
      if (onMainBrain) {
        // No project tag: the asset joins the shared Main Brain catalog.
        await mintMolecule({ molecule, actorId: who, sizePreset });
      } else {
        await submitMoleculeToProject({ projectId: target, molecule, actorId: who, sizePreset });
      }
      toast({
        title: `Minted to ${onMainBrain ? 'the Main Brain' : 'your project'}`,
        description: `${molecule.name} is ready in the Builder's Lab tab.`,
      });
      setClearSignal((n) => n + 1);
      setName('');
    } catch (err) {
      releaseReserved(reserved);
      console.error('[LabTab] mint failed', err);
      toast({ title: 'Mint failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const handleForge = async () => {
    if (!molecule || busy) return;
    setBusy('forge');
    // Reserve the drawing's materials now: leaving or clearing the Lab while
    // this awaits must not refund them on top of the finished asset.
    const reserved = composition;
    setComposition({});
    compositionRef.current = {};
    try {
      const rec = await forgeMoleculeAsTool({
        molecule,
        actorId: actorId(),
        actionKind: toolAction,
        projectId: onMainBrain ? undefined : target,
      });
      toast({
        title: 'Tool forged',
        description: `${rec.tool.label} is in your Tools and Lab tabs. Equip it to ${FORGE_TOOL_ACTIONS.find((a) => a.id === toolAction)?.label.toLowerCase()}.`,
      });
      setClearSignal((n) => n + 1);
      setName('');
    } catch (err) {
      releaseReserved(reserved);
      console.error('[LabTab] forge failed', err);
      toast({ title: 'Forge failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const canvas = (
    <LabErrorBoundary>
      <VectorCanvas
        strokeColor={material.color}
        onStrokeCommit={handleStrokeCommit}
        onClear={() => clearDrawing(true)}
        clearSignal={clearSignal}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
      />
    </LabErrorBoundary>
  );

  return (
    <div className="grid grid-cols-1 gap-3 md:h-[calc(100vh-13rem)] md:grid-cols-[1fr_260px]">
      {/* Canvas + HUD */}
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => navigate(onMainBrain ? '/brain' : `/projects/${encodeURIComponent(target)}/hub`)}
              className="h-7 gap-1 text-[11px]"
              aria-label="Return to the Brain"
              title="Back to the Brain"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Brain
            </Button>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary">Lab</span>
            <span className="hidden sm:inline">Draw with what you gather.</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <ProjectPicker value={target} onChange={(id) => setTarget(id ?? resolveDefaultLabTarget({}))} includeMainBrain label="Target" />
            <span>Q {stats.qScore.toFixed(4)}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { resetLab(); clearDrawing(true); }}
              className="h-7 gap-1 text-[11px]"
              title="Clear the drawing and return its materials"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </div>

        {/* One wrapper either way, so going fullscreen keeps the drawing. */}
        <div
          className={expanded
            ? 'fixed inset-0 z-50 flex flex-col gap-2 bg-background p-3'
            : 'flex h-[55vh] min-h-[260px] flex-col md:h-auto md:flex-1'}
          role={expanded ? 'dialog' : undefined}
          aria-label={expanded ? 'Fullscreen Lab canvas' : undefined}
          data-testid={expanded ? 'lab-canvas-fullscreen' : 'lab-canvas'}
        >
          {expanded && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-medium text-primary">Lab · fullscreen</span>
              <MaterialChips selected={materialId} stocks={stocks} onSelect={setMaterialId} />
              <CompositionChips composition={composition} />
            </div>
          )}
          <div className="min-h-0 flex-1">{canvas}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/30 bg-background/40 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Drawn</span>
          {drawn > 0 ? <CompositionChips composition={composition} /> : (
            <span className="text-[10px] text-muted-foreground">Pick a material and draw. Each stroke spends from your bag.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultCreationName(composition)}
            aria-label="Creation name"
            className="h-8 w-[12rem] text-[11px]"
          />
          <div className="flex flex-wrap items-center gap-2">
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
              disabled={!molecule || busy !== null}
              onClick={handleMint}
              className="h-8 gap-1 text-[11px]"
              title={molecule ? `Mint ${creationName} into the ${targetLabel}` : 'Draw something first'}
              data-testid="lab-mint"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {busy === 'mint' ? 'Minting…' : `Mint to ${targetLabel}`}
            </Button>
          </div>
        </div>

        {/* Tool purpose — stamped into the forged tool */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/30 bg-background/40 px-2 py-1.5" role="radiogroup" aria-label="Tool purpose">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Tool purpose</span>
          {FORGE_TOOL_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={toolAction === a.id}
              data-testid={`lab-tool-action-${a.id}`}
              onClick={() => setToolAction(a.id)}
              title={`${a.label} (${a.tool}): ${a.hint}`}
              className={[
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                toolAction === a.id
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/60',
              ].join(' ')}
            >
              {a.label} <span className="opacity-60">· {a.tool}</span>
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!molecule || busy !== null}
            onClick={handleForge}
            className="ml-auto h-8 gap-1 text-[11px]"
            data-testid="lab-forge-tool"
            title={molecule ? `Forge ${creationName} as a tool` : 'Draw something first'}
          >
            <Hammer className="h-3.5 w-3.5" />
            {busy === 'forge' ? 'Forging…' : 'Forge Tool'}
          </Button>
        </div>
      </div>

      {/* Material picker */}
      <aside className="rounded-md border border-border/40 bg-background/40 p-2" aria-label="Materials">
        <div className="mb-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">Gathered materials</div>
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1">
          {LAB_MATERIALS.map((m) => {
            const held = stocks[m.id] ?? 0;
            const selected = m.id === materialId;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={selected}
                data-testid={`lab-material-${m.id}`}
                onClick={() => setMaterialId(m.id)}
                title={held > 0 ? `${m.label} · ${m.role} · you hold ${held}` : `${m.label} · gather some in the world first`}
                className={[
                  'relative flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-all',
                  selected
                    ? 'border-primary bg-primary/10'
                    : held > 0
                      ? 'border-border/50 bg-background/60 hover:border-border'
                      : 'border-border/30 bg-background/30 opacity-60 hover:opacity-90',
                ].join(' ')}
              >
                <span className="h-5 w-5 shrink-0 rounded-full border border-white/15" style={{ backgroundColor: m.color }} aria-hidden="true" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[12px] font-medium text-foreground/90">{m.label}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{m.role}</span>
                </span>
                <span className="ml-auto text-[11px] font-semibold tabular-nums text-primary">{held}</span>
                {held <= 0 && <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function MaterialChips({
  selected,
  stocks,
  onSelect,
}: {
  selected: LabMaterialId;
  stocks: Record<LabMaterialId, number>;
  onSelect: (id: LabMaterialId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {LAB_MATERIALS.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={selected === m.id}
          onClick={() => onSelect(m.id)}
          className={[
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
            selected === m.id ? 'border-primary bg-primary/15 text-primary' : 'border-border/50 bg-muted/30',
          ].join(' ')}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} aria-hidden="true" />
          {m.label} {stocks[m.id] ?? 0}
        </button>
      ))}
    </div>
  );
}

function CompositionChips({ composition }: { composition: LabComposition }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LAB_MATERIALS.filter((m) => (composition[m.id] ?? 0) > 0).map((m) => (
        <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-1.5 py-[1px] text-[10px] text-foreground/80">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} aria-hidden="true" />
          {m.label} ×{composition[m.id]}
        </span>
      ))}
    </div>
  );
}

export default LabTab;
