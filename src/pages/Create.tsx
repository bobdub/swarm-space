import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/FileUpload";
import { useState, useEffect } from "react";
import { getCurrentUser } from "@/lib/auth";
import { put } from "@/lib/store";
import { Post, Project } from "@/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Manifest } from "@/lib/fileEncryption";
import { X, FolderOpen } from "lucide-react";
import { getUserProjects, addPostToProject } from "@/lib/projects";
import { awardPostCredits } from "@/lib/credits";

const Create = () => {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [attachedManifests, setAttachedManifests] = useState<Manifest[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [userProjects, setUserProjects] = useState<Project[]>([]);
  const user = getCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    loadUserProjects();
  }, []);

  const loadUserProjects = async () => {
    const projects = await getUserProjects();
    setUserProjects(projects);
  };
  
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
        projectId: selectedProjectId || null,
        type: postType,
        content: content.trim(),
        manifestIds,
        createdAt: new Date().toISOString(),
        likes: 0,
        comments: [],
      };
      
      await put("posts", post);

      // Add to project feed if selected
      if (selectedProjectId) {
        await addPostToProject(selectedProjectId, post.id);
      }

      // Award credits for posting
      await awardPostCredits(post.id, user.id);

      toast.success("Post created! +10 credits earned");
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
            <Card className="p-6 space-y-6 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] backdrop-blur-xl">
              <div className="space-y-2">
                <Label htmlFor="content" className="text-sm font-semibold uppercase tracking-wider">
                  What's on your mind?
                </Label>
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Share your thoughts..."
                  className="min-h-[200px] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)]"
                />
              </div>

              {/* Project selector */}
              {userProjects.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="project" className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Add to Project (Optional)
                  </Label>
                  <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                    <SelectTrigger className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)]">
                      <SelectValue placeholder="Select a project..." />
                    </SelectTrigger>
                    <SelectContent className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-xl">
                      <SelectItem value="none">None (Personal Feed)</SelectItem>
                      {userProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedProjectId && selectedProjectId !== "none" && (
                    <p className="text-xs text-foreground/60">
                      This post will appear in the project feed and your personal feed
                    </p>
                  )}
                </div>
              )}
              
              {/* Attached files */}
              {attachedManifests.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold uppercase tracking-wider">Attachments</Label>
                  <div className="flex flex-wrap gap-2">
                    {attachedManifests.map(manifest => (
                      <div
                        key={manifest.fileId}
                        className="flex items-center gap-2 bg-[hsla(245,70%,12%,0.6)] border border-[hsla(174,59%,56%,0.2)] px-3 py-2 rounded-md text-sm"
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
                  className="border-[hsla(174,59%,56%,0.2)]"
                >
                  Attach Files
                </Button>
              )}
              
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/")}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !content.trim()}
                  className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
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