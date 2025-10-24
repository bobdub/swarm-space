import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, FolderOpen, TrendingUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Project } from "@/types";
import { getPublicProjects } from "@/lib/projects";
import { CreateProjectModal } from "@/components/CreateProjectModal";
import { Avatar } from "@/components/Avatar";

const Explore = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const publicProjects = await getPublicProjects();
      setProjects(publicProjects);
    } catch (error) {
      console.error("Failed to load projects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="max-w-6xl mx-auto px-3 md:px-6 pb-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold font-display uppercase tracking-wider">Explore</h1>
            <CreateProjectModal onProjectCreated={loadProjects} />
          </div>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search projects, posts, and people..."
              className="pl-10 border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.6)]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

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

            <TabsContent value="projects" className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
                </div>
              ) : filteredProjects.length === 0 ? (
                <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                  <p className="text-foreground/60">
                    {searchQuery ? "No projects found matching your search" : "No public projects yet"}
                  </p>
                  <p className="text-sm text-foreground/40 mt-2">
                    Be the first to create a project!
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredProjects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="people">
              <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <Users className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                <p className="text-foreground/60">User discovery coming soon</p>
                <p className="text-sm text-foreground/40 mt-2">
                  Find and connect with other users
                </p>
              </Card>
            </TabsContent>

            <TabsContent value="trending">
              <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <TrendingUp className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                <p className="text-foreground/60">Trending content coming soon</p>
                <p className="text-sm text-foreground/40 mt-2">
                  Discover what's hot right now
                </p>
              </Card>
            </TabsContent>
          </Tabs>
      </main>
    </div>
  );
};

// Project card component
function ProjectCard({ project }: { project: Project }) {
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
                {project.description || "No description"}
              </p>
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