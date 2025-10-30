import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search as SearchIcon, FileText, Users, FolderOpen, Loader2 } from "lucide-react";
import { searchAll, SearchResult } from "@/lib/search";
import { Avatar } from "@/components/Avatar";
import { Post, User as UserType, Project } from "@/types";

const Search = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setQuery(q);
      performSearch(q);
    }
  }, [searchParams]);

  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const searchResults = await searchAll(searchQuery);
      setResults(searchResults);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query.trim() });
    }
  };

  const filteredResults =
    activeTab === "all"
      ? results
      : results.filter((r) => r.type === activeTab);

  const postResults = results.filter((r) => r.type === "post");
  const userResults = results.filter((r) => r.type === "user");
  const projectResults = results.filter((r) => r.type === "project");

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="max-w-5xl mx-auto px-3 md:px-6 pb-6 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold font-display uppercase tracking-wider">Search</h1>
            <p className="text-foreground/60">
              Find posts, users, and projects across the network
            </p>
          </div>

          {/* Search Input */}
          <form onSubmit={handleSearch}>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/50" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for anything..."
                className="pl-10 h-12 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] text-lg"
                autoFocus
              />
            </div>
          </form>

          {/* Results */}
          {query && (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="grid w-full grid-cols-4 bg-[hsla(245,70%,8%,0.6)] border border-[hsla(174,59%,56%,0.2)]">
                <TabsTrigger value="all" className="gap-2">
                  All
                  {results.length > 0 && (
                    <span className="text-xs">({results.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="post" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Posts
                  {postResults.length > 0 && (
                    <span className="text-xs">({postResults.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="user" className="gap-2">
                  <Users className="h-4 w-4" />
                  Users
                  {userResults.length > 0 && (
                    <span className="text-xs">({userResults.length})</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="project" className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  Projects
                  {projectResults.length > 0 && (
                    <span className="text-xs">({projectResults.length})</span>
                  )}
                </TabsTrigger>
              </TabsList>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
                </div>
              ) : filteredResults.length === 0 ? (
                <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                  <SearchIcon className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                  <p className="text-foreground/60">
                    {query ? `No results found for "${query}"` : "Enter a search query"}
                  </p>
                  <p className="text-sm text-foreground/40 mt-2">
                    Try different keywords or check spelling
                  </p>
                </Card>
              ) : (
                <TabsContent value={activeTab} className="space-y-4">
                  {filteredResults.map((result) => (
                    <ResultCard key={`${result.type}-${result.id}`} result={result} />
                  ))}
                </TabsContent>
              )}
            </Tabs>
          )}
      </main>
    </div>
  );
};

// Result card component
function ResultCard({ result }: { result: SearchResult }) {
  if (result.type === "post") {
    const post = result.data as Post;
    return (
      <Link to="/">
        <Card className="p-5 cursor-pointer transition-all duration-300 hover:border-[hsla(326,71%,62%,0.35)] hover:shadow-[0_0_30px_hsla(326,71%,62%,0.2)] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <FileText className="h-5 w-5 text-[hsl(174,59%,56%)]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground mb-1">{result.title}</h3>
              <p className="text-sm text-foreground/70 line-clamp-2">
                {result.description}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-foreground/50">
                <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                {post.reactions && post.reactions.length > 0 && (
                  <span>{post.reactions.length} reactions</span>
                )}
              </div>
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  if (result.type === "user") {
    const user = result.data as UserType;
    return (
      <Link to={`/u/${user.username}`}>
        <Card className="p-5 cursor-pointer transition-all duration-300 hover:border-[hsla(326,71%,62%,0.35)] hover:shadow-[0_0_30px_hsla(326,71%,62%,0.2)] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
          <div className="flex items-center gap-4">
            <Avatar
              avatarRef={user.profile?.avatarRef}
              username={user.username}
              displayName={user.displayName}
              size="md"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground">{result.title}</h3>
              <p className="text-sm text-foreground/60">{result.description}</p>
              {result.preview && (
                <p className="text-sm text-foreground/50 mt-1 line-clamp-1">
                  {result.preview}
                </p>
              )}
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  if (result.type === "project") {
    const project = result.data as Project;
    return (
      <Link to={`/projects/${result.id}`}>
        <Card className="p-5 cursor-pointer transition-all duration-300 hover:border-[hsla(326,71%,62%,0.35)] hover:shadow-[0_0_30px_hsla(326,71%,62%,0.2)] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <FolderOpen className="h-5 w-5 text-[hsl(326,71%,62%)]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground mb-1">{result.title}</h3>
              <p className="text-sm text-foreground/70 line-clamp-2">
                {result.description}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-foreground/50">
                <span>{result.preview}</span>
                <span>{project.feedIndex.length} posts</span>
              </div>
            </div>
          </div>
        </Card>
      </Link>
    );
  }

  return null;
}

export default Search;
