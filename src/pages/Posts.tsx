import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { getAll } from "@/lib/store";
import { Post } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { getBlockedUserIds } from "@/lib/connections";
import { getHiddenPostIds } from "@/lib/hiddenPosts";
import { getEntangledUserIds } from "@/lib/entanglements";
import { filterPostsByProjectMembership } from "@/lib/projects";

export default function Posts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const [entangledUserIds, setEntangledUserIds] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<"all" | "entangled">("all");
  const { user } = useAuth();

  const loadPosts = useCallback(async () => {
    setIsLoading(true);
    const allPosts = await getAll<Post>("posts");
    let blockedIds: string[] = [];
    let hiddenIds: string[] = [];
    let entangledIds: string[] = [];

    if (user) {
      [blockedIds, hiddenIds, entangledIds] = await Promise.all([
        getBlockedUserIds(user.id),
        getHiddenPostIds(user.id),
        getEntangledUserIds(user.id),
      ]);
    }

    setBlockedUserIds(blockedIds);
    setHiddenPostIds(hiddenIds);
    setEntangledUserIds(entangledIds);

    const visiblePosts = allPosts.filter((post) => {
      if (blockedIds.includes(post.author)) {
        return false;
      }
      if (hiddenIds.includes(post.id)) {
        return false;
      }
      return true;
    });
    const membershipFiltered = await filterPostsByProjectMembership(visiblePosts, user?.id ?? null);
    const sorted = [...membershipFiltered].sort(
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

    const handleEntanglementsChange = () => {
      void loadPosts();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    window.addEventListener("entanglements-updated", handleEntanglementsChange as EventListener);
    return () => {
      window.removeEventListener("p2p-posts-updated", handleSync);
      window.removeEventListener("entanglements-updated", handleEntanglementsChange as EventListener);
    };
  }, [loadPosts]);

  const filteredPosts = useMemo(() => {
    if (filterMode === "entangled") {
      if (!user) {
        return [];
      }
      const allowed = new Set(entangledUserIds.concat(user.id));
      return posts.filter((post) => allowed.has(post.author));
    }
    return posts;
  }, [entangledUserIds, filterMode, posts, user]);

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
              <Link to="/profile?tab=posts&composer=open">
                <Button size="sm" className="bg-gradient-to-r from-primary to-secondary">
                  Share Something New
                </Button>
              </Link>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button
                size="sm"
                variant={filterMode === "all" ? "default" : "outline"}
                onClick={() => setFilterMode("all")}
                className="min-w-[8rem]"
              >
                All Posts
              </Button>
              <Button
                size="sm"
                variant={filterMode === "entangled" ? "default" : "outline"}
                onClick={() => setFilterMode("entangled")}
                disabled={!user}
                className="min-w-[8rem]"
              >
                Entangled
              </Button>
            </div>
          </header>

          {isLoading ? (
            <div className="text-center text-foreground/60">Loading posts…</div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-center text-foreground/60">
              {filterMode === "entangled"
                ? entangledUserIds.length === 0
                  ? "You haven't entangled with any creators yet. Visit a profile and tap Entangle to tune this feed."
                  : "No recent posts from your entangled creators. Try checking back later or switch to All Posts."
                : blockedUserIds.length > 0 || hiddenPostIds.length > 0
                  ? "No visible posts. Adjust your filters to see more content."
                  : "No posts have been published yet. Be the first to share!"}
            </div>
          ) : (
            <div className="space-y-6">
              {filteredPosts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
