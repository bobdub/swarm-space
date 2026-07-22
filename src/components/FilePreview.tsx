import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { decryptAndReassembleFile, importFileKey, Manifest } from "@/lib/fileEncryption";
import { progressiveDecryptToBlob } from "@/lib/torrent/streamingDecryptor";
import { reportDeliveryEvent } from "@/lib/pipeline/deliveryTelemetry";
import { ensureManifestChunks } from "@/lib/p2p/chunkFetch";
import { toast } from "sonner";

interface FilePreviewProps {
  manifest: Manifest;
  onClose: () => void;
}

export const FilePreview = ({ manifest, onClose }: FilePreviewProps) => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("Decrypting");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAndDecrypt = useCallback(async () => {
    let nextUrl: string | null = null;
    try {
      setLoading(true);
      setError(null);
      setProgress(0);

      if (!manifest.fileKey) {
        throw new Error("Missing encryption key for file");
      }

      const fileKey = await importFileKey(manifest);

      // Pull any chunks we don't already have from peers before decrypting.
      // Without this, a shared file with even one missing piece fails immediately.
      setStatus("Fetching missing pieces from peers");
      const pre = await ensureManifestChunks(manifest);
      if (!pre.ok && pre.missing.length === manifest.chunks.length) {
        if (pre.offline) {
          throw new Error(
            `This file isn't available offline. Connect to the SWARM so peers can send the ${pre.missing.length} missing pieces.`,
          );
        }
        throw new Error(
          `This file isn't available yet — ${pre.missing.length} pieces still need to sync from other users. Try again once a seeder comes online.`,
        );
      }

      setStatus("Decrypting");
      const runDecrypt = () =>
        manifest.chunks.length > 100
          ? progressiveDecryptToBlob(manifest, (p) => setProgress(p.percent))
          : decryptAndReassembleFile(manifest, fileKey, setProgress);

      let blob: Blob;
      try {
        blob = await runDecrypt();
      } catch (firstErr) {
        // Likely a still-missing chunk. One more targeted sweep then retry.
        console.warn("[FilePreview] first decrypt attempt failed, re-fetching chunks", firstErr);
        setStatus("Fetching missing pieces from peers");
        setProgress(0);
        const retryFetch = await ensureManifestChunks(manifest);
        if (!retryFetch.ok) {
          throw new Error(
            `Still waiting on ${retryFetch.missing.length} piece(s) from peers. Try again shortly.`,
          );
        }
        setStatus("Decrypting");
        blob = await runDecrypt();
      }

      nextUrl = URL.createObjectURL(blob);
      setBlobUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return nextUrl;
      });
    } catch (err) {
      console.error("Decryption error:", err);
      reportDeliveryEvent({ kind: 'decrypt-failure', manifestId: manifest.fileId });
      const message = err instanceof Error ? err.message : "Failed to decrypt file";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
    return nextUrl;
  }, [manifest]);

  useEffect(() => {
    void loadAndDecrypt();
  }, [loadAndDecrypt]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  const handleDownload = () => {
    if (!blobUrl) return;
    
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = manifest.originalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("Download started");
  };

  const isImage = manifest.mime.startsWith("image/");
  const isVideo = manifest.mime.startsWith("video/");
  const isAudio = manifest.mime.startsWith("audio/");
  const isPdf = manifest.mime === "application/pdf";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{manifest.originalName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{status}... {progress}%</p>
              <Progress value={progress} className="w-64" />
            </div>
          ) : error ? (
            <div className="text-center py-12 space-y-4">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={() => void loadAndDecrypt()} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Retry
              </Button>
            </div>
          ) : (
            <>
              {/* Preview */}
              <div className="border rounded-lg overflow-hidden bg-muted">
                {isImage && blobUrl && (
                  <img
                    src={blobUrl}
                    alt={manifest.originalName}
                    className="w-full h-auto max-h-[60vh] object-contain"
                  />
                )}
                
                {isVideo && blobUrl && (
                  <video
                    src={blobUrl}
                    controls
                    className="w-full h-auto max-h-[60vh]"
                  >
                    Your browser does not support video playback.
                  </video>
                )}

                {isAudio && blobUrl && (
                  <div className="flex items-center justify-center p-6">
                    <audio src={blobUrl} controls preload="metadata" className="w-full" />
                  </div>
                )}
                
                {isPdf && blobUrl && (
                  <iframe
                    src={blobUrl}
                    className="w-full h-[60vh]"
                    title={manifest.originalName}
                  />
                )}
                
                {!isImage && !isVideo && !isAudio && !isPdf && (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <p className="text-muted-foreground">Preview not available</p>
                    <Button onClick={handleDownload} className="gap-2">
                      <Download className="w-4 h-4" />
                      Download to view
                    </Button>
                  </div>
                )}
              </div>

              {/* Actions */}
              {(isImage || isVideo || isAudio || isPdf) && (
                <div className="flex justify-end">
                  <Button onClick={handleDownload} className="gap-2">
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
