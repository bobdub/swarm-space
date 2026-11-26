/**
 * BrainSubmissionCard — one Brain in the Remix gallery.
 *
 * Remix starts a new project of your own with this Brain's Lab assets
 * carried over (`remixBrain`); Visit opens the Brain itself. A light
 * preview tile replaces the old live iframe, which booted a whole 3D
 * world per card.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Heart, Sparkles, LogIn, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getCurrentUser } from '@/lib/auth';
import { remixBrain } from '@/lib/remix/remixBrain';
import {
  likeBrainSubmission,
  removeBrainSubmission,
  type BrainSubmission,
} from '@/lib/remix/brainSubmissionsStore';

interface Props {
  submission: BrainSubmission;
  currentUserId: string | null;
  /** Lab assets that come along when this Brain is remixed. */
  assetCount?: number;
}

export function BrainSubmissionCard({ submission, currentUserId, assetCount = 0 }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [remixing, setRemixing] = useState(false);

  const isOwner = currentUserId && submission.actorId === currentUserId;

  const handleRemix = async () => {
    if (remixing) return;
    const user = getCurrentUser();
    if (!user) {
      toast({ title: 'Sign in to remix', variant: 'destructive' });
      return;
    }
    setRemixing(true);
    try {
      const { project, assetsCopied } = await remixBrain({
        projectId: submission.projectId,
        name: submission.projectName,
        description: submission.projectDescription,
      }, user.id);
      toast({
        title: 'Brain remixed',
        description: `${project.name} created${assetsCopied ? ` with ${assetsCopied} Lab asset${assetsCopied === 1 ? '' : 's'}` : ''}.`,
      });
      navigate(`/projects/${project.id}/hub`);
    } catch (err) {
      toast({
        title: 'Remix failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRemixing(false);
    }
  };

  const handleJoin = () => {
    navigate(`/projects/${submission.projectId}/hub`);
  };

  const handleLike = () => { void likeBrainSubmission(submission.id); };

  const handleRemove = async () => {
    if (!currentUserId) return;
    const ok = await removeBrainSubmission(submission.id, currentUserId);
    if (ok) toast({ title: 'Removed from gallery' });
  };

  return (
    <article
      className="flex flex-col gap-2 overflow-hidden rounded-md border border-border/40 bg-background/40 p-2"
    >
      <div
        className="relative flex h-24 w-full items-end overflow-hidden rounded-md border border-border/30 bg-gradient-to-br from-primary/20 via-background to-background p-2"
        aria-hidden="true"
      >
        <span className="text-3xl">🧠</span>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background/80 px-1.5 py-[1px] text-[9px] font-medium text-foreground/80 backdrop-blur">
          {assetCount} Lab asset{assetCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground/90">
            {submission.projectName}
          </h3>
          <p className="truncate text-[10px] text-muted-foreground">
            by {submission.actorHandle ?? submission.actorId.slice(0, 8)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLike}
          className="flex items-center gap-1 rounded-full bg-muted/40 px-1.5 py-[1px] text-[10px] text-foreground/80 hover:bg-muted/60"
          aria-label="Like this Brain"
        >
          <Heart className={`h-3 w-3 ${submission.likedByMe ? 'fill-primary text-primary' : ''}`} />
          {submission.likes}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={handleRemix}
          disabled={remixing}
          className="h-7 gap-1 text-[11px]"
        >
          {remixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Remix
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleJoin}
          className="h-7 gap-1 text-[11px]"
        >
          <LogIn className="h-3 w-3" />
          Visit
        </Button>
        {isOwner && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive"
            aria-label="Remove your Brain from the gallery"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        )}
      </div>
    </article>
  );
}

export default BrainSubmissionCard;