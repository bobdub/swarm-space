import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Calendar, MapPin, Link2, Edit2, Mail, Coins, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Post, Project } from "@/types";
import { get, getAll } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { ProfileEditor } from "@/components/ProfileEditor";
import { getCreditBalance } from "@/lib/credits";
import { SendCreditsModal } from "@/components/SendCreditsModal";

const Profile = () => {
  const { username } = useParams();
  const currentUser = getCurrentUser();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [showSendCredits, setShowSendCredits] = useState(false);

  const isOwnProfile = !username || username === currentUser?.username;

  useEffect(() => {
    loadProfile();
  }, [username]);

  const loadProfile = async () => {
    if (isOwnProfile && currentUser) {
      setUser(currentUser);
      await loadUserContent(currentUser.id);
      const balance = await getCreditBalance(currentUser.id);
      setCredits(balance);
    }
    // TODO: In Phase 5, load other users' profiles from P2P network
  };

  const loadUserContent = async (userId: string) => {
    const allPosts = await getAll<Post>("posts");
    const allProjects = await getAll<Project>("projects");
    
    setPosts(allPosts.filter(p => p.author === userId).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
    
    setProjects(allProjects.filter(p => p.members.includes(userId)));
  };

  const handleProfileUpdate = (updatedUser: User) => {
    setUser(updatedUser);
    setShowEditor(false);
  };

  if (!user) {
    return (
      <div className="flex min-h-screen">
        <Navigation />
        <main className="flex-1 ml-64">
          <TopNavigationBar />
          <div className="max-w-5xl mx-auto p-6">
            <p className="text-center text-foreground/60">Profile not found</p>
          </div>
        </main>
      </div>
    );
  }

  const joinedDate = user.meta?.createdAt || user.profile?.stats?.joinedAt;
  const memberSince = joinedDate ? formatDistanceToNow(new Date(joinedDate), { addSuffix: true }) : "Recently";

  return (
    <div className="flex min-h-screen text-foreground">
      <Navigation />

      <main className="relative ml-64 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,hsla(247,72%,8%,0.35),hsla(253,82%,2%,0.85))]" />
          <div className="absolute -left-40 -top-32 h-[32rem] w-[32rem] rounded-full bg-[hsla(326,71%,62%,0.22)] blur-[160px]" />
          <div className="absolute right-[-18rem] top-1/3 h-[28rem] w-[28rem] rounded-full bg-[hsla(174,59%,56%,0.18)] blur-[180px]" />
        </div>
        
        <TopNavigationBar />
        
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-20">
          {/* Profile Header */}
          <div className="relative overflow-hidden rounded-[32px] border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,8%,0.82)] shadow-[0_40px_140px_hsla(244,70%,5%,0.58)] backdrop-blur-2xl">
            {/* Banner */}
            <div className="h-48 bg-gradient-to-br from-[hsla(326,71%,62%,0.35)] via-[hsla(245,70%,12%,0.45)] to-[hsla(174,59%,56%,0.35)]" />
            
            {/* Profile Content */}
            <div className="relative px-8 pb-8">
              {/* Avatar */}
              <div className="absolute -top-16 flex h-32 w-32 items-center justify-center rounded-[28px] border-4 border-[hsla(245,70%,8%,0.82)] bg-[hsla(253,82%,6%,0.95)] text-4xl font-display uppercase tracking-[0.22em] text-[hsl(326,71%,62%)] shadow-[0_24px_80px_hsla(326,71%,62%,0.42)]">
                {user.displayName?.[0]?.toUpperCase() || user.username[0]?.toUpperCase()}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4">
                {/* Credits Display */}
                <div className="flex items-center gap-2 rounded-xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-4 py-2">
                  <Coins className="h-4 w-4 text-[hsl(326,71%,62%)]" />
                  <span className="font-display text-sm tracking-[0.15em] text-foreground">
                    {credits}
                  </span>
                </div>

                {!isOwnProfile && (
                  <Button
                    onClick={() => setShowSendCredits(true)}
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] hover:bg-[hsla(245,70%,16%,0.6)]"
                  >
                    <Send className="h-4 w-4" />
                    Send Credits
                  </Button>
                )}

                {isOwnProfile && (
                  <Button
                    onClick={() => setShowEditor(true)}
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] hover:bg-[hsla(245,70%,16%,0.6)]"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edit Profile
                  </Button>
                )}
              </div>

              <div className="mt-6 space-y-6">
                {/* Name & Username */}
                <div className="space-y-2">
                  <h1 className="text-3xl font-display uppercase tracking-[0.2em] text-foreground">
                    {user.displayName || user.username}
                  </h1>
                  <p className="text-sm font-display uppercase tracking-[0.3em] text-foreground/55">
                    @{user.username}
                  </p>
                </div>

                {/* Bio */}
                {user.profile?.bio && (
                  <p className="max-w-2xl text-base leading-relaxed text-foreground/75">
                    {user.profile.bio}
                  </p>
                )}

                {/* Meta Info */}
                <div className="flex flex-wrap gap-6 text-sm text-foreground/60">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Joined {memberSince}</span>
                  </div>
                  {user.profile?.location && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span>{user.profile.location}</span>
                    </div>
                  )}
                  {user.profile?.website && (
                    <a
                      href={user.profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 hover:text-foreground transition-colors"
                    >
                      <Link2 className="h-4 w-4" />
                      <span>{new URL(user.profile.website).hostname}</span>
                    </a>
                  )}
                </div>

                {/* Stats */}
                <div className="flex flex-wrap gap-8 pt-4 border-t border-[hsla(174,59%,56%,0.18)]">
                  <div className="space-y-1">
                    <div className="text-2xl font-display tracking-[0.15em] text-foreground">
                      {posts.length}
                    </div>
                    <div className="text-xs font-display uppercase tracking-[0.3em] text-foreground/55">
                      Posts
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-display tracking-[0.15em] text-foreground">
                      {projects.length}
                    </div>
                    <div className="text-xs font-display uppercase tracking-[0.3em] text-foreground/55">
                      Projects
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Content Tabs */}
          <div className="mt-12">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList className="grid w-full grid-cols-3 gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] p-2 backdrop-blur-xl">
                <TabsTrigger value="posts" className="rounded-xl">
                  Posts
                </TabsTrigger>
                <TabsTrigger value="projects" className="rounded-xl">
                  Projects
                </TabsTrigger>
                <TabsTrigger value="about" className="rounded-xl">
                  About
                </TabsTrigger>
              </TabsList>

              <TabsContent value="posts" className="mt-8 space-y-6">
                {posts.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    No posts yet
                  </div>
                ) : (
                  posts.map((post) => <PostCard key={post.id} post={post} />)
                )}
              </TabsContent>

              <TabsContent value="projects" className="mt-8">
                {projects.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    No projects yet
                  </div>
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    {projects.map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="about" className="mt-8">
                <div className="rounded-[28px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-8 backdrop-blur-2xl">
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-display uppercase tracking-[0.2em] text-foreground mb-4">
                        Identity
                      </h3>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-foreground/60">User ID:</span>
                          <span className="font-mono text-foreground/75">{user.id.slice(0, 16)}...</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-foreground/60">Public Key:</span>
                          <span className="font-mono text-foreground/75">{user.publicKey.slice(0, 16)}...</span>
                        </div>
                      </div>
                    </div>

                    {user.profile?.links && (
                      <div className="pt-6 border-t border-[hsla(174,59%,56%,0.18)]">
                        <h3 className="text-lg font-display uppercase tracking-[0.2em] text-foreground mb-4">
                          Links
                        </h3>
                        <div className="space-y-3">
                          {user.profile.links.github && (
                            <a
                              href={`https://github.com/${user.profile.links.github}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-sm text-foreground/70 hover:text-foreground transition-colors"
                            >
                              GitHub: @{user.profile.links.github}
                            </a>
                          )}
                          {user.profile.links.twitter && (
                            <a
                              href={`https://twitter.com/${user.profile.links.twitter}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-sm text-foreground/70 hover:text-foreground transition-colors"
                            >
                              Twitter: @{user.profile.links.twitter}
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      {showEditor && (
        <ProfileEditor
          user={user}
          onSave={handleProfileUpdate}
          onClose={() => setShowEditor(false)}
        />
      )}

      {showSendCredits && user && (
        <SendCreditsModal
          toUserId={user.id}
          toUsername={user.username}
          isOpen={showSendCredits}
          onClose={() => setShowSendCredits(false)}
        />
      )}
    </div>
  );
};

export default Profile;
