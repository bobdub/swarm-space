/**
 * Unsupported Content — posts this node stopped supporting (Stop Support
 * from the feed or a Brain wall). Resume Support restores seeding, relaying
 * and visibility, including any Brain wall that pins the post.
 */
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Unplug, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  hydrateUnsupportedPosts,
  resumeSupportingPost,
  useUnsupportedPosts,
} from '@/lib/content/unsupportedPostsStore';

export function UnsupportedContentPanel() {
  const entries = useUnsupportedPosts();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void hydrateUnsupportedPosts(); }, []);

  const resume = async (postId: string) => {
    setBusy(postId);
    try {
      await resumeSupportingPost(postId);
      toast.success('Support resumed · this node holds and seeds the post again');
    } catch {
      toast.error("Couldn't resume support");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-foreground/10" data-testid="unsupported-content-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Unplug className="h-4 w-4 text-primary" />
          Unsupported Content
          <Badge variant="outline" className="ml-auto text-xs">{entries.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Posts and Brain walls this node stopped supporting. They are hidden here, not seeded and not relayed, and Brain walls showing them are removed on this device.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here. Use Stop Support on a post or a Brain wall to opt out of carrying it.
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.postId}
              className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm text-foreground">
                  {entry.preview || <span className="italic text-muted-foreground">No preview</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.authorName || (entry.author ? `${entry.author.slice(0, 10)}…` : 'Unknown builder')}
                  {' · '}
                  {entry.kind === 'placement' ? 'Brain wall' : entry.source === 'brain' ? 'post from a Brain wall' : 'from the feed'}
                  {' · '}
                  {formatDistanceToNow(new Date(entry.unsupportedAt), { addSuffix: true })}
                  {entry.manifestIds.length > 0 && ` · ${entry.manifestIds.length} file${entry.manifestIds.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === entry.postId}
                onClick={() => void resume(entry.postId)}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {busy === entry.postId ? 'Resuming…' : 'Resume Support'}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
