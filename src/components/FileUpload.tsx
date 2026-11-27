import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { X, Upload, File, Image as ImageIcon, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { chunkAndEncryptFile, genFileKey, Manifest } from "@/lib/fileEncryption";
import { getAdaptiveChunkSize } from "@/lib/p2p/torrentSwarm.standalone";
import { toast } from "sonner";
import { useP2PContext } from "@/contexts/P2PContext";
import { formatUploadLimit, routeUploadFor, VIDEO_TRANSCODE_WAIT_TOOLTIP, type PostDistribution } from "@/lib/media/meshUploadLimits";
import type { MediaCoinPostRef } from "@/types";
import { AudioTranscodeError, shouldTranscodeAudio, transcodeAudioForMesh } from "@/lib/media/audioTranscode";

/** Extract natural width/height from an image or video File */
function getMediaDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((raw) => {
    const url = URL.createObjectURL(file);
    // Files are processed one at a time, so a codec that never reports
    // metadata must not hold up the rest of the queue.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      raw(null);
    }, 5000);
    const resolve = (v: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      raw(v);
    };
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    } else if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight }); URL.revokeObjectURL(url); };
      video.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      video.src = url;
    } else {
      URL.revokeObjectURL(url);
      resolve(null);
    }
  });
}

/**
 * An attached file, already encrypted for the path its size chose:
 * torrent (torrent store) or Media Coin (Media Coin content store).
 * The two never share a copy.
 */
export type RoutedAttachment =
  | { id: string; route: "torrent"; size: number; manifest: Manifest }
  | { id: string; route: "media-coin"; size: number; ref: MediaCoinPostRef };

/** Encrypts a file into the Media Coin content store (supplied by the poster). */
export type MediaCoinEncryptor = (
  file: File,
  info: { mediaWidth?: number; mediaHeight?: number; onProgress: (percent: number) => void },
) => Promise<MediaCoinPostRef>;

interface FileUploadProps {
  onFilesReady?: (manifests: Manifest[]) => void;
  /**
   * Route each file by its size as it is attached (torrent while the
   * post's torrent share stays within 50 MB, else Media Coin) and encrypt
   * it for that path right away. Routed files are announced by the poster
   * at publish time, not here.
   */
  encryptForMediaCoin?: MediaCoinEncryptor;
  onAttachmentsReady?: (attachments: RoutedAttachment[]) => void;
  /** A finished attachment was removed; the poster drops its encrypted copy. */
  onAttachmentRemoved?: (attachment: RoutedAttachment) => void;
  onEncryptingChange?: (encrypting: boolean) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  /** Upload space shared by every file (defaults to no shared cap). */
  maxTotalSize?: number;
  /** Extra line under the limits (e.g. how the post will travel). */
  hint?: string;
  acceptedTypes?: string[];
}

interface FileWithProgress {
  id: string;
  file: File;
  progress: number;
  /**
   * "queued" = waiting for the file ahead of it to finish encrypting.
   * "transcoding" = long audio being compressed to fit the mesh limit.
   */
  status: "queued" | "transcoding" | "encrypting" | "done" | "error";
  /** Path chosen from the file's size when it was attached (routed mode). */
  route?: PostDistribution;
  manifest?: Manifest;
  ref?: MediaCoinPostRef;
  error?: string;
  /** Local blob: URL so queued videos can be watched before they are processed. */
  previewUrl?: string;
}

const isVideo = (file: File) => file.type.startsWith("video/");

export const FileUpload = ({
  onFilesReady,
  encryptForMediaCoin,
  onAttachmentsReady,
  onAttachmentRemoved,
  onEncryptingChange,
  maxFiles = 10,
  maxFileSize = 20 * 1024 * 1024, // 20MB
  maxTotalSize,
  hint,
  acceptedTypes = ["image/*", "video/*", "audio/*", "application/pdf"]
}: FileUploadProps) => {
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { announceContent } = useP2PContext();

  // One file is chunked/encrypted at a time, in the order it was added. A
  // second drop joins the same line instead of encrypting alongside the
  // first, so only one video is ever being processed at once.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const cancelledRef = useRef(new Set<string>());
  const previewUrlsRef = useRef(new Set<string>());
  const nextIdRef = useRef(0);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const limitLabel = formatUploadLimit(maxFileSize);

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const fileArray = Array.from(selectedFiles);
    
    // Validate file count (failed files no longer hold a slot)
    const kept = files.filter((f) => f.status !== "error");
    if (kept.length + fileArray.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed`);
      return;
    }
    let usedBytes = kept.reduce((sum, f) => sum + f.file.size, 0);
    const routed = Boolean(encryptForMediaCoin);
    let torrentBytes = kept.filter((f) => f.route === "torrent").reduce((sum, f) => sum + f.file.size, 0);

    // Validate and add files
    const newFiles: FileWithProgress[] = [];
    for (const file of fileArray) {
      // Check file size
      // Long audio is compressed to fit instead of being turned away.
      if (file.size > maxFileSize && !shouldTranscodeAudio(file, maxFileSize)) {
        toast.error(
          `${file.name} is ${formatFileSize(file.size)}. Files are limited to ${limitLabel} so peers can carry them over the mesh.`
        );
        continue;
      }
      if (maxTotalSize && usedBytes + file.size > maxTotalSize) {
        toast.error(
          `${file.name} would take this post over ${formatUploadLimit(maxTotalSize)} of uploads.`
        );
        continue;
      }
      usedBytes += file.size;

      // The file's size picks its path now, so it is encrypted for that
      // path while it uploads.
      let route: PostDistribution | undefined;
      if (routed) {
        route = routeUploadFor(file.size, torrentBytes);
        if (route === "torrent") torrentBytes += file.size;
      }

      let previewUrl: string | undefined;
      if (isVideo(file)) {
        previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
      }

      newFiles.push({
        id: `upload-${nextIdRef.current++}`,
        file,
        progress: 0,
        status: "queued",
        route,
        previewUrl,
      });
    }

    if (newFiles.length === 0) return;
    setFiles(prev => [...prev, ...newFiles]);

    for (const item of newFiles) enqueue(item);
  };

  const enqueue = (item: FileWithProgress) => {
    pendingRef.current += 1;
    if (pendingRef.current === 1) onEncryptingChange?.(true);
    queueRef.current = queueRef.current
      .then(() => processFile(item))
      .catch((err) => {
        console.error("[FileUpload] queue step crashed:", err);
      })
      .finally(() => {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) onEncryptingChange?.(false);
      });
  };

  const updateFile = (id: string, patch: Partial<FileWithProgress>) => {
    setFiles(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
  };

  const processFile = async (item: FileWithProgress) => {
    if (cancelledRef.current.has(item.id)) {
      cancelledRef.current.delete(item.id);
      return;
    }
    let source = item.file;
    try {
      if (shouldTranscodeAudio(source, maxFileSize)) {
        updateFile(item.id, { status: "transcoding", progress: 0 });
        source = await transcodeAudioForMesh(source, {
          limitBytes: maxFileSize,
          onProgress: (progress) => updateFile(item.id, { progress }),
        });
        updateFile(item.id, { file: source, progress: 0 });
      }

      updateFile(item.id, { status: "encrypting" });

      if (item.route === "media-coin" && encryptForMediaCoin) {
        const dims = await getMediaDimensions(source);
        const ref = await encryptForMediaCoin(source, {
          mediaWidth: dims?.width,
          mediaHeight: dims?.height,
          onProgress: (progress) => updateFile(item.id, { progress }),
        });
        updateFile(item.id, { status: "done", ref, progress: 100 });
        onAttachmentsReady?.([{ id: item.id, route: "media-coin", size: ref.size, ref }]);
        toast.success(`${source.name} encrypted for Media Coin`);
        return;
      }

      // Generate file key and encrypt
      const fileKey = await genFileKey();
      const manifest = await chunkAndEncryptFile(
        source,
        fileKey,
        getAdaptiveChunkSize(source.size),
        (progress) => updateFile(item.id, { progress })
      );

      // Capture media dimensions for images/videos to prevent layout shift
      const dims = await getMediaDimensions(source);
      if (dims) {
        manifest.mediaWidth = dims.width;
        manifest.mediaHeight = dims.height;
      }

      updateFile(item.id, { status: "done", manifest, progress: 100 });

      if (item.route === "torrent") {
        // Routed: the poster announces at publish time.
        onAttachmentsReady?.([{ id: item.id, route: "torrent", size: manifest.size, manifest }]);
      } else {
        announceContent(manifest.fileId);
        onFilesReady?.([manifest]);
      }
      toast.success(`${source.name} encrypted and ready`);
    } catch (error) {
      if (error instanceof AudioTranscodeError) {
        updateFile(item.id, { status: "error", error: "Couldn't compress audio" });
        toast.error(`${item.file.name}: ${error.message}`);
        return;
      }
      console.error("Encryption error:", error);
      updateFile(item.id, { status: "error", error: "Encryption failed" });
      toast.error(`Failed to encrypt ${item.file.name}`);
    }
  };

  const removeFile = (id: string) => {
    const target = files.find(f => f.id === id);
    if (!target) return;
    if (target.status === "queued") cancelledRef.current.add(id);
    if (target.status === "done") {
      if (target.route === "media-coin" && target.ref) {
        onAttachmentRemoved?.({ id, route: "media-coin", size: target.ref.size, ref: target.ref });
      } else if (target.route === "torrent" && target.manifest) {
        onAttachmentRemoved?.({ id, route: "torrent", size: target.manifest.size, manifest: target.manifest });
      }
    }
    if (target.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      previewUrlsRef.current.delete(target.previewUrl);
    }
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-medium mb-2">Drop files here or click to browse</p>
        <p className="text-sm text-muted-foreground">
          {maxTotalSize
            ? `Max ${maxFiles} files, ${formatUploadLimit(maxTotalSize)} in total (mesh limit)`
            : `Max ${maxFiles} files, up to ${limitLabel} each (mesh limit)`}
        </p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        <p className="text-xs text-muted-foreground mt-1">
          Longer audio is compressed to fit automatically.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(",")}
          onChange={(e) => {
            e.stopPropagation();
            handleFileSelect(e.target.files);
          }}
          className="hidden"
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((fileWithProgress) => (
            <Card key={fileWithProgress.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1">{getFileIcon(fileWithProgress.file)}</div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium truncate">{fileWithProgress.file.name}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(fileWithProgress.id)}
                      disabled={fileWithProgress.status === "encrypting" || fileWithProgress.status === "transcoding"}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <p className="text-sm text-muted-foreground mb-2">
                    {formatFileSize(fileWithProgress.file.size)}
                    {fileWithProgress.status === "queued" && !isVideo(fileWithProgress.file) && " • Queued"}
                    {fileWithProgress.status === "transcoding" && " • Compressing audio to fit the mesh..."}
                    {fileWithProgress.route && ` • ${fileWithProgress.route === "media-coin" ? "Media Coin" : "Torrent"}`}
                    {fileWithProgress.status === "encrypting" && " • Encrypting..."}
                    {fileWithProgress.status === "done" && " • Encrypted ✓"}
                    {fileWithProgress.status === "error" && ` • ${fileWithProgress.error}`}
                  </p>
                  
                  {fileWithProgress.status === "queued" && isVideo(fileWithProgress.file) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className="mb-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <Clock className="h-3 w-3" />
                          Waiting to transcode
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {VIDEO_TRANSCODE_WAIT_TOOLTIP}
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {fileWithProgress.previewUrl && (
                    <video
                      src={fileWithProgress.previewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="mb-2 max-h-48 w-full rounded-md bg-black"
                    />
                  )}

                  {(fileWithProgress.status === "transcoding" || fileWithProgress.status === "encrypting" || fileWithProgress.status === "done") && (
                    <Progress value={fileWithProgress.progress} className="h-1" />
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
