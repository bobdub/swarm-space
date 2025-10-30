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
import { DownloadCloud, FileText, ImageIcon, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  createAccountExportStream,
  type ExportProgressUpdate,
  type ExportSummary,
  type ExportRequestOptions,
} from "@/lib/utils/exporter";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function AccountExportModal() {
  const [open, setOpen] = useState(false);
  const [includePosts, setIncludePosts] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgressUpdate | null>(null);
  const [bytesBuffered, setBytesBuffered] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [errors, setErrors] = useState<string | null>(null);

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
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setFileName(exportFileName);
      setSummary(exportSummary);
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
            Export content archive
          </div>
          <p className="text-xs text-muted-foreground">
            Bundle your posts and media into a portable archive.
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
          <DialogTitle>Export your data</DialogTitle>
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
                  Includes your posts with metadata, reactions, and timestamps.
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
                  Reassembles referenced files and adds manifest details for each attachment.
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
            disabled={isExporting}
          >
            Cancel
          </Button>
          {downloadUrl && fileName ? (
            <Button asChild>
              <a href={downloadUrl} download={fileName}>
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

