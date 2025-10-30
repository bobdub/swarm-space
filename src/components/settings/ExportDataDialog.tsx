import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { Post } from "@/types";
import { downloadAccountExport, listExportablePosts, type ExportProgress } from "@/lib/exporterClient";
import { toast } from "sonner";

interface ExportDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ExportDataDialog({ open, onOpenChange }: ExportDataDialogProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setProgress(null);
      setStatusMessage(null);
      return;
    }

    let cancelled = false;
    setLoadingPosts(true);
    listExportablePosts()
      .then((available) => {
        if (cancelled) return;
        setPosts(available);
        setSelected(new Set(available.map((post) => post.id)));
      })
      .catch((error) => {
        console.error("[ExportDataDialog] Failed to load posts", error);
        if (!cancelled) {
          toast.error("Unable to load posts for export");
          setPosts([]);
          setSelected(new Set());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPosts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const postCount = selected.size;
  const allSelected = postCount > 0 && postCount === posts.length;

  const exportDisabled = isExporting || postCount === 0;

  const progressPercent = useMemo(() => {
    if (!progress?.total) return null;
    if (progress.total === 0) return null;
    return Math.min(100, Math.round((progress.bytes / progress.total) * 100));
  }, [progress]);

  const togglePost = (postId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(posts.map((post) => post.id)));
    }
  };

  const handleExport = async () => {
    if (exportDisabled) return;
    setIsExporting(true);
    setProgress({ bytes: 0, total: undefined });
    setStatusMessage(null);
    try {
      const result = await downloadAccountExport({
        postIds: Array.from(selected),
        includePosts: true,
        includeComments,
        includeMedia,
        onProgress: (update) => {
          setProgress(update);
        },
      });
      const sizeLabel = formatBytes(result.bytesTransferred);
      const details = `${result.metadata.posts} posts${result.metadata.media ? ` · ${result.metadata.media} media` : ""}`;
      toast.success("Export ready", {
        description: `${details} (${sizeLabel}) saved to your device.`,
      });
      setStatusMessage(`Exported ${details}. Downloaded ${sizeLabel}.`);
    } catch (error) {
      console.error("[ExportDataDialog] Export failed", error);
      toast.error("Failed to export data");
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export your data</DialogTitle>
          <DialogDescription>
            Choose which posts and attachments to include in a downloadable archive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Include comments</p>
              <p className="text-xs text-muted-foreground">
                Adds threaded discussions for the selected posts.
              </p>
            </div>
            <Switch
              checked={includeComments}
              onCheckedChange={setIncludeComments}
              disabled={isExporting}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Include media</p>
              <p className="text-xs text-muted-foreground">
                Decrypts attached files and bundles them alongside your posts.
              </p>
            </div>
            <Switch
              checked={includeMedia}
              onCheckedChange={setIncludeMedia}
              disabled={isExporting}
            />
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
              <div>
                <p className="font-medium text-sm">Posts</p>
                <p className="text-xs text-muted-foreground">
                  {loadingPosts
                    ? "Loading your posts…"
                    : posts.length === 0
                      ? "No posts found for your account"
                      : `${postCount} of ${posts.length} selected`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={toggleAll} disabled={loadingPosts || isExporting}>
                {allSelected ? "Clear" : "Select all"}
              </Button>
            </div>
            <ScrollArea className="max-h-64">
              <div className="divide-y">
                {posts.map((post) => (
                  <label
                    key={post.id}
                    className="flex items-start gap-3 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(post.id)}
                      onCheckedChange={() => togglePost(post.id)}
                      disabled={isExporting}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium line-clamp-2">{post.content || "Untitled post"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(post.createdAt)}</span>
                        <Badge variant="secondary" className="uppercase tracking-wide">
                          {post.type}
                        </Badge>
                        {post.manifestIds?.length ? (
                          <span>{post.manifestIds.length} attachment{post.manifestIds.length > 1 ? "s" : ""}</span>
                        ) : null}
                      </div>
                    </div>
                  </label>
                ))}
                {posts.length === 0 && !loadingPosts ? (
                  <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                    Nothing to export yet. Create a post first.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>

          {progress && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Streaming archive…</span>
                <span>
                  {formatBytes(progress.bytes)}
                  {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                </span>
              </div>
              {progressPercent !== null ? <Progress value={progressPercent} /> : <Progress value={100} className="animate-pulse" />}
            </div>
          )}

          {statusMessage && (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success-foreground">
              {statusMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Close
          </Button>
          <Button onClick={handleExport} disabled={exportDisabled}>
            {isExporting ? "Preparing export…" : `Export ${postCount} post${postCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
