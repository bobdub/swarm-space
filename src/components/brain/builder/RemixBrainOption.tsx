/**
 * RemixBrainOption — "Remix this project" card in the builder Options.
 *
 * Starts a new project from the Brain the player is standing in (the
 * Main Brain or a project), carrying its Lab assets across, and links to
 * the Remix page for more Brains to remix.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentUser } from '@/lib/auth';
import { MAIN_BRAIN_REMIX, remixBrain } from '@/lib/remix/remixBrain';

interface RemixBrainOptionProps {
  /** Project the player is in; absent in the Main Brain. */
  projectId?: string | null;
  projectName?: string;
}

export function RemixBrainOption({ projectId = null, projectName }: RemixBrainOptionProps) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const label = projectId ? (projectName || 'this project') : 'the Main Brain';

  const handleRemix = async () => {
    if (busy) return;
    const user = getCurrentUser();
    if (!user) {
      toast.error('Sign in to remix a Brain.');
      return;
    }
    setBusy(true);
    try {
      const source = projectId
        ? { projectId, name: projectName || 'Project' }
        : MAIN_BRAIN_REMIX;
      const { project, assetsCopied } = await remixBrain(source, user.id);
      toast.success(`${project.name} created`, {
        description: assetsCopied
          ? `${assetsCopied} Lab asset${assetsCopied === 1 ? '' : 's'} carried over.`
          : 'A fresh project to build in.',
      });
      navigate(`/projects/${project.id}/hub`);
    } catch (err) {
      toast.error('Remix failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2" data-testid="builder-remix-option">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3" aria-hidden="true" /> Remix
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRemix}
          disabled={busy}
          data-testid="builder-remix-this"
          className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Remix {projectId ? 'this project' : 'the Main Brain'}
        </button>
        <Link
          to="/remix?tab=brains"
          data-testid="builder-remix-see-more"
          className="text-[11px] text-primary underline-offset-2 hover:underline"
        >
          See more Remixes
        </Link>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        Starts a new project of your own from {label}, with its Lab assets carried over.
      </p>
    </div>
  );
}

export default RemixBrainOption;
