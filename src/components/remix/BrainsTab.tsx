/**
 * BrainsTab — every Brain you can remix.
 *
 * The Main Brain is always first: everyone can remix it. After it come
 * the Brains people have published with "Submit a Brain". Remixing any of
 * them starts a new project of your own with that Brain's Lab assets
 * carried over (`remixBrain`).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogIn, Sparkles, Telescope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  hydrateBrainSubmissions,
  subscribeBrainSubmissions,
  type BrainSubmission,
} from '@/lib/remix/brainSubmissionsStore';
import { subscribeMintedPrefabs, type MintedRecord } from '@/lib/remix/mintedPrefabsStore';
import { MAIN_BRAIN_REMIX, assetsForBrain, remixBrain } from '@/lib/remix/remixBrain';
import { getCurrentUser } from '@/lib/auth';
import { SubmitBrainPopover } from './SubmitBrainPopover';
import { BrainSubmissionCard } from './BrainSubmissionCard';

export function BrainsTab() {
  const [items, setItems] = useState<BrainSubmission[]>([]);
  const [mints, setMints] = useState<MintedRecord[]>([]);
  const currentUserId = getCurrentUser()?.id ?? null;

  useEffect(() => {
    void hydrateBrainSubmissions();
    return subscribeBrainSubmissions(setItems);
  }, []);
  useEffect(() => subscribeMintedPrefabs(setMints), []);

  const mainAssets = useMemo(() => assetsForBrain(mints, null).length, [mints]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/90">Brains to remix</h2>
          <p className="text-[11px] text-muted-foreground">
            Remixing starts a new project of your own with the Brain's Lab assets carried over.
          </p>
        </div>
        <SubmitBrainPopover />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MainBrainCard assetCount={mainAssets} />
        {items.map((s) => (
          <BrainSubmissionCard
            key={s.id}
            submission={s}
            currentUserId={currentUserId}
            assetCount={assetsForBrain(mints, s.projectId).length}
          />
        ))}
      </div>

      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-background/40 p-4 text-center">
          <Telescope className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-[11px] text-muted-foreground">
            No project Brains published yet. Click <strong>Submit a Brain</strong> to share one of yours.
          </p>
        </div>
      )}
    </div>
  );
}

/** The shared world: listed for everyone, always remixable. */
function MainBrainCard({ assetCount }: { assetCount: number }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleRemix = async () => {
    if (busy) return;
    const user = getCurrentUser();
    if (!user) {
      toast({ title: 'Sign in to remix', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const { project, assetsCopied } = await remixBrain(MAIN_BRAIN_REMIX, user.id);
      toast({
        title: 'Main Brain remixed',
        description: `${project.name} created${assetsCopied ? ` with ${assetsCopied} Lab asset${assetsCopied === 1 ? '' : 's'}` : ''}.`,
      });
      navigate(`/projects/${project.id}/hub`);
    } catch (err) {
      toast({ title: 'Remix failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="flex flex-col gap-2 overflow-hidden rounded-md border border-primary/40 bg-primary/5 p-2"
      data-testid="remix-main-brain"
    >
      <div className="relative flex h-24 w-full items-end overflow-hidden rounded-md border border-primary/30 bg-gradient-to-br from-primary/30 via-background to-background p-2" aria-hidden="true">
        <span className="text-3xl">🌍</span>
        <span className="absolute left-1.5 top-1.5 rounded-full bg-primary/20 px-1.5 py-[1px] text-[9px] font-semibold text-primary">
          Everyone
        </span>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background/80 px-1.5 py-[1px] text-[9px] font-medium text-foreground/80 backdrop-blur">
          {assetCount} Lab asset{assetCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium text-foreground/90">Main Brain</h3>
        <p className="truncate text-[10px] text-muted-foreground">{MAIN_BRAIN_REMIX.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" onClick={handleRemix} disabled={busy} className="h-7 gap-1 text-[11px]" data-testid="remix-main-brain-button">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Remix
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => navigate('/brain')} className="h-7 gap-1 text-[11px]">
          <LogIn className="h-3 w-3" /> Visit
        </Button>
      </div>
    </article>
  );
}

export default BrainsTab;
