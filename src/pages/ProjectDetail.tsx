import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Calendar, CheckSquare, Settings, Loader2, ArrowLeft, UserPlus, UserMinus, PenSquare } from "lucide-react";
import { Project, Post, User } from "@/types";
import { getProject, canManageProject, isProjectMember, addProjectMember, removeProjectMember } from "@/lib/projects";
import { getCurrentUser } from "@/lib/auth";
import { get, getAll } from "@/lib/store";
import { PostCard } from "@/components/PostCard";
import { toast } from "@/hooks/use-toast";
import { Avatar } from "@/components/Avatar";
import { getBlockedUserIds } from "@/lib/connections";

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);

  const loadBlockedUsers = useCallback(async (userId: string) => {
    const blocked = await getBlockedUserIds(userId);
    setBlockedUserIds(blocked);
  }, []);

  const loadCurrentUser = useCallback(async () => {
    const user = await getCurrentUser();
    setCurrentUserId(user?.id || null);
    if (user?.id) {
      void loadBlockedUsers(user.id);
    } else {
      setBlockedUserIds([]);
    }
  }, [loadBlockedUsers]);

  const loadProject = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const projectData = await getProject(projectId);
      if (!projectData) {
        toast({
          title: "Project not found",
          variant: "destructive",
        });
        navigate("/explore");
        return;
      }

      setProject(projectData);

      // Load posts for this project
      const allPosts = (await getAll("posts")) as Post[];
      const projectPosts = allPosts.filter((p) =>
        projectData.feedIndex.includes(p.id)
      );
      const visiblePosts = blockedUserIds.length
        ? projectPosts.filter((post) => !blockedUserIds.includes(post.author))
        : projectPosts;
      setPosts(visiblePosts);
    } catch (error) {
      console.error("Failed to load project:", error);
      toast({
        title: "Failed to load project",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [blockedUserIds, navigate, projectId]);

  useEffect(() => {
    void loadProject();
    void loadCurrentUser();
  }, [projectId, loadProject, loadCurrentUser]);

  useEffect(() => {
    const handleSync = () => {
      void loadProject();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, [loadProject]);

  const handleJoinLeave = async () => {
    if (!project || !currentUserId) return;

    setIsJoining(true);
    try {
      const isMember = isProjectMember(project, currentUserId);
      
      if (isMember) {
        await removeProjectMember(project.id, currentUserId);
        toast({
          title: "Left project",
          description: `You have left "${project.name}"`,
        });
      } else {
        await addProjectMember(project.id, currentUserId);
        toast({
          title: "Joined project",
          description: `You are now a member of "${project.name}"`,
        });
      }

      await loadProject();
    } catch (error) {
      console.error("Failed to join/leave project:", error);
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopNavigationBar />
        <main className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
        </main>
      </div>
    );
  }

  if (!project) return null;

  const isMember = currentUserId ? isProjectMember(project, currentUserId) : false;
  const canManage = currentUserId ? canManageProject(project, currentUserId) : false;
  const isOwner = currentUserId === project.owner;

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="max-w-5xl mx-auto px-3 md:px-6 pb-6 space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            onClick={() => navigate("/explore")}
            className="gap-2 text-foreground/70 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Explore
          </Button>

          {/* Project Header */}
          <Card className="p-8 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1 space-y-4">
                <div>
                  <h1 className="text-4xl font-bold font-display uppercase tracking-wider text-foreground mb-2">
                    {project.name}
                  </h1>
                  <p className="text-foreground/70 text-lg leading-relaxed">
                    {project.description || "No description provided"}
                  </p>
                </div>

                <div className="flex items-center gap-6 text-sm text-foreground/60">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>{project.members.length} {project.members.length === 1 ? "member" : "members"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4" />
                    <span>{posts.length} {posts.length === 1 ? "post" : "posts"}</span>
                  </div>
                  <div className="px-3 py-1 rounded-full border border-[hsla(174,59%,56%,0.3)] bg-[hsla(245,70%,12%,0.4)] text-xs uppercase tracking-wider">
                    {project.settings?.visibility || "public"}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                {!isOwner && currentUserId && (
                  <Button
                    onClick={handleJoinLeave}
                    disabled={isJoining}
                    variant={isMember ? "outline" : "default"}
                    className="gap-2"
                  >
                    {isJoining ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isMember ? (
                      <>
                        <UserMinus className="h-4 w-4" />
                        Leave
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Join
                      </>
                    )}
                  </Button>
                )}

                {canManage && (
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/projects/${project.id}/settings`)}
                    className="gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Project Tabs */}
          <Tabs defaultValue="feed" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3 bg-[hsla(245,70%,8%,0.6)] border border-[hsla(174,59%,56%,0.2)]">
              <TabsTrigger value="feed" className="gap-2">
                <CheckSquare className="h-4 w-4" />
                Feed
              </TabsTrigger>
              <TabsTrigger value="members" className="gap-2">
                <Users className="h-4 w-4" />
                Members
              </TabsTrigger>
              <TabsTrigger value="planner" className="gap-2">
                <Calendar className="h-4 w-4" />
                Planner
              </TabsTrigger>
            </TabsList>

            {/* Feed Tab */}
            <TabsContent value="feed" className="space-y-6">
              {isMember && (
                <div className="flex justify-end">
                  <Button
                    className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
                    asChild
                  >
                    <Link
                      to={`/profile?tab=posts&composer=open&project=${project.id}`}
                      className="inline-flex items-center"
                    >
                      <PenSquare className="h-4 w-4" />
                      Create Post
                    </Link>
                  </Button>
                </div>
              )}
              {posts.length === 0 ? (
                <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                  <CheckSquare className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                  <p className="text-foreground/60">No posts in this project yet</p>
                  {isMember && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm text-foreground/40">
                        Create a post and add it to this project to get started
                      </p>
                      <Button
                        className="gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
                        asChild
                      >
                        <Link
                          to={`/profile?tab=posts&composer=open&project=${project.id}`}
                          className="inline-flex items-center"
                        >
                          <PenSquare className="h-4 w-4" />
                          Create Post
                        </Link>
                      </Button>
                    </div>
                  )}
                </Card>
              ) : (
                posts.map((post) => <PostCard key={post.id} post={post} />)
              )}
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members" className="space-y-4">
              <Card className="p-6 border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <h3 className="text-lg font-semibold uppercase tracking-wider mb-4">
                  Project Members ({project.members.length})
                </h3>
                <div className="space-y-3">
                  {project.members.map((memberId) => (
                    <MemberRow
                      key={memberId}
                      memberId={memberId}
                      isOwner={memberId === project.owner}
                      canRemove={canManage && memberId !== project.owner}
                      onRemove={() => {
                        removeProjectMember(project.id, memberId).then(() => {
                          loadProject();
                          toast({ title: "Member removed" });
                        });
                      }}
                    />
                  ))}
                </div>
              </Card>
            </TabsContent>

            {/* Planner Tab */}
            <TabsContent value="planner">
              <Card className="p-12 text-center border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
                <Calendar className="w-12 h-12 mx-auto mb-4 text-[hsl(174,59%,56%)] opacity-50" />
                <p className="text-foreground/60">Project planner coming soon</p>
                <p className="text-sm text-foreground/40 mt-2">
                  Track milestones and deadlines for this project
                </p>
              </Card>
            </TabsContent>
          </Tabs>
      </main>
    </div>
  );
};

// Member row component
function MemberRow({
  memberId,
  isOwner,
  canRemove,
  onRemove,
}: {
  memberId: string;
  isOwner: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    get<User>("users", memberId).then((member) => {
      setUser(member ?? null);
    });
  }, [memberId]);

  if (!user) return null;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,10%,0.4)] hover:border-[hsla(326,71%,62%,0.25)] transition-colors">
      <div className="flex items-center gap-3">
        <Avatar
          avatarRef={user.profile?.avatarRef}
          username={user.username}
          displayName={user.displayName}
          size="md"
        />
        <div>
          <Link
            to={`/u/${user.username}`}
            className="font-semibold text-foreground hover:text-[hsl(326,71%,62%)] transition-colors"
          >
            {user.displayName || user.username}
          </Link>
          <p className="text-xs text-foreground/50 font-display uppercase tracking-wider">
            @{user.username}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isOwner && (
          <span className="px-2 py-1 text-xs font-semibold uppercase tracking-wider rounded-full bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-white">
            Owner
          </span>
        )}
        {canRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-red-400 hover:text-red-300 hover:bg-red-950/20"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export default ProjectDetail;
