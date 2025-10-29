import { useEffect, useMemo, useState, useCallback } from "react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { getAll } from "@/lib/store";
import type { Post } from "@/types";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getBlockedUserIds } from "@/lib/connections";
import { getHiddenPostIds } from "@/lib/hiddenPosts";

const MAX_TRENDING_ITEMS = 10;

const Trending = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const allPosts = await getAll<Post>("posts");
      let blockedIds: string[] = [];
      let hiddenIds: string[] = [];

      if (user) {
        [blockedIds, hiddenIds] = await Promise.all([
          getBlockedUserIds(user.id),
          getHiddenPostIds(user.id),
        ]);
      }

      const visiblePosts = allPosts.filter((post) => {
        if (blockedIds.includes(post.author)) {
          return false;
        }
        if (hiddenIds.includes(post.id)) {
          return false;
        }
        return true;
      });

      setPosts(visiblePosts);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadPosts();

    const handleSync = () => {
      void loadPosts();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, [loadPosts]);

  const trendingPosts = useMemo(() => {
    if (!posts.length) return [];
    return [...posts]
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, MAX_TRENDING_ITEMS);
  }, [posts]);

  const trendingVideos = useMemo(() => {
    const videos = posts.filter((post) => post.type === "video");
    if (!videos.length) return [];
    return [...videos]
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, MAX_TRENDING_ITEMS);
  }, [posts]);

  const handleExploreClick = () => {
    navigate("/explore");
  };

  const renderPostList = (items: Post[]) => {
    if (!items.length) {
      return (
        <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
          Nothing is trending yet. Check back soon!
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {items.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="space-y-4 text-center">
          <h1 className="text-3xl font-display font-bold uppercase tracking-[0.24em] text-foreground md:text-4xl">
            Trending Across the Mesh
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-foreground/70 md:text-base">
            Explore the most credited posts and high-energy videos lighting up your connected mesh. Tune your feed from the Home
            page to switch between global, following, or local perspectives.
          </p>
        </header>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-display uppercase tracking-[0.22em] text-foreground">Top Credited Posts</h2>
              <p className="text-sm text-foreground/60">The hottest creations shared in your network right now.</p>
            </div>
            <Button variant="ghost" className="text-primary" onClick={handleExploreClick}>
              Explore Creators →
            </Button>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
              Loading trending posts…
            </div>
          ) : (
            renderPostList(trendingPosts)
          )}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-display uppercase tracking-[0.22em] text-foreground">Mesh-Favorite Videos</h2>
              <p className="text-sm text-foreground/60">Pulse-check the most watched clips across your peers.</p>
            </div>
            <Button variant="ghost" className="text-primary" onClick={handleExploreClick}>
              Discover More →
            </Button>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
              Gathering video stats…
            </div>
          ) : (
            renderPostList(trendingVideos)
          )}
        </section>
      </main>
    </div>
  );
};

export default Trending;
