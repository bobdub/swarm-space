import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { X, Upload, File, Image as ImageIcon } from "lucide-react";
import { chunkAndEncryptFile, genFileKey, Manifest } from "@/lib/fileEncryption";
import { toast } from "sonner";

interface FileUploadProps {
  onFilesReady: (manifests: Manifest[]) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  acceptedTypes?: string[];
}

interface FileWithProgress {
  file: File;
  progress: number;
  status: "pending" | "encrypting" | "done" | "error";
  manifest?: Manifest;
  error?: string;
}

export const FileUpload = ({
  onFilesReady,
  maxFiles = 10,
  maxFileSize = 100 * 1024 * 1024, // 100MB
  acceptedTypes = ["image/*", "video/*", "application/pdf"]
}: FileUploadProps) => {
  const [files, setFiles] = useState<FileWithProgress[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const fileArray = Array.from(selectedFiles);
    
    // Validate file count
    if (files.length + fileArray.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed`);
      return;
    }

    // Validate and add files
    const newFiles: FileWithProgress[] = [];
    for (const file of fileArray) {
      // Check file size
      if (file.size > maxFileSize) {
        toast.error(`${file.name} exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit`);
        continue;
      }

      newFiles.push({
        file,
        progress: 0,
        status: "pending"
      });
    }

    setFiles(prev => [...prev, ...newFiles]);

    // Start encryption process
    processFiles(newFiles);
  };

  const processFiles = async (filesToProcess: FileWithProgress[]) => {
    const manifests: Manifest[] = [];

    for (const fileWithProgress of filesToProcess) {
      try {
        // Update status to encrypting
        setFiles(prev => prev.map(f => 
          f.file === fileWithProgress.file 
            ? { ...f, status: "encrypting" as const }
            : f
        ));

        // Generate file key and encrypt
        const fileKey = await genFileKey();
        const manifest = await chunkAndEncryptFile(
          fileWithProgress.file,
          fileKey,
          64 * 1024,
          (progress) => {
            setFiles(prev => prev.map(f => 
              f.file === fileWithProgress.file 
                ? { ...f, progress }
                : f
            ));
          }
        );

        // Mark as done
        setFiles(prev => prev.map(f => 
          f.file === fileWithProgress.file 
            ? { ...f, status: "done" as const, manifest, progress: 100 }
            : f
        ));

        manifests.push(manifest);
      } catch (error) {
        console.error("Encryption error:", error);
        setFiles(prev => prev.map(f => 
          f.file === fileWithProgress.file 
            ? { ...f, status: "error" as const, error: "Encryption failed" }
            : f
        ));
        toast.error(`Failed to encrypt ${fileWithProgress.file.name}`);
      }
    }

    if (manifests.length > 0) {
      onFilesReady(manifests);
      toast.success(`${manifests.length} file(s) encrypted and ready`);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <Card
        className={`border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
          isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-medium mb-2">Drop files here or click to browse</p>
        <p className="text-sm text-muted-foreground">
          Max {maxFiles} files, up to {Math.round(maxFileSize / 1024 / 1024)}MB each
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(",")}
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
      </Card>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((fileWithProgress, index) => (
            <Card key={index} className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1">{getFileIcon(fileWithProgress.file)}</div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium truncate">{fileWithProgress.file.name}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      disabled={fileWithProgress.status === "encrypting"}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <p className="text-sm text-muted-foreground mb-2">
                    {formatFileSize(fileWithProgress.file.size)}
                    {fileWithProgress.status === "encrypting" && " • Encrypting..."}
                    {fileWithProgress.status === "done" && " • Encrypted ✓"}
                    {fileWithProgress.status === "error" && ` • ${fileWithProgress.error}`}
                  </p>
                  
                  {(fileWithProgress.status === "encrypting" || fileWithProgress.status === "done") && (
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
