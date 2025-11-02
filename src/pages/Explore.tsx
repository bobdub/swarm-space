import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, FolderOpen, TrendingUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Project } from "@/types";
import { searchPublicProjects } from "@/lib/projects";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { Avatar } from "@/components/Avatar";
import { ConnectedPeersPanel } from "@/components/ConnectedPeersPanel";
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    void loadProjects(filters);
  }, [filters, loadProjects]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleProjectsUpdated = () => {
      void loadProjects(filtersRef.current);
    };

    window.addEventListener("p2p-projects-updated", handleProjectsUpdated);
    return () => {
      window.removeEventListener("p2p-projects-updated", handleProjectsUpdated);
    };
  }, [loadProjects]);

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
          <CreateProjectModal onProjectCreated={() => void loadProjects(filters)} />
        </header>
        <section className="space-y-6">
          {/* P2P Network Status */}
          <ConnectedPeersPanel />

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
          <Tabs defaultValue="projects" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 bg-[hsla(245,70%,8%,0.6)] border border-[hsla(174,59%,56%,0.2)]">
              <TabsTrigger value="projects" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                Projects
              </TabsTrigger>
              <TabsTrigger value="people" className="gap-2">
                <Users className="h-4 w-4" />
                People
              </TabsTrigger>
              <TabsTrigger value="trending" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Trending
              </TabsTrigger>
            </TabsList>

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

            <TabsContent value="trending" className="space-y-6">
              <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                <p className="text-foreground/60">Trending content coming soon</p>
                <p className="text-sm text-foreground/40 mt-2">
                  Discover what's hot right now
                </p>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
};

// Project card component
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