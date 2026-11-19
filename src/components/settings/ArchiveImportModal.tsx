/**
 * Restore a Personal Archive (.zip) into this browser: drag-and-drop or pick
 * a file, unpack locally, re-encrypt media into chunk storage.
 */

import { useCallback, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { FileArchive, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import type { ArchiveImportProgress, ArchiveImportResult } from "@/lib/archive/archiveImport";

export function ArchiveImportModal() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ArchiveImportProgress | null>(null);
  const [result, setResult] = useState<ArchiveImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setDragging(false);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const pick = (candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!/\.zip$/i.test(candidate.name) && candidate.type !== "application/zip") {
      toast.error("Choose a .zip personal archive");
      return;
    }
    setResult(null);
    setError(null);
    setFile(candidate);
  };

  const handleImport = async () => {
    if (!file || importing) return;
    setImporting(true);
    setError(null);
    try {
      const { importPersonalArchive } = await import("@/lib/archive/archiveImport");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await importPersonalArchive(bytes, { onProgress: setProgress });
      setResult(res);
      toast.success(`Restored ${res.posts} post${res.posts === 1 ? "" : "s"}`);
    } catch (err) {
      console.error("[ArchiveImportModal] import failed", err);
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !importing) reset(); if (!importing) setOpen(next); }}>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 sm:flex sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UploadCloud className="h-4 w-4" />
            Import personal archive
          </div>
          <p className="text-xs text-muted-foreground">Restore posts, comments and media from an exported .zip.</p>
        </div>
        <DialogTrigger asChild>
          <Button variant="secondary" className="mt-3 gap-2 sm:mt-0">
            <FileArchive className="h-4 w-4" />
            Open importer
          </Button>
        </DialogTrigger>
      </div>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a personal archive</DialogTitle>
          <DialogDescription>
            Unpacked on this device. Only posts you authored are restored, and existing posts are left untouched.
          </DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
            dragging ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/50"
          }`}
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{file ? file.name : "Drop your .zip here or tap to choose"}</p>
          {file && <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>

        {(importing || progress) && !result && (
          <div className="space-y-2">
            <Progress value={percent} className="h-2" />
            <p className="truncate text-xs text-muted-foreground">{progress?.current ?? "Reading archive…"}</p>
          </div>
        )}

        {result && (
          <ul className="space-y-1 rounded-lg border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
            <li><span className="font-medium text-foreground">Posts restored:</span> {result.posts}</li>
            <li><span className="font-medium text-foreground">Comments restored:</span> {result.comments}</li>
            <li><span className="font-medium text-foreground">Media re-encrypted:</span> {result.media}</li>
            {result.skippedExisting > 0 && <li>Already on this device: {result.skippedExisting}</li>}
            {result.skippedForeign > 0 && <li>Authored by someone else (skipped): {result.skippedForeign}</li>}
            {result.warnings.slice(0, 5).map((w) => <li key={w} className="text-amber-500">{w}</li>)}
          </ul>
        )}

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { reset(); setOpen(false); }} disabled={importing}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={() => void handleImport()} disabled={!file || importing} className="gap-2">
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              {importing ? "Importing…" : "Import archive"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
