import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Video, Clock, ArrowUpRight } from "lucide-react";

import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Post, Project } from "@/types";
import { getAll } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";

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
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden text-foreground">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,hsla(247,72%,8%,0.92),hsla(253,82%,2%,0.96))]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(326,71%,62%,0.24),transparent_62%),radial-gradient(circle_at_bottom,hsla(174,59%,56%,0.18),transparent_55%)]" />
          <div className="absolute -top-28 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[hsla(326,71%,62%,0.2)] blur-[160px]" />
          <div className="absolute -bottom-24 right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[hsla(174,59%,56%,0.18)] blur-[180px]" />
        </div>
        <div className="relative z-10 max-w-2xl px-6 text-center">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-[28px] border border-[hsla(326,71%,62%,0.38)] bg-[hsla(253,82%,6%,0.85)] text-3xl font-display text-[hsl(326,71%,62%)] shadow-[0_36px_120px_hsla(326,71%,62%,0.38)]">
            ◢◤
          </div>
          <h1 className="mb-6 text-3xl font-display uppercase leading-tight tracking-[0.28em] text-foreground md:text-4xl">
            Imagination Network
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-foreground/75">
            Decentralized social & project builder with local-first encryption. Craft ideas in private, sync with your collective when the signal is ready.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/settings">
              <Button
                size="lg"
                className="rounded-xl border border-[hsla(326,71%,62%,0.45)] bg-[hsla(253,82%,6%,0.85)] px-8 py-5 font-display uppercase tracking-[0.2em] text-[hsl(326,71%,62%)] shadow-[0_24px_80px_hsla(326,71%,62%,0.42)] transition-colors duration-200 hover:text-foreground"
              >
                Get Started
              </Button>
            </Link>
            <p className="text-[0.75rem] font-display uppercase tracking-[0.35em] text-foreground/55">
              Your data, your keys
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen text-foreground">
      <Navigation />

      <main className="relative ml-64 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,hsla(247,72%,8%,0.35),hsla(253,82%,2%,0.85))]" />
          <div className="absolute -left-40 -top-32 h-[32rem] w-[32rem] rounded-full bg-[hsla(326,71%,62%,0.22)] blur-[160px]" />
          <div className="absolute right-[-18rem] top-1/3 h-[28rem] w-[28rem] rounded-full bg-[hsla(174,59%,56%,0.18)] blur-[180px]" />
          <div className="absolute bottom-0 left-1/2 h-[20rem] w-[20rem] -translate-x-1/2 rounded-full bg-[hsla(326,71%,62%,0.12)] blur-[160px]" />
        </div>
        <TopNavigationBar />
        <div className="relative z-10 mx-auto max-w-4xl px-6 pb-20">
          <section className="relative overflow-hidden rounded-[32px] border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,8%,0.82)] px-9 py-12 shadow-[0_40px_140px_hsla(244,70%,5%,0.58)] backdrop-blur-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,hsla(326,71%,62%,0.25),transparent_70%),radial-gradient(circle_at_bottom_right,hsla(174,59%,56%,0.18),transparent_75%)]" />
            <div className="relative flex flex-col gap-6">
              <div className="flex flex-wrap gap-3 text-[0.65rem] font-display uppercase tracking-[0.32em] text-foreground/55">
                <span className="rounded-full border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.55)] px-4 py-1">
                  All Saved Variables
                </span>
                <span className="rounded-full border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-4 py-1 text-foreground/65">
                  Local-First Encryption
                </span>
              </div>
              <h1 className="text-3xl font-display uppercase tracking-[0.22em] text-foreground md:text-4xl">
                Synchronize your collective imagination stream
              </h1>
              <p className="max-w-2xl text-base leading-relaxed text-foreground/75">
                Surface new transmissions, amplify trusted signals, and keep every artifact sovereign to your device until you choose to share it with the swarm.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link to="/create">
                  <Button
                    size="lg"
                    className="rounded-xl border border-[hsla(326,71%,62%,0.45)] bg-[hsla(253,82%,6%,0.85)] px-8 py-5 font-display uppercase tracking-[0.2em] text-[hsl(326,71%,62%)] shadow-[0_24px_90px_hsla(326,71%,62%,0.4)] transition-colors duration-200 hover:text-foreground"
                  >
                    Launch New Signal
                  </Button>
                </Link>
                <Link to="/explore">
                  <Button
                    variant="ghost"
                    size="lg"
                    className="rounded-xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.5)] px-8 py-5 font-display uppercase tracking-[0.2em] text-foreground/70 transition-colors duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.6)] hover:text-foreground"
                  >
                    Explore Network
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-12">
            <Tabs defaultValue="recent" className="w-full">
              <TabsList className="grid w-full grid-cols-3 gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] p-2 backdrop-blur-xl">
                <TabsTrigger
                  value="trending"
                  className="flex items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-3 text-[0.8rem] font-display uppercase tracking-[0.18em] text-foreground/65 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:text-foreground data-[state=active]:border-[hsla(326,71%,62%,0.38)] data-[state=active]:bg-gradient-to-r data-[state=active]:from-[hsla(326,71%,62%,0.55)] data-[state=active]:to-[hsla(174,59%,56%,0.5)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_45px_hsla(174,59%,56%,0.35)]"
                >
                  <TrendingUp className="h-4 w-4" />
                  Trending
                </TabsTrigger>
                <TabsTrigger
                  value="videos"
                  className="flex items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-3 text-[0.8rem] font-display uppercase tracking-[0.18em] text-foreground/65 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:text-foreground data-[state=active]:border-[hsla(326,71%,62%,0.38)] data-[state=active]:bg-gradient-to-r data-[state=active]:from-[hsla(326,71%,62%,0.55)] data-[state=active]:to-[hsla(174,59%,56%,0.5)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_45px_hsla(174,59%,56%,0.35)]"
                >
                  <Video className="h-4 w-4" />
                  Videos
                </TabsTrigger>
                <TabsTrigger
                  value="recent"
                  className="flex items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-3 text-[0.8rem] font-display uppercase tracking-[0.18em] text-foreground/65 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:text-foreground data-[state=active]:border-[hsla(326,71%,62%,0.38)] data-[state=active]:bg-gradient-to-r data-[state=active]:from-[hsla(326,71%,62%,0.55)] data-[state=active]:to-[hsla(174,59%,56%,0.5)] data-[state=active]:text-foreground data-[state=active]:shadow-[0_0_45px_hsla(174,59%,56%,0.35)]"
                >
                  <Clock className="h-4 w-4" />
                  Recent
                </TabsTrigger>
              </TabsList>

              <TabsContent value="trending" className="mt-8 space-y-6">
                {posts.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    No transmissions yet. Create your first post!
                  </div>
                ) : (
                  posts.slice(0, 5).map((post) => <PostCard key={post.id} post={post} />)
                )}
              </TabsContent>

              <TabsContent value="videos" className="mt-8 space-y-6">
                <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                  Video posts will appear here
                </div>
              </TabsContent>

              <TabsContent value="recent" className="mt-8 space-y-6">
                {posts.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    No transmissions yet. Create your first post!
                  </div>
                ) : (
                  posts.map((post) => <PostCard key={post.id} post={post} />)
                )}
              </TabsContent>
            </Tabs>
          </section>

          {projects.length > 0 && (
            <section className="relative mt-14 overflow-hidden rounded-[32px] border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,8%,0.82)] p-8 shadow-[0_40px_140px_hsla(244,70%,5%,0.55)] backdrop-blur-2xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsla(326,71%,62%,0.22),transparent_70%),radial-gradient(circle_at_bottom_right,hsla(174,59%,56%,0.18),transparent_75%)]" />
              <div className="relative space-y-6">
                <div className="space-y-2">
                  <span className="text-[0.75rem] font-display uppercase tracking-[0.32em] text-foreground/55">
                    Active Projects
                  </span>
                  <h2 className="text-3xl font-display uppercase tracking-[0.2em] text-foreground">
                    Collective builds unfolding
                  </h2>
                  <p className="text-sm text-foreground/70">
                    Track momentum, progress, and contributors across the initiatives you steward.
                  </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  {projects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
