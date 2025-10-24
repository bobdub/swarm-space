import { Navigation } from "@/components/Navigation";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, Video, Clock } from "lucide-react";
import { Post, Project } from "@/types";
import { useEffect, useState } from "react";
import { getAll } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "react-router-dom";

const Index = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const user = getCurrentUser();
  
  useEffect(() => {
    loadData();
  }, []);
  
  const loadData = async () => {
    const loadedPosts = await getAll<Post>("posts");
    const loadedProjects = await getAll<Project>("projects");
    setPosts(loadedPosts.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
    setProjects(loadedProjects);
  };
  
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-2xl px-4">
          <div className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-6 shadow-glow animate-pulse-glow">
            <span className="text-4xl font-bold">I</span>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Imagination
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Decentralized social & project builder with local-first encryption
          </p>
          <div className="space-y-4">
            <Link to="/settings">
              <Button size="lg" className="gradient-primary shadow-glow">
                Get Started
              </Button>
            </Link>
            <p className="text-sm text-muted-foreground">
              Your data stays with you. Encrypted locally, ready for P2P.
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Home</h1>
          </div>
          
          <Tabs defaultValue="recent" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="trending" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Trending
              </TabsTrigger>
              <TabsTrigger value="videos" className="gap-2">
                <Video className="w-4 h-4" />
                Videos
              </TabsTrigger>
              <TabsTrigger value="recent" className="gap-2">
                <Clock className="w-4 h-4" />
                Recent
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="trending" className="space-y-4 mt-6">
              {posts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No posts yet. Create your first post!
                </div>
              ) : (
                posts.slice(0, 5).map((post) => (
                  <PostCard key={post.id} post={post} />
                ))
              )}
            </TabsContent>
            
            <TabsContent value="videos" className="space-y-4 mt-6">
              <div className="text-center py-12 text-muted-foreground">
                Video posts will appear here
              </div>
            </TabsContent>
            
            <TabsContent value="recent" className="space-y-4 mt-6">
              {posts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No posts yet. Create your first post!
                </div>
              ) : (
                posts.map((post) => <PostCard key={post.id} post={post} />)
              )}
            </TabsContent>
          </Tabs>
          
          {projects.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">Active Projects</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
