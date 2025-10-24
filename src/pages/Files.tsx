import { useState, useEffect, useMemo, useCallback } from "react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilePreview } from "@/components/FilePreview";
import { getAllManifests, deleteManifest, Manifest } from "@/lib/fileEncryption";
import { Search, Image, Video, File, Trash2 } from "lucide-react";
import { toast } from "sonner";

type FilterType = "all" | "images" | "videos" | "documents";

const Files = () => {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedManifest, setSelectedManifest] = useState<Manifest | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");

  const loadManifests = useCallback(async () => {
    try {
      const data = await getAllManifests();
      setManifests(data);
    } catch (error) {
      console.error("Failed to load manifests:", error);
      toast.error("Failed to load files");
    }
  }, []);

  useEffect(() => {
    void loadManifests();
  }, [loadManifests]);

  const filteredManifests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return manifests.filter(manifest => {
      const mime = manifest.mime.toLowerCase();
      const matchesType =
        filterType === "all" ||
        (filterType === "images" && mime.startsWith("image/")) ||
        (filterType === "videos" && mime.startsWith("video/")) ||
        (filterType === "documents" &&
          (mime === "application/pdf" || mime.includes("document") || mime.includes("text")));

      const nameMatches =
        query.length === 0 || manifest.originalName.toLowerCase().includes(query);

      return matchesType && nameMatches;
    });
  }, [filterType, manifests, searchQuery]);

  const handleFilterChange = (value: string) => {
    if (value === "all" || value === "images" || value === "videos" || value === "documents") {
      setFilterType(value);
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm("Delete this file? This cannot be undone.")) return;

    try {
      await deleteManifest(fileId);
      toast.success("File deleted");
      await loadManifests();
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete file");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const getFileIcon = (mime: string) => {
    if (mime.startsWith("image/")) return <Image className="w-5 h-5" />;
    if (mime.startsWith("video/")) return <Video className="w-5 h-5" />;
    return <File className="w-5 h-5" />;
  };

  const totalStorage = useMemo(
    () => manifests.reduce((sum, manifest) => sum + manifest.size, 0),
    [manifests],
  );

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="max-w-6xl mx-auto px-3 md:px-6 pb-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Files</h1>
              <p className="text-muted-foreground mt-1">
                {manifests.length} files • {formatFileSize(totalStorage)} used
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters */}
          <Tabs value={filterType} onValueChange={handleFilterChange}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
              <TabsTrigger value="videos">Videos</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>

            <TabsContent value={filterType} className="mt-6">
              {filteredManifests.length === 0 ? (
                <Card className="p-12 text-center">
                  <File className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No files found</p>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {filteredManifests.map(manifest => (
                    <Card key={manifest.fileId} className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="text-muted-foreground">
                          {getFileIcon(manifest.mime)}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{manifest.originalName}</h3>
                          <p className="text-sm text-muted-foreground">
                            {formatFileSize(manifest.size)} • {formatDate(manifest.createdAt)}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedManifest(manifest)}
                          >
                            Preview
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(manifest.fileId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
      </main>

      {/* Preview Modal */}
      {selectedManifest && (
        <FilePreview
          manifest={selectedManifest}
          onClose={() => setSelectedManifest(null)}
        />
      )}
    </div>
  );
};

export default Files;
