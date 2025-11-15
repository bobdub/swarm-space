import { TopNavigationBar } from "@/components/TopNavigationBar";
import { HeroSection } from "@/components/HeroSection";
import { FeatureHighlights } from "@/components/FeatureHighlights";
import { PostCard } from "@/components/PostCard";
import { Post } from "@/types";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchHomeFeed,
  loadStoredFeedFilter,
  persistFeedFilter,
  type FeedFilter,
} from "@/lib/feed";

export default function Index() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FeedFilter>(() => loadStoredFeedFilter());
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: posts = [], isLoading, isFetching } = useQuery({
    queryKey: ["home-feed", { filter }],
    queryFn: () => fetchHomeFeed(filter),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!user && filter !== "all") {
      setFilter("all");
      return;
    }

    persistFeedFilter(filter);
  }, [filter, user]);

  useEffect(() => {
    const invalidateFeed = () => {
      queryClient.invalidateQueries({ queryKey: ["home-feed"] });
    };

    window.addEventListener("p2p-posts-updated", invalidateFeed);
    window.addEventListener("entanglements-updated", invalidateFeed as EventListener);
    window.addEventListener("user-login", invalidateFeed);
    window.addEventListener("user-logout", invalidateFeed);

    return () => {
      window.removeEventListener("p2p-posts-updated", invalidateFeed);
      window.removeEventListener("entanglements-updated", invalidateFeed as EventListener);
      window.removeEventListener("user-login", invalidateFeed);
      window.removeEventListener("user-logout", invalidateFeed);
    };
  }, [queryClient]);

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["home-feed"] });
  }, [queryClient, user?.id]);

  const previewPosts = useMemo<Post[]>(() => posts.slice(0, 3), [posts]);

  const emptyStateMessage = useMemo(() => {
    if (filter === "following") {
      return user
        ? "Entangle with creators to fill your Following feed."
        : "Sign in to follow creators and unlock this feed.";
    }
    if (filter === "local") {
      return user
        ? "Create something new to see it appear in your Local feed."
        : "Sign in to view posts stored on this device.";
    }
    return "No posts have been published yet. Be the first to share!";
  }, [filter, user]);

  const handleFilterChange = (value: string) => {
    if (value === "all" || value === "following" || value === "local") {
      setFilter(value);
    }
  };

  const showInitialLoading = isLoading && posts.length === 0;
  const isRefreshing = isFetching && !isLoading;

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <TopNavigationBar />

      {/* Hero Section */}
      <HeroSection />

      {/* Feature Highlights */}
      <FeatureHighlights />

      {/* Recent Posts Preview */}
      <div className="px-6 py-16 md:py-24 bg-gradient-to-b from-transparent via-primary/5 to-transparent">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
            <div>
              <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2">
                Recent Activity
              </h2>
              <p className="text-foreground/60">
                See what the community is creating
              </p>
            </div>
            <Link to={user ? "/profile?tab=posts&composer=open" : "/auth?redirect=/profile?tab=posts&composer=open"}>
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Create Post
              </Button>
            </Link>
          </div>

          <Tabs value={filter} onValueChange={handleFilterChange} className="w-full">
            <div className="flex justify-center">
              <TabsList className="grid w-full max-w-md grid-cols-3 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="following" disabled={!user}>
                  Following
                </TabsTrigger>
                <TabsTrigger value="local" disabled={!user}>
                  Local
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <div className="space-y-6 animate-fade-in">
            {showInitialLoading ? (
              <div className="text-center text-foreground/60">Loading feed…</div>
            ) : previewPosts.length === 0 ? (
              <div className="text-center text-foreground/60">{emptyStateMessage}</div>
            ) : (
              previewPosts.map((post, index) => (
                <div
                  key={post.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <PostCard post={post} />
                </div>
              ))
            )}
            {isRefreshing && !showInitialLoading ? (
              <div className="text-center text-xs text-foreground/50">Refreshing…</div>
            ) : null}
          </div>

          <div className="text-center animate-fade-in">
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

      {/* Footer CTA */}
      <div className="px-6 py-16 text-center">
        <div className="max-w-2xl mx-auto animate-fade-in">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-4 text-foreground">
            Ready to take control of your data?
          </h2>
          <p className="text-foreground/60 mb-8">
            Join the decentralized revolution. No servers, no tracking, just you and your creativity.
          </p>
          <Link to={user ? "/profile?tab=posts&composer=open" : "/auth?redirect=/profile?tab=posts&composer=open"}>
            <Button
              size="lg"
              className="bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_30px_hsla(326,71%,62%,0.5)]"
            >
              {user ? "Start Creating Now" : "Get Started"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
