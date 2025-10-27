import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Calendar, MapPin, Link2, Edit2, Coins, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Post, Project, type QcmSeriesPoint } from "@/types";
import { getAll } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Avatar } from "@/components/Avatar";
import { getCreditBalance } from "@/lib/credits";
import { SendCreditsModal } from "@/components/SendCreditsModal";
import { CreditHistory } from "@/components/CreditHistory";
import { AchievementBadgeGrid } from "@/components/AchievementBadgeGrid";
import { AchievementGallery } from "@/components/AchievementGallery";
import { QCMChart } from "@/components/QCMChart";
import type { AchievementDisplayItem } from "@/components/achievement-types";
import {
  listAchievementDefinitions,
  listUserAchievementProgress,
  listQcmSeriesPoints,
} from "@/lib/achievementsStore";

const Profile = () => {
  const { username: userParam } = useParams();
  const { user: currentUser } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [credits, setCredits] = useState(0);
  const [showSendCredits, setShowSendCredits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [achievementBadges, setAchievementBadges] = useState<AchievementDisplayItem[]>([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [qcmSeries, setQcmSeries] = useState<Record<string, QcmSeriesPoint[]>>({});
  const [qcmLoading, setQcmLoading] = useState(false);

  const isOwnProfile = !userParam ||
    userParam === currentUser?.username ||
    userParam === currentUser?.id;

  const orderedAchievements = useMemo(() => {
    return [...achievementBadges].sort((a, b) => {
      if (a.unlocked === b.unlocked) {
        const aTime = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
        const bTime = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
        return bTime - aTime;
      }
      return a.unlocked ? -1 : 1;
    });
  }, [achievementBadges]);

  const loadUserContent = useCallback(async (userId: string) => {
    const allPosts = await getAll<Post>("posts");
    const allProjects = await getAll<Project>("projects");

    setPosts(allPosts.filter(p => p.author === userId).sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));

    setProjects(allProjects.filter(p => p.members.includes(userId)));
  }, []);

  const loadCreditsForUser = useCallback(async (userId: string) => {
    const balance = await getCreditBalance(userId);
    setCredits(balance);
  }, []);

  const loadAchievementData = useCallback(async (userId: string) => {
    setAchievementsLoading(true);
    try {
      const [definitions, progressRecords] = await Promise.all([
        listAchievementDefinitions(),
        listUserAchievementProgress(userId),
      ]);

      const progressById = new Map(progressRecords.map((record) => [record.achievementId, record]));
      const items: AchievementDisplayItem[] = definitions.map((definition) => {
        const progress = progressById.get(definition.id);
        const unlocked = Boolean(progress?.unlocked);
        return {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          category: definition.category,
          rarity: definition.rarity,
          creditReward: definition.creditReward,
          qcmImpact: definition.qcmImpact,
          unlocked,
          unlockedAt: progress?.unlockedAt ?? (unlocked ? progress?.lastUpdated ?? null : null),
          progress: progress?.progress ?? (unlocked ? 1 : 0),
          progressLabel: progress?.progressLabel,
          isSecret: definition.isSecret,
        };
      });

      setAchievementBadges(items);
    } catch (error) {
      console.warn("[Profile] Failed to load achievements", error);
      setAchievementBadges([]);
    } finally {
      setAchievementsLoading(false);
    }
  }, []);

  const loadQcmSeries = useCallback(async (userId: string) => {
    setQcmLoading(true);
    try {
      const SERIES_KEYS = ["content", "node", "social"] as const;
      const entries = await Promise.all(
        SERIES_KEYS.map(async (key) => {
          try {
            const points = await listQcmSeriesPoints(userId, key);
            return [key, points] as const;
          } catch (error) {
            console.warn(`[Profile] Failed to load QCM series ${key}`, error);
            return [key, []] as const;
          }
        })
      );

      const filtered = entries.filter(([, points]) => points.length > 0) as [string, QcmSeriesPoint[]][];
      setQcmSeries(Object.fromEntries(filtered));
    } catch (error) {
      console.warn("[Profile] Failed to load QCM series", error);
      setQcmSeries({});
    } finally {
      setQcmLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      let targetUser: User | null = null;

      if (isOwnProfile && currentUser) {
        targetUser = currentUser;
      } else if (userParam) {
        const allUsers = await getAll<User>("users");
        targetUser = allUsers.find(u => u.username === userParam || u.id === userParam) ?? null;
      }

      if (!targetUser) {
        setUser(null);
        setPosts([]);
        setProjects([]);
        setCredits(0);
        setAchievementBadges([]);
        setQcmSeries({});
        return;
      }

      setUser(targetUser);

      await Promise.all([
        loadUserContent(targetUser.id),
        loadCreditsForUser(targetUser.id),
        loadAchievementData(targetUser.id),
        loadQcmSeries(targetUser.id),
      ]);
    } finally {
      setLoading(false);
    }
  }, [
    currentUser,
    isOwnProfile,
    loadAchievementData,
    loadCreditsForUser,
    loadQcmSeries,
    loadUserContent,
    userParam,
  ]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const handleSync = () => {
      void loadProfile();
    };

    window.addEventListener("p2p-posts-updated", handleSync);
    return () => window.removeEventListener("p2p-posts-updated", handleSync);
  }, [loadProfile]);

  useEffect(() => {
    if (!user) return;

    const handleAchievementUnlocked = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string }>).detail;
      if (!detail || detail.userId !== user.id) return;

      void loadAchievementData(user.id);
      void loadQcmSeries(user.id);
    };

    window.addEventListener("achievement-unlocked", handleAchievementUnlocked as EventListener);
    return () => {
      window.removeEventListener("achievement-unlocked", handleAchievementUnlocked as EventListener);
    };
  }, [loadAchievementData, loadQcmSeries, user]);

  const handleProfileUpdate = (updatedUser: User) => {
    setUser(updatedUser);
    setShowEditor(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <TopNavigationBar />
        <main className="max-w-5xl mx-auto px-3 md:px-6 pb-6 pt-8">
          <p className="text-center text-foreground/60">Loading profile...</p>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen">
        <TopNavigationBar />
        <main className="max-w-5xl mx-auto px-3 md:px-6 pb-6 pt-8">
          <p className="text-center text-foreground/60">Profile not found</p>
        </main>
      </div>
    );
  }

  const joinedDate = user.meta?.createdAt || user.profile?.stats?.joinedAt;
  const memberSince = joinedDate ? formatDistanceToNow(new Date(joinedDate), { addSuffix: true }) : "Recently";
  return (
    <div className="min-h-screen text-foreground">
      <main className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,hsla(247,72%,8%,0.35),hsla(253,82%,2%,0.85))]" />
          <div className="absolute -left-40 -top-32 h-[32rem] w-[32rem] rounded-full bg-[hsla(326,71%,62%,0.22)] blur-[160px]" />
          <div className="absolute right-[-18rem] top-1/3 h-[28rem] w-[28rem] rounded-full bg-[hsla(174,59%,56%,0.18)] blur-[180px]" />
        </div>
        
        <TopNavigationBar />
        
        <div className="relative z-10 mx-auto max-w-5xl px-3 md:px-6 pb-20">
          {/* Profile Header */}
          <div className="relative overflow-hidden rounded-[32px] border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,8%,0.82)] shadow-[0_40px_140px_hsla(244,70%,5%,0.58)] backdrop-blur-2xl">
            {/* Banner */}
            <div className="h-48 bg-gradient-to-br from-[hsla(326,71%,62%,0.35)] via-[hsla(245,70%,12%,0.45)] to-[hsla(174,59%,56%,0.35)]" />
            
            {/* Profile Content */}
            <div className="relative px-8 pb-8">
              {/* Avatar */}
              <div className="absolute -top-16 flex h-32 w-32 items-center justify-center overflow-hidden rounded-[28px] border-4 border-[hsla(245,70%,8%,0.82)] bg-[hsla(253,82%,6%,0.95)] shadow-[0_24px_80px_hsla(326,71%,62%,0.42)]">
                <Avatar
                  avatarRef={user.profile?.avatarRef}
                  username={user.username}
                  displayName={user.displayName || undefined}
                  size="xl"
                  className="h-full w-full rounded-none border-0 bg-transparent text-4xl font-display uppercase tracking-[0.22em] text-[hsl(326,71%,62%)] shadow-none"
                />
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

                {/* Stats & Badges */}
                <div className="space-y-6 border-t border-[hsla(174,59%,56%,0.18)] pt-6">
                  <div className="flex flex-wrap gap-8">
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

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-sm font-display uppercase tracking-[0.3em] text-foreground/70">
                        Signature Badges
                      </h2>
                    </div>
                    <AchievementBadgeGrid
                      badges={orderedAchievements}
                      isLoading={achievementsLoading}
                      emptyMessage={isOwnProfile ? "Start creating to unlock your first badge" : "No badges unlocked yet"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Content Tabs */}
          <div className="mt-12">
            <Tabs defaultValue="posts" className="w-full">
              <TabsList className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] p-2 backdrop-blur-xl md:grid-cols-6">
                <TabsTrigger value="posts" className="rounded-xl">
                  Posts
                </TabsTrigger>
                <TabsTrigger value="projects" className="rounded-xl">
                  Projects
                </TabsTrigger>
                <TabsTrigger value="achievements" className="rounded-xl">
                  Gallery
                </TabsTrigger>
                <TabsTrigger value="metrics" className="rounded-xl">
                  QCM
                </TabsTrigger>
                <TabsTrigger value="credits" className="rounded-xl">
                  Credits
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

              <TabsContent value="achievements" className="mt-8">
                <AchievementGallery
                  achievements={orderedAchievements}
                  isLoading={achievementsLoading}
                  emptyMessage={
                    isOwnProfile
                      ? "Complete activities to unlock your first badge"
                      : "This creator hasn't unlocked any badges yet"
                  }
                />
              </TabsContent>

              <TabsContent value="metrics" className="mt-8">
                <QCMChart
                  series={qcmSeries}
                  isLoading={qcmLoading}
                  emptyMessage={
                    isOwnProfile
                      ? "You'll see QCM activity spikes here once you start unlocking achievements."
                      : "No QCM activity recorded yet"
                  }
                />
              </TabsContent>

              <TabsContent value="credits" className="mt-8">
                {user && <CreditHistory userId={user.id} />}
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
