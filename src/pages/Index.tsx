import { TopNavigationBar } from "@/components/TopNavigationBar";
import { HeroSection } from "@/components/HeroSection";
import { FeatureHighlights } from "@/components/FeatureHighlights";
import { PostCard } from "@/components/PostCard";
import { getAll } from "@/lib/store";
import { Post } from "@/types";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

export default function Index() {
  const [posts, setPosts] = useState<Post[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadPosts();

    const handleSync = () => {
      loadPosts();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, []);

  const loadPosts = async () => {
    const allPosts = await getAll<Post>("posts");
    // Sort by createdAt descending, take top 3 for preview
    const sorted = allPosts
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
    setPosts(sorted);
  };

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <TopNavigationBar />

      {/* Hero Section */}
      <HeroSection />

      {/* Feature Highlights */}
      <FeatureHighlights />

      {/* Recent Posts Preview */}
      {posts.length > 0 && (
        <div className="px-6 py-16 md:py-24 bg-gradient-to-b from-transparent via-primary/5 to-transparent">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8 animate-fade-in">
              <div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2">
                  Recent Activity
                </h2>
                <p className="text-foreground/60">
                  See what the community is creating
                </p>
              </div>
              <Link to="/profile?tab=posts&composer=open">
                <Button size="sm" variant="outline" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Post
                </Button>
              </Link>
            </div>
            
            <div className="space-y-6">
              {posts.map((post, index) => (
                <div 
                  key={post.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <PostCard post={post} />
                </div>
              ))}
            </div>

            <div className="text-center mt-8 animate-fade-in">
              <Button
                variant="ghost"
                className="text-primary hover:text-primary/80"
                onClick={() => navigate("/posts")}
              >
                View All Posts →
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Footer CTA */}
      <div className="px-6 py-16 text-center">
        <div className="max-w-2xl mx-auto animate-fade-in">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-4 text-foreground">
            Ready to take control of your data?
          </h2>
          <p className="text-foreground/60 mb-8">
            Join the decentralized revolution. No servers, no tracking, just you and your creativity.
          </p>
          <Link to="/profile?tab=posts&composer=open">
            <Button
              size="lg"
              className="bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_30px_hsla(326,71%,62%,0.5)]"
            >
              Start Creating Now
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
