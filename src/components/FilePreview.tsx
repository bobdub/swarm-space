import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2 } from "lucide-react";
import { decryptAndReassembleFile, importKeyRaw, Manifest } from "@/lib/fileEncryption";
import { toast } from "sonner";

interface FilePreviewProps {
  manifest: Manifest;
  onClose: () => void;
}

export const FilePreview = ({ manifest, onClose }: FilePreviewProps) => {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAndDecrypt();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [manifest]);

  const loadAndDecrypt = async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (!manifest.fileKey) {
        throw new Error("Missing encryption key for file");
      }

      // In production, the key should be stored encrypted. For now we keep it
      // directly on the manifest so we can import it and decrypt locally.
      const fileKey = await importKeyRaw(manifest.fileKey);

      const blob = await decryptAndReassembleFile(manifest, fileKey, setProgress);
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
    } catch (err) {
      console.error("Decryption error:", err);
      setError("Failed to decrypt file");
      toast.error("Failed to decrypt file");
    } finally {
      setLoading(false);
    }
  };

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
              <p className="text-sm text-muted-foreground">Decrypting... {progress}%</p>
              <Progress value={progress} className="w-64" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive">{error}</p>
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
                
                {isPdf && blobUrl && (
                  <iframe
                    src={blobUrl}
                    className="w-full h-[60vh]"
                    title={manifest.originalName}
                  />
                )}
                
                {!isImage && !isVideo && !isPdf && (
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
              {(isImage || isVideo || isPdf) && (
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
