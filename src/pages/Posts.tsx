import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { getAll } from "@/lib/store";
import { Post } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { getBlockedUserIds } from "@/lib/connections";

export default function Posts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const { user } = useAuth();

  const loadPosts = useCallback(async () => {
    setIsLoading(true);
    const allPosts = await getAll<Post>("posts");
    const blockedIds = user ? await getBlockedUserIds(user.id) : [];
    setBlockedUserIds(blockedIds);
    const visiblePosts = blockedIds.length
      ? allPosts.filter((post) => !blockedIds.includes(post.author))
      : allPosts;
    const sorted = [...visiblePosts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setPosts(sorted);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    void loadPosts();

    const handleSync = () => {
      void loadPosts();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, [loadPosts]);

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="px-6 py-12">
        <div className="max-w-4xl mx-auto space-y-12">
          <header className="space-y-3 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
              Community Posts
            </h1>
            <p className="text-foreground/60">
              Browse the full history of creations shared across the network.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/create">
                <Button size="sm" className="bg-gradient-to-r from-primary to-secondary">
                  Share Something New
                </Button>
              </Link>
            </div>
          </header>

          {isLoading ? (
            <div className="text-center text-foreground/60">Loading posts…</div>
          ) : posts.length === 0 ? (
            <div className="text-center text-foreground/60">
              {blockedUserIds.length > 0
                ? "No visible posts. Adjust your block list to see more content."
                : "No posts have been published yet. Be the first to share!"}
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
