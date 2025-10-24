import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileUpload } from "@/components/FileUpload";
import { useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { put } from "@/lib/store";
import { Post } from "@/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Manifest } from "@/lib/fileEncryption";
import { X } from "lucide-react";

const Create = () => {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [attachedManifests, setAttachedManifests] = useState<Manifest[]>([]);
  const user = getCurrentUser();
  const navigate = useNavigate();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !content.trim()) return;
    
    setLoading(true);
    try {
      const manifestIds = attachedManifests.map(m => m.fileId);
      const postType = manifestIds.length > 0 
        ? (attachedManifests[0].mime.startsWith("image/") ? "image" : 
           attachedManifests[0].mime.startsWith("video/") ? "video" : "file")
        : "text";

      const post: Post = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: user.id,
        authorName: user.displayName || user.username,
        type: postType,
        content: content.trim(),
        manifestIds,
        createdAt: new Date().toISOString(),
        likes: 0,
        comments: [],
      };
      
      await put("posts", post);
      toast.success("Post created!");
      navigate("/");
    } catch (error) {
      toast.error("Failed to create post");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilesReady = (manifests: Manifest[]) => {
    setAttachedManifests(prev => [...prev, ...manifests]);
  };

  const removeAttachment = (fileId: string) => {
    setAttachedManifests(prev => prev.filter(m => m.fileId !== fileId));
  };
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <TopNavigationBar />
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Create Post</h1>
          
          <form onSubmit={handleSubmit}>
            <Card className="p-6 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="content">What's on your mind?</Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Share your thoughts..."
                  className="min-h-[200px]"
                />
              </div>
              
              {/* Attached files */}
              {attachedManifests.length > 0 && (
                <div className="space-y-2">
                  <Label>Attachments</Label>
                  <div className="flex flex-wrap gap-2">
                    {attachedManifests.map(manifest => (
                      <div
                        key={manifest.fileId}
                        className="flex items-center gap-2 bg-secondary px-3 py-2 rounded-md text-sm"
                      >
                        <span className="truncate max-w-[200px]">{manifest.originalName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0"
                          onClick={() => removeAttachment(manifest.fileId)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File upload section */}
              {showFileUpload ? (
                <FileUpload
                  onFilesReady={handleFilesReady}
                  maxFiles={10}
                  maxFileSize={100 * 1024 * 1024}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFileUpload(true)}
                >
                  Attach Files
                </Button>
              )}
              
              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="gradient-primary shadow-glow"
                  disabled={loading || !content.trim()}
                >
                  {loading ? "Publishing..." : "Publish"}
                </Button>
              </div>
            </Card>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Create;