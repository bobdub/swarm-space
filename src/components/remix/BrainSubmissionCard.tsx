/**
 * BrainSubmissionCard — one entry in the public Brains gallery.
 *
 * Live frame: lazy iframe pointing at `/brain?projectId=<id>`. We render
 * the iframe only after the card scrolls into view to keep the gallery
 * cheap. Sandboxed to prevent the embedded scene from hijacking the
 * parent route.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Heart, Sparkles, LogIn, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createProject } from '@/lib/projects';
import {
  likeBrainSubmission,
  removeBrainSubmission,
  type BrainSubmission,
} from '@/lib/remix/brainSubmissionsStore';

interface Props {
  submission: BrainSubmission;
  currentUserId: string | null;
}

export function BrainSubmissionCard({ submission, currentUserId }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [inView, setInView] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { setInView(true); io.disconnect(); break; }
      },
      { rootMargin: '120px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  const isOwner = currentUserId && submission.actorId === currentUserId;

  const handleRemix = async () => {
    if (remixing) return;
    setRemixing(true);
    try {
      const next = await createProject(
        `${submission.projectName} (Remix)`,
        submission.projectDescription ?? `Remix of ${submission.projectName}`,
      );
      toast({
        title: 'Brain remixed',
        description: `${next.name} created from ${submission.projectName}.`,
      });
      navigate(`/project/${next.id}`);
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
    navigate(`/project/${submission.projectId}`);
  };

  const handleLike = () => { void likeBrainSubmission(submission.id); };

  const handleRemove = async () => {
    if (!currentUserId) return;
    const ok = await removeBrainSubmission(submission.id, currentUserId);
    if (ok) toast({ title: 'Removed from gallery' });
  };

  return (
    <article
      ref={ref}
      className="flex flex-col gap-2 overflow-hidden rounded-md border border-border/40 bg-background/40 p-2"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border/30 bg-gradient-to-br from-primary/15 via-background to-background">
        {inView ? (
          <iframe
            src={`/brain?projectId=${encodeURIComponent(submission.projectId)}`}
            title={`${submission.projectName} Brain preview`}
            className="h-full w-full"
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            Loading…
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-full bg-background/80 px-1.5 py-[1px] text-[9px] font-medium text-foreground/80 backdrop-blur">
          live
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
          Join
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