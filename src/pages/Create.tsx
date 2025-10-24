import { Navigation } from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Image, Video, FileText } from "lucide-react";
import { useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { put } from "@/lib/store";
import { Post } from "@/types";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const Create = () => {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const user = getCurrentUser();
  const navigate = useNavigate();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !content.trim()) return;
    
    setLoading(true);
    try {
      const post: Post = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: user.id,
        authorName: user.displayName || user.username,
        type: "text",
        content: content.trim(),
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
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
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
              
              <div className="flex items-center gap-4">
                <Button type="button" variant="outline" size="sm" className="gap-2">
                  <Image className="w-4 h-4" />
                  Image
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-2">
                  <Video className="w-4 h-4" />
                  Video
                </Button>
                <Button type="button" variant="outline" size="sm" className="gap-2">
                  <FileText className="w-4 h-4" />
                  File
                </Button>
              </div>
              
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