/**
 * WallDecorateComposer — fullscreen DOM overlay anchored over the 3D
 * canvas while a wall is being decorated. Hosts the standard
 * `PostComposer` so authors get text + media + walled-post features
 * for free. On post creation, pins the new post to the wall via
 * `decorateWall(...)` and routes the post to the project / Explore feed
 * exactly as PostComposer already does.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PostComposer } from '@/components/PostComposer';
import { decorateWall } from '@/lib/world/wallDecorations';
import { toast } from 'sonner';
import type { Post } from '@/types';

interface WallDecorateComposerProps {
  placementId: string;
  projectId?: string | null;
  wallLabel?: string;
  onClose: () => void;
}

export function WallDecorateComposer({
  placementId,
  projectId,
  wallLabel,
  onClose,
}: WallDecorateComposerProps) {
  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePostCreated = async (post: Post) => {
    try {
      await decorateWall(placementId, post.id);
      toast.success('Wall decorated.');
    } catch (err) {
      console.warn('[wall.decorate] failed', err);
      toast.error('Could not pin post to wall.');
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[hsla(245,70%,4%,0.78)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-[hsla(174,59%,56%,0.4)] bg-[hsl(245_70%_8%/0.96)] p-4 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Decorate {wallLabel ?? 'wall'}
            </h2>
            <p className="text-xs text-muted-foreground">
              Your post appears on the wall and in the {projectId ? 'project feed' : 'Explore feed'}.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <PostComposer
          autoFocus
          defaultProjectId={projectId ?? null}
          onCancel={onClose}
          onPostCreated={(post) => { void handlePostCreated(post); }}
        />
      </div>
    </div>
  );
}