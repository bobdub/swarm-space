import { useState, useEffect } from "react";
import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilePreview } from "@/components/FilePreview";
import { getAllManifests, deleteManifest, Manifest } from "@/lib/fileEncryption";
import { Search, Image, Video, File, Trash2 } from "lucide-react";
import { toast } from "sonner";

const Files = () => {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [filteredManifests, setFilteredManifests] = useState<Manifest[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedManifest, setSelectedManifest] = useState<Manifest | null>(null);
  const [filterType, setFilterType] = useState<"all" | "images" | "videos" | "documents">("all");

  useEffect(() => {
    loadManifests();
  }, []);

  useEffect(() => {
    filterManifests();
  }, [manifests, searchQuery, filterType]);

  const loadManifests = async () => {
    try {
      const data = await getAllManifests();
      setManifests(data);
    } catch (error) {
      console.error("Failed to load manifests:", error);
      toast.error("Failed to load files");
    }
  };

  const filterManifests = () => {
    let filtered = manifests;

    // Filter by type
    if (filterType === "images") {
      filtered = filtered.filter(m => m.mime.startsWith("image/"));
    } else if (filterType === "videos") {
      filtered = filtered.filter(m => m.mime.startsWith("video/"));
    } else if (filterType === "documents") {
      filtered = filtered.filter(m => 
        m.mime === "application/pdf" || 
        m.mime.includes("document") ||
        m.mime.includes("text")
      );
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(m => 
        m.originalName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredManifests(filtered);
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm("Delete this file? This cannot be undone.")) return;

    try {
      await deleteManifest(fileId);
      toast.success("File deleted");
      loadManifests();
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

  const totalStorage = manifests.reduce((sum, m) => sum + m.size, 0);

  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
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
          <Tabs value={filterType} onValueChange={(v) => setFilterType(v as any)}>
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
        </div>
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
