import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, FolderOpen, Loader2, Clock3, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Project, Post } from "@/types";
import { searchPublicProjects, filterPostsByProjectMembership } from "@/lib/projects";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { PostCard } from "@/components/PostCard";
import { getAll } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { getBlockedUserIds } from "@/lib/connections";
import { getHiddenPostIds } from "@/lib/hiddenPosts";
import { backfillPostMetrics, getPostMetricsMap } from "@/lib/postMetrics";
import type { PostMetrics } from "@/types";
import { rankTrendingPosts } from "../../services/trending";
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentPosts, setRecentPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [metricsByPost, setMetricsByPost] = useState<Map<string, PostMetrics>>(new Map());
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

  const loadRecentPosts = useCallback(async () => {
    setPostsLoading(true);
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
        if (post.type === "stream" && post.stream?.visibility && post.stream.visibility !== "public") {
          return false;
        }
        return !blockedIds.includes(post.author) && !hiddenIds.includes(post.id);
      });
      const membershipFiltered = await filterPostsByProjectMembership(visiblePosts, user?.id ?? null);
      const query = filtersRef.current.query.trim().toLowerCase();
      const filtered = query
        ? membershipFiltered.filter((post) => {
            const haystack = [post.content, post.authorName, ...(post.tags ?? [])]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return haystack.includes(query);
          })
        : membershipFiltered;

      setRecentPosts(
        [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      );
    } catch (error) {
      console.error("Failed to load recent posts:", error);
      setRecentPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadProjects(filters);
  }, [filters, loadProjects]);

  useEffect(() => {
    void loadRecentPosts();
  }, [filters.query, loadRecentPosts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const reload = () => {
      void loadProjects(filtersRef.current);
      void loadRecentPosts();
    };

    window.addEventListener("p2p-projects-updated", reload);
    window.addEventListener("p2p-posts-updated", reload);
    return () => {
      window.removeEventListener("p2p-projects-updated", reload);
      window.removeEventListener("p2p-posts-updated", reload);
    };
  }, [loadProjects, loadRecentPosts]);

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

  useEffect(() => {
    if (!recentPosts.length) {
      setMetricsByPost(new Map());
      return;
    }

    let cancelled = false;
    const loadMetrics = async () => {
      try {
        const postIds = recentPosts.map((post) => post.id);
        await backfillPostMetrics(postIds);
        const metrics = await getPostMetricsMap(postIds);
        if (!cancelled) {
          setMetricsByPost(metrics);
        }
      } catch (error) {
        console.error("Failed to load rolling metrics:", error);
        if (!cancelled) {
          setMetricsByPost(new Map());
        }
      }
    };

    void loadMetrics();
    return () => {
      cancelled = true;
    };
  }, [recentPosts]);

  const rollingPool = useMemo(() => {
    if (!recentPosts.length) {
      return [];
    }
    return rankTrendingPosts({ posts: recentPosts, metricsByPost }).slice(0, 10);
  }, [recentPosts, metricsByPost]);

  const [rollingPostId, setRollingPostId] = useState<string | null>(null);

  useEffect(() => {
    if (!rollingPool.length) {
      setRollingPostId(null);
      return;
    }

    const pickWeightedPost = () => {
      const useHypeDominantPick = Math.random() < 0.8;
      if (!useHypeDominantPick) {
        const randomIndex = Math.floor(Math.random() * rollingPool.length);
        setRollingPostId(rollingPool[randomIndex]?.post.id ?? rollingPool[0].post.id);
        return;
      }

      const totalWeight = rollingPool.reduce((sum, entry) => sum + Math.max(entry.score, 0.05) ** 2, 0);
      const random = Math.random() * totalWeight;
      let cursor = 0;
      for (const entry of rollingPool) {
        cursor += Math.max(entry.score, 0.05) ** 2;
        if (cursor >= random) {
          setRollingPostId(entry.post.id);
          return;
        }
      }

      setRollingPostId(rollingPool[0].post.id);
    };

    let timeoutId: number | null = null;

    const scheduleNextPick = () => {
      pickWeightedPost();
      const nextDelay = Math.max(3000, Math.floor(Math.random() * 50000 * 0.2));
      timeoutId = window.setTimeout(scheduleNextPick, nextDelay);
    };

    scheduleNextPick();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [rollingPool]);

  const rollingPost = useMemo(
    () => rollingPool.find((entry) => entry.post.id === rollingPostId) ?? rollingPool[0] ?? null,
    [rollingPool, rollingPostId],
  );

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="flex flex-col gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <h1 className="text-3xl font-bold font-display uppercase tracking-wider">Explore</h1>
          <CreateProjectModal onProjectCreated={() => void loadProjects(filters)} />
        </header>

        {rollingPost ? (
          <section className="space-y-4 overflow-hidden rounded-3xl border border-[hsla(174,59%,56%,0.3)] bg-[radial-gradient(circle_at_20%_20%,hsla(326,71%,62%,0.26),transparent_42%),linear-gradient(120deg,hsla(245,70%,10%,0.92),hsla(251,78%,6%,0.9))] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.24em] text-[hsl(174,59%,56%)]">
                <Sparkles className="h-3.5 w-3.5" />
                Trending
              </div>
              <span className="rounded-full border border-[hsla(174,59%,56%,0.45)] px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-[hsl(174,59%,56%)]">
                Hype {(rollingPost.score * 100).toFixed(1)}
              </span>
            </div>
            <PostCard post={rollingPost.post} />
          </section>
        ) : null}

        <section className="space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search projects, posts, and people..."
              className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.6)] pl-10"
              value={filters.query}
              onChange={(e) => handleQueryChange(e.target.value)}
            />
          </div>

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
        </section>

        <section className="space-y-6">
          <Tabs defaultValue="recent-posts" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 bg-[hsla(245,70%,8%,0.6)] border border-[hsla(174,59%,56%,0.2)]">
              <TabsTrigger value="recent-posts" className="gap-2">
                <Clock3 className="h-4 w-4" />
                Most Recent
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                Projects
              </TabsTrigger>
              <TabsTrigger value="people" className="gap-2">
                <Users className="h-4 w-4" />
                People
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
                  {recentPosts.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="projects" className="space-y-6">
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
