import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, DownloadCloud, FileText, ImageIcon, Loader2, Share2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createAccountExportStream,
  type ExportProgressUpdate,
  type ExportSummary,
  type ExportRequestOptions,
} from "@/lib/utils/exporter";
import { clearArchivedLocal, estimateArchivedBytes } from "@/lib/storage/offload";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/** iOS / Android hand files to the native share tray (Save to Files, Quick Share). */
function isMobileShareTarget(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function AccountExportModal({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [includePosts, setIncludePosts] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgressUpdate | null>(null);
  const [bytesBuffered, setBytesBuffered] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [errors, setErrors] = useState<string | null>(null);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [freeableBytes, setFreeableBytes] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [freedMessage, setFreedMessage] = useState<string | null>(null);

  // The storage-full banner links here with ?export=1; reopen even if Settings is already mounted.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const resetState = useCallback(() => {
    setIncludePosts(true);
    setIncludeMedia(true);
    setIsExporting(false);
    setProgress(null);
    setBytesBuffered(0);
    setSummary(null);
    setErrors(null);
    setFileName(null);
    setArchiveFile(null);
    setDownloaded(false);
    setFreeableBytes(null);
    setConfirmingClear(false);
    setClearing(false);
    setFreedMessage(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
  }, [downloadUrl]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetState();
      }
      setOpen(nextOpen);
    },
    [resetState],
  );

  const canExport = includePosts || includeMedia;

  const handleExport = useCallback(async () => {
    if (!canExport || isExporting) {
      return;
    }

    setIsExporting(true);
    setProgress(null);
    setBytesBuffered(0);
    setErrors(null);
    setSummary(null);
    setFileName(null);
    setDownloaded(false);
    setFreeableBytes(null);
    setConfirmingClear(false);
    setFreedMessage(null);

    const options: ExportRequestOptions = {
      includePosts,
      includeMedia,
    };

    const chunks: Uint8Array[] = [];

    try {
      const { stream, summary: exportSummary, fileName: exportFileName } = await createAccountExportStream(
        options,
        {
          onProgress: (update) => {
            setProgress(update);
          },
        },
      );

      const reader = stream.getReader();
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.byteLength;
          setBytesBuffered(totalBytes);
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
      setArchiveFile(new File([blob], exportFileName, { type: "application/zip" }));
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setFileName(exportFileName);
      setSummary(exportSummary);
      estimateArchivedBytes(exportSummary.contents)
        .then(setFreeableBytes)
        .catch(() => setFreeableBytes(0));
      setProgress((prev) =>
        prev && prev.percent >= 99
          ? { ...prev, percent: 100, bytesWritten: prev.totalBytes, currentFile: null }
          : prev,
      );
      toast.success("Your export is ready to download");
    } catch (error) {
      console.error("[AccountExportModal] Failed to export data", error);
      setErrors("We couldn't prepare the export. Please try again.");
      toast.error("Failed to export account data");
    } finally {
      setIsExporting(false);
    }
  }, [canExport, includePosts, includeMedia, isExporting]);

  const canShareArchive = useMemo(() => {
    if (!archiveFile || !isMobileShareTarget()) return false;
    try {
      return typeof navigator.share === "function" && (navigator.canShare?.({ files: [archiveFile] }) ?? false);
    } catch {
      return false;
    }
  }, [archiveFile]);

  const handleShare = useCallback(async () => {
    if (!archiveFile) return;
    try {
      await navigator.share({ files: [archiveFile], title: archiveFile.name });
      setDownloaded(true);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") toast.error("Sharing failed; use Download instead");
    }
  }, [archiveFile]);

  const handleFreeUpSpace = useCallback(async () => {
    if (!summary || !downloaded || clearing) return;
    setClearing(true);
    try {
      const result = await clearArchivedLocal(summary.contents);
      setFreedMessage(`Removed ${result.removed} items from this device, about ${formatBytes(result.freedBytes)} freed.`);
      setFreeableBytes(0);
      toast.success("Space freed");
    } catch (error) {
      console.error("[AccountExportModal] Free up space failed", error);
      toast.error("Couldn't free up space. Your data is unchanged where clearing stopped.");
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  }, [summary, downloaded, clearing]);

  const clearWhat = summary
    ? [
        summary.contents.manifestIds.length > 0 ? "media" : null,
        summary.contents.postIds.length > 0 ? "posts and comments" : null,
      ].filter(Boolean).join(" and ")
    : "";

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    return Math.min(100, Math.round(progress.percent));
  }, [progress]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 sm:flex sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <DownloadCloud className="h-4 w-4" />
            Export personal archive
          </div>
          <p className="text-xs text-muted-foreground">
            A .zip of your posts as Markdown, their conversations, and decrypted media. Readable offline.
          </p>
        </div>
        <DialogTrigger asChild>
          <Button variant="secondary" className="mt-3 gap-2 sm:mt-0">
            <ShieldCheck className="h-4 w-4" />
            Open exporter
          </Button>
        </DialogTrigger>
      </div>

      <DialogContent className="max-w-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle>Export your personal archive</DialogTitle>
          <DialogDescription>
            Choose what to include. Exports run locally so your content never leaves this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background p-4">
              <Checkbox
                checked={includePosts}
                onCheckedChange={(checked) => setIncludePosts(Boolean(checked))}
                disabled={isExporting}
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  Posts & activity
                </div>
                <p className="text-xs text-muted-foreground">
                  Each post as a Markdown file with tags, timestamps, coin ID and its threaded comments.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background p-4">
              <Checkbox
                checked={includeMedia}
                onCheckedChange={(checked) => setIncludeMedia(Boolean(checked))}
                disabled={isExporting}
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4" />
                  Media attachments
                </div>
                <p className="text-xs text-muted-foreground">
                  Decrypts attachments into a media folder, linked from each post.
                </p>
              </div>
            </label>
          </div>

          {isExporting || progress ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Preparing archive…</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {progress?.currentFile ? <span>{progress.currentFile}</span> : null}
                {progress ? <span>{formatBytes(progress.bytesWritten)} processed</span> : null}
                {bytesBuffered > 0 ? <span>{formatBytes(bytesBuffered)} buffered</span> : null}
              </div>
            </div>
          ) : null}

          {summary ? (
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Ready</Badge>
                <span className="font-medium">Export prepared</span>
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Posts:</span> {summary.counts.posts}
                </li>
                <li>
                  <span className="font-medium text-foreground">Comments:</span> {summary.counts.comments}
                </li>
                <li>
                  <span className="font-medium text-foreground">Media files:</span> {summary.counts.attachments}
                </li>
                <li>
                  <span className="font-medium text-foreground">Archive entries:</span> {summary.counts.files}
                </li>
              </ul>
              {summary.warnings.length > 0 ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  {summary.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {summary ? (
            <div className="space-y-3 rounded-lg border border-border/60 bg-background p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Trash2 className="h-4 w-4" />
                Free up space
              </div>
              {freedMessage ? (
                <p className="flex items-start gap-2 text-xs text-foreground/80">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {freedMessage}
                </p>
              ) : !clearWhat || freeableBytes === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing in this zip is stored on this device to clear.</p>
              ) : confirmingClear ? (
                <div className="space-y-3">
                  <p className="text-xs text-foreground/80">
                    Your zip has these files. Clear its {clearWhat} from this device
                    {freeableBytes ? ` (about ${formatBytes(freeableBytes)})` : ""}? Your account, keys, wallet and coins stay.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirmingClear(false)} disabled={clearing}>
                      Keep
                    </Button>
                    <Button variant="destructive" size="sm" className="flex-1 gap-2" onClick={() => void handleFreeUpSpace()} disabled={clearing}>
                      {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {clearing ? "Clearing…" : "Clear from this device"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {downloaded
                      ? `Clears only the ${clearWhat} inside this zip from this device. Your account, keys, wallet and coins stay.`
                      : "Download your zip first."}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => setConfirmingClear(true)}
                    disabled={!downloaded || freeableBytes === null}
                  >
                    <Trash2 className="h-4 w-4" />
                    Free up space{freeableBytes ? ` (${formatBytes(freeableBytes)})` : ""}
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {errors ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              {errors}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isExporting || clearing}
          >
            {freedMessage ? "Done" : "Cancel"}
          </Button>
          {downloadUrl && fileName && canShareArchive ? (
            <Button onClick={() => void handleShare()} className="gap-2">
              <Share2 className="h-4 w-4" />
              Save or share
            </Button>
          ) : null}
          {downloadUrl && fileName ? (
            <Button asChild variant={canShareArchive ? "outline" : "default"}>
              <a href={downloadUrl} download={fileName} onClick={() => setDownloaded(true)}>
                Download archive
              </a>
            </Button>
          ) : (
            <Button onClick={handleExport} disabled={!canExport || isExporting} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isExporting ? "Preparing…" : "Start export"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

