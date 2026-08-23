import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, FolderOpen, TrendingUp, Loader2, Clock3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Project, Post } from "@/types";
import { searchPublicProjects, filterPostsByProjectMembership } from "@/lib/projects";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { PostCard } from "@/components/PostCard";
import { BlogPostCard } from "@/components/BlogPostCard";
import { classifyPost } from "@/lib/blogging/awareness";
import { getAll } from "@/lib/store";
import { getPostsNewerThan } from "@/lib/posts";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getBlockedUserIds } from "@/lib/connections";
import { getHiddenPostIds } from "@/lib/hiddenPosts";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { rankTrendingPosts } from "../../services/trending";
import { getPostMetricsMap } from "@/lib/postMetrics";
import type { PostMetrics } from "@/types";
import {
  ACTIVITY_OPTIONS,
  POPULARITY_OPTIONS,
  createInitialFilters,
  deriveNextFilters,
  filtersEqual,
  toggleTagFilter,
  type ExploreFilters,
} from "./explore/filterState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const Explore = () => {
  const { user } = useAuth();
  const { isEnabled: p2pEnabled, stats: p2pStats } = useP2PContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [postMetricsMap, setPostMetricsMap] = useState<Map<string, PostMetrics>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [filters, setFilters] = useState<ExploreFilters>(() => createInitialFilters());

  const updateFilters = useCallback((updater: (prev: ExploreFilters) => ExploreFilters) => {
    setFilters((prev) => {
      const next = updater(prev);
      return filtersEqual(prev, next) ? prev : next;
    });
  }, []);

  const activeRequestRef = useRef(0);
  const filtersRef = useRef(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const loadProjects = useCallback(
    async (state: ExploreFilters) => {
      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await searchPublicProjects(state);
        if (activeRequestRef.current !== requestId) {
          return;
        }
        setProjects(result.items);
        setAvailableTags(result.availableTags);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        if (result.page !== state.page) {
          setFilters((prev) => (prev.page === result.page ? prev : { ...prev, page: result.page }));
        }
      } catch (error) {
        if (activeRequestRef.current !== requestId) {
          return;
        }
        console.error("Failed to load projects:", error);
        setProjects([]);
        setAvailableTags([]);
        setTotal(0);
        setTotalPages(0);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load projects");
      } finally {
        if (activeRequestRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  const postsLoadingRef = useRef(false);
  const newestLoadedAtRef = useRef<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const applyPostFilters = useCallback(
    async (input: Post[], blockedIds: string[], hiddenIds: string[]): Promise<Post[]> => {
      const visible = input.filter((post) => {
        if (post.type === "stream" && post.stream?.visibility && post.stream.visibility !== "public") {
          return false;
        }
        return !blockedIds.includes(post.author) && !hiddenIds.includes(post.id);
      });
      const membershipFiltered = await filterPostsByProjectMembership(visible, user?.id ?? null);
      const query = filtersRef.current.query.trim().toLowerCase();
      if (!query) return membershipFiltered;
      return membershipFiltered.filter((post) => {
        const haystack = [post.content, post.authorName, ...(post.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    },
    [user],
  );

  const loadRecentPosts = useCallback(async (background = false) => {
    // Skip concurrent loads to reduce IndexedDB strain
    if (postsLoadingRef.current && background) return;
    postsLoadingRef.current = true;
    if (!background) setPostsLoading(true);
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

      const filtered = await applyPostFilters(allPosts, blockedIds, hiddenIds);
      const sorted = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Refresh incremental-merge cursors so subsequent P2P deltas only add new rows.
      knownIdsRef.current = new Set(sorted.map((p) => p.id));
      newestLoadedAtRef.current = sorted.length > 0 ? sorted[0].createdAt : null;

      // Stable merge: only update state if posts actually changed
      setRecentPosts((prev) => {
        if (prev.length !== sorted.length) return sorted;
        // Quick check: compare IDs in order
        for (let i = 0; i < sorted.length; i++) {
          if (prev[i].id !== sorted[i].id || prev[i].commentCount !== sorted[i].commentCount || prev[i].editedAt !== sorted[i].editedAt) {
            return sorted;
          }
        }
        return prev; // No change — keep same reference
      });

      // Hydrate post metrics so Trending can rank by hype/credit/views
      // (Phase A — pipes profile-token hype into the Trending sort).
      try {
        const metricsMap = await getPostMetricsMap(sorted.map((p) => p.id));
        setPostMetricsMap(metricsMap);
      } catch (err) {
        console.warn("[Explore] Failed to load post metrics:", err);
      }
    } catch (error) {
      console.error("Failed to load recent posts:", error);
      setRecentPosts([]);
    } finally {
      setPostsLoading(false);
      postsLoadingRef.current = false;
    }
  }, [user, applyPostFilters]);

  // Incremental merge — only pull rows newer than what we've already rendered
  // and prepend them so existing PostCard/BlogPostCard instances keep their
  // DOM identity. No metrics refetch for IDs already hydrated.
  const mergeIncomingPosts = useCallback(async () => {
    if (postsLoadingRef.current) return;
    try {
      const fresh = await getPostsNewerThan(newestLoadedAtRef.current);
      const unseen = fresh.filter((p) => !knownIdsRef.current.has(p.id));
      if (unseen.length === 0) return;

      let blockedIds: string[] = [];
      let hiddenIds: string[] = [];
      if (user) {
        [blockedIds, hiddenIds] = await Promise.all([
          getBlockedUserIds(user.id),
          getHiddenPostIds(user.id),
        ]);
      }

      const filtered = await applyPostFilters(unseen, blockedIds, hiddenIds);
      if (filtered.length === 0) return;
      const sortedNew = [...filtered].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      for (const p of sortedNew) knownIdsRef.current.add(p.id);
      newestLoadedAtRef.current = sortedNew[0].createdAt;

      setRecentPosts((prev) => [...sortedNew, ...prev]);

      // Only hydrate metrics for IDs we haven't seen yet.
      try {
        const missing = sortedNew.map((p) => p.id).filter((id) => !postMetricsMap.has(id));
        if (missing.length > 0) {
          const added = await getPostMetricsMap(missing);
          if (added.size > 0) {
            setPostMetricsMap((prev) => {
              const next = new Map(prev);
              added.forEach((v, k) => next.set(k, v));
              return next;
            });
          }
        }
      } catch (err) {
        console.warn("[Explore] Failed to hydrate metrics for new posts:", err);
      }
    } catch (error) {
      console.warn("[Explore] Incremental merge failed:", error);
    }
  }, [user, applyPostFilters, postMetricsMap]);

  // Defer initial loads to idle so the route paints its shell first
  // and the Brain → Explore handoff doesn't slam IndexedDB on mount.
  // Subsequent filter changes load synchronously (user is already here).
  const didInitialLoadRef = useRef(false);
  useEffect(() => {
    if (!didInitialLoadRef.current) {
      didInitialLoadRef.current = true;
      const w = typeof window !== "undefined" ? (window as any) : null;
      const schedule = w && typeof w.requestIdleCallback === "function"
        ? (cb: () => void) => w.requestIdleCallback(cb, { timeout: 1500 })
        : (cb: () => void) => setTimeout(cb, 250);
      schedule(() => { void loadProjects(filtersRef.current); });
      schedule(() => { void loadRecentPosts(); });
      return;
    }
    void loadProjects(filters);
  }, [filters, loadProjects, loadRecentPosts]);

  useEffect(() => {
    if (!didInitialLoadRef.current) return; // initial fetch handled above
    void loadRecentPosts();
  }, [filters.query, loadRecentPosts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      // Only react when the mesh is actually delivering new content. When
      // offline, local writes update state directly via composer flows —
      // there's no reason to re-scan IndexedDB.
      if (!p2pEnabled || p2pStats.connectedPeers <= 0) return;
      // Debounce rapid-fire events (e.g. comment/react triggers store write → event)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void loadProjects(filtersRef.current);
        void mergeIncomingPosts();
      }, 3000);
    };

    window.addEventListener("p2p-projects-updated", reload);
    window.addEventListener("p2p-posts-updated", reload);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("p2p-projects-updated", reload);
      window.removeEventListener("p2p-posts-updated", reload);
    };
  }, [loadProjects, mergeIncomingPosts, p2pEnabled, p2pStats.connectedPeers]);

  const handleQueryChange = useCallback(
    (value: string) => {
      updateFilters((prev) => (prev.query === value ? prev : deriveNextFilters(prev, { query: value })));
    },
    [updateFilters],
  );

  const handlePopularityChange = useCallback(
    (value: string) => {
      updateFilters((prev) =>
        prev.popularity === value
          ? prev
          : deriveNextFilters(prev, { popularity: value as typeof prev.popularity }),
      );
    },
    [updateFilters],
  );

  const handleActivityChange = useCallback(
    (value: string) => {
      updateFilters((prev) =>
        prev.activity === value
          ? prev
          : deriveNextFilters(prev, { activity: value as typeof prev.activity }),
      );
    },
    [updateFilters],
  );

  const handleTagToggle = useCallback(
    (tag: string | null) => {
      updateFilters((prev) => {
        const next = toggleTagFilter(prev, tag);
        return filtersEqual(prev, next) ? prev : next;
      });
    },
    [updateFilters],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      updateFilters((prev) => (prev.page === page ? prev : deriveNextFilters(prev, { page })));
    },
    [updateFilters],
  );

  const resultSummary = useMemo(() => {
    if (!total) {
      return "Showing 0 results";
    }
    const start = (filters.page - 1) * filters.pageSize + 1;
    const end = Math.min(start + filters.pageSize - 1, total);
    return `Showing ${start}-${end} of ${total} projects`;
  }, [filters.page, filters.pageSize, total]);

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="flex flex-col gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <h1 className="text-3xl font-bold font-display uppercase tracking-wider">Explore</h1>
          <div className="flex items-center gap-2">

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="border-[hsla(174,59%,56%,0.2)]">
                  <Search className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <Input
                  placeholder="Search projects, posts, and people..."
                  className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.6)]"
                  value={filters.query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </header>
        <section className="space-y-6">
          <Tabs defaultValue="recent-posts" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 bg-[hsla(245,70%,8%,0.6)] border border-[hsla(174,59%,56%,0.2)]">
              <TabsTrigger value="recent-posts" className="gap-2">
                <Clock3 className="h-4 w-4" />
                Most Recent
              </TabsTrigger>
              <TabsTrigger value="trending" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Trending
              </TabsTrigger>
              <TabsTrigger value="people" className="gap-2">
                <Users className="h-4 w-4" />
                People
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                Projects
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recent-posts" className="space-y-6">
              {postsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
                </div>
              ) : recentPosts.length === 0 ? (
                <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                  <Clock3 className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                  <p className="text-foreground/60">No recent posts match your current filters.</p>
                  <p className="text-sm text-foreground/40 mt-2">Try a broader search or come back when the mesh has synced more content.</p>
                </Card>
              ) : (
                <div className="space-y-6">
                  {recentPosts.map((post) => {
                    const { classification } = classifyPost(post);
                    const isBlog = classification === "blog" || classification === "book";
                    return isBlog
                      ? <BlogPostCard key={post.id} post={post} />
                      : <PostCard key={post.id} post={post} />;
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="projects" className="space-y-6">
              <div className="flex justify-end">
                <CreateProjectModal onProjectCreated={() => void loadProjects(filters)} />
              </div>
              {/* Project filters */}

              <div className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.45)] p-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Popularity</p>
                    <Select value={filters.popularity} onValueChange={handlePopularityChange}>
                      <SelectTrigger className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.35)]">
                        <SelectValue placeholder="Popularity" />
                      </SelectTrigger>
                      <SelectContent className="bg-[hsla(245,70%,8%,0.95)] text-foreground">
                        {POPULARITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Activity</p>
                    <Select value={filters.activity} onValueChange={handleActivityChange}>
                      <SelectTrigger className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.35)]">
                        <SelectValue placeholder="Activity" />
                      </SelectTrigger>
                      <SelectContent className="bg-[hsla(245,70%,8%,0.95)] text-foreground">
                        {ACTIVITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Tag</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant={filters.tag === null ? "default" : "outline"}
                        size="sm"
                        className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.35)] hover:bg-[hsla(326,71%,62%,0.2)]"
                        onClick={() => handleTagToggle(null)}
                      >
                        All tags
                      </Button>
                      {availableTags.length === 0 ? (
                        <span className="text-xs text-foreground/50">No tags yet</span>
                      ) : (
                        availableTags.map((tag) => (
                          <Button
                            key={tag}
                            variant={filters.tag?.toLowerCase() === tag.toLowerCase() ? "default" : "outline"}
                            size="sm"
                            className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.35)] hover:bg-[hsla(326,71%,62%,0.2)]"
                            onClick={() => handleTagToggle(tag)}
                          >
                            {tag}
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-foreground/60">{resultSummary}</p>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
                </div>
              ) : errorMessage ? (
                <Card className="p-12 text-center border-[hsla(326,71%,62%,0.35)] bg-[hsla(245,70%,8%,0.4)]">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 text-[hsl(326,71%,62%)] opacity-50" />
                  <p className="text-foreground/60">{errorMessage}</p>
                  <p className="text-sm text-foreground/40 mt-2">Please try refreshing your filters.</p>
                </Card>
              ) : projects.length === 0 ? (
                <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                  <p className="text-foreground/60">
                    {filters.query || filters.tag
                      ? "No projects found matching your filters"
                      : "No public projects yet"}
                  </p>
                  <p className="text-sm text-foreground/40 mt-2">Be the first to create a project!</p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <Pagination className="pt-2">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (filters.page > 1) {
                            handlePageChange(filters.page - 1);
                          }
                        }}
                        className="border border-transparent"
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-4 text-sm text-foreground/70">Page {filters.page}</span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (filters.page < totalPages) {
                            handlePageChange(filters.page + 1);
                          }
                        }}
                        className="border border-transparent"
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </TabsContent>

            <TabsContent value="people" className="space-y-6">
              <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <Users className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                <p className="text-foreground/60">User discovery coming soon</p>
                <p className="text-sm text-foreground/40 mt-2">
                  Find and connect with other users
                </p>
              </Card>
            </TabsContent>

            <TabsContent value="trending" className="space-y-6">
              {postsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
                </div>
              ) : (() => {
                const ranked = rankTrendingPosts({
                  posts: recentPosts,
                  metricsByPost: postMetricsMap,
                });
                return ranked.length === 0 ? (
                  <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                    <TrendingUp className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                    <p className="text-foreground/60">No trending content yet</p>
                    <p className="text-sm text-foreground/40 mt-2">Posts will rank here based on engagement, credits, and views.</p>
                  </Card>
                ) : (
                  <div className="space-y-6">
                    {ranked.map(({ post, breakdown }) => {
                      const { classification } = classifyPost(post);
                      const isBlog = classification === "blog" || classification === "book";
                      const hypeRaw = breakdown.raw.creditTotal;
                      return isBlog
                        ? (
                          <div key={post.id} className="space-y-1">
                            {hypeRaw > 0 && (
                              <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-[hsl(326,71%,62%)]">
                                🔥 hyped · {Math.round(hypeRaw)} load
                              </div>
                            )}
                            <BlogPostCard post={post} />
                          </div>
                        )
                        : (
                          <div key={post.id} className="space-y-1">
                            {hypeRaw > 0 && (
                              <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-[hsl(326,71%,62%)]">
                                🔥 hyped · {Math.round(hypeRaw)} load
                              </div>
                            )}
                            <PostCard post={post} />
                          </div>
                        );
                    })}
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
};

function ProjectCard({ project }: { project: Project }) {
  const summary = project.profile?.bio ?? project.description;
  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="group p-6 cursor-pointer transition-all duration-300 hover:border-[hsla(326,71%,62%,0.35)] hover:shadow-[0_0_40px_hsla(326,71%,62%,0.25)] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)] h-full">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1 group-hover:text-[hsl(326,71%,62%)] transition-colors line-clamp-1">
                {project.name}
              </h3>
              <p className="text-sm text-foreground/60 line-clamp-2 min-h-[2.5rem]">
                {summary || "No bio yet"}
              </p>
              {project.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {project.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.4)] px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-foreground/60"
                    >
                      {tag}
                    </span>
                  ))}
                  {project.tags.length > 4 ? (
                    <span className="text-[0.65rem] text-foreground/50">+{project.tags.length - 4}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-foreground/50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>{project.members.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <FolderOpen className="h-3 w-3" />
                <span>{project.feedIndex.length}</span>
              </div>
            </div>
            <div className="px-2 py-1 rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.4)] uppercase tracking-wider">
              {project.settings?.visibility || "public"}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default Explore;
