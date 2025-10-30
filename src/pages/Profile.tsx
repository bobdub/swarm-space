import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Calendar, MapPin, Link2, Edit2, Coins, Send, File as FileIcon, Trash2, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostCard } from "@/components/PostCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Post, Project, type QcmSeriesPoint } from "@/types";
import { getAll, get, type Manifest as StoredManifest } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import { ProfileEditor } from "@/components/ProfileEditor";
import { Avatar } from "@/components/Avatar";
import { getCreditBalance } from "@/lib/credits";
import { SendCreditsModal } from "@/components/SendCreditsModal";
import { AchievementBadgeGrid } from "@/components/AchievementBadgeGrid";
import { AchievementGallery } from "@/components/AchievementGallery";
import { QCMChart } from "@/components/QCMChart";
import type { AchievementDisplayItem } from "@/components/achievement-types";
import {
  listAchievementDefinitions,
  listUserAchievementProgress,
  listQcmSeriesPoints,
} from "@/lib/achievementsStore";
import {
  decryptAndReassembleFile,
  importKeyRaw,
  type Manifest as EncryptedManifest,
} from "@/lib/fileEncryption";
import { useP2PContext } from "@/contexts/P2PContext";
import { PostComposer } from "@/components/PostComposer";
import { FilePreview } from "@/components/FilePreview";
import { deleteManifest, type Manifest as FileManifest } from "@/lib/fileEncryption";
import { toast } from "sonner";
import { getBlockedUserIds } from "@/lib/connections";
import {
  entangle,
  detangle,
  getEntangledUserIds,
  getFollowerIds,
  isEntangled,
} from "@/lib/entanglements";
import { getHiddenPostIds } from "@/lib/hiddenPosts";

type TabKey = "posts" | "projects" | "achievements" | "metrics" | "files";
const TAB_VALUES: TabKey[] = ["posts", "projects", "achievements", "metrics", "files"];

type CreditNotificationEventDetail = {
  direction: "sent" | "received";
  userId: string;
  counterpartyId: string;
  amount: number;
  transactionId: string;
  type: string;
  createdAt: string;
  message?: string;
};

const Profile = () => {
  const { username: userParam } = useParams();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [fallbackBannerRef, setFallbackBannerRef] = useState<string | null>(null);
  const [fileManifests, setFileManifests] = useState<FileManifest[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [previewManifest, setPreviewManifest] = useState<FileManifest | null>(null);
  const [viewingBlockedUser, setViewingBlockedUser] = useState(false);
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const [entanglementCounts, setEntanglementCounts] = useState({ followers: 0, following: 0 });
  const [isEntangledWithUser, setIsEntangledWithUser] = useState(false);
  const [entangleLoading, setEntangleLoading] = useState(false);
  const { ensureManifest } = useP2PContext();

  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(
    TAB_VALUES.includes((tabParam ?? "") as TabKey) ? (tabParam as TabKey) : "posts",
  );
  const composerOpen = searchParams.get("composer") === "open";
  const defaultProjectParam = searchParams.get("project") ?? undefined;

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

  const loadUserContent = useCallback(async (userId: string, hiddenIds: string[] = []) => {
    setFilesLoading(true);
    try {
      const allPosts = await getAll<Post>("posts");
      const allProjects = await getAll<Project>("projects");

      const userPosts = allPosts.filter(p => p.author === userId).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const visiblePosts = hiddenIds.length
        ? userPosts.filter((post) => !hiddenIds.includes(post.id))
        : userPosts;
      setPosts(visiblePosts);

      setProjects(allProjects.filter(p => p.members.includes(userId)));

      let newestBanner: { ref: string; timestamp: number } | null = null;
      for (const post of visiblePosts) {
        if (!post.authorBannerRef) continue;
        const latestTimestampSource = post.editedAt ?? post.createdAt;
        const timestamp = latestTimestampSource ? new Date(latestTimestampSource).getTime() : 0;
        if (!newestBanner || timestamp > newestBanner.timestamp) {
          newestBanner = { ref: post.authorBannerRef, timestamp };
        }
      }
      setFallbackBannerRef(newestBanner?.ref ?? null);

      const manifestIds = new Set<string>();
      for (const post of visiblePosts) {
        for (const manifestId of post.manifestIds ?? []) {
          manifestIds.add(manifestId);
        }
      }

      if (manifestIds.size === 0) {
        setFileManifests([]);
        return;
      }

      const manifests = await Promise.all(
        Array.from(manifestIds).map(async (manifestId) => {
          try {
            const manifest = await get<FileManifest>("manifests", manifestId);
            return manifest ?? null;
          } catch (error) {
            console.warn(`[Profile] Failed to load manifest ${manifestId}`, error);
            return null;
          }
        })
      );

      setFileManifests(manifests.filter((manifest): manifest is FileManifest => Boolean(manifest)));
    } finally {
      setFilesLoading(false);
    }
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
          meta: definition.meta,
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

  const loadEntanglementInsights = useCallback(
    async (targetUserId: string) => {
      try {
        const [followingIds, followerIds] = await Promise.all([
          getEntangledUserIds(targetUserId).catch(() => []),
          getFollowerIds(targetUserId).catch(() => []),
        ]);

        setEntanglementCounts({
          following: followingIds.length,
          followers: followerIds.length,
        });

        if (currentUser && currentUser.id !== targetUserId) {
          const entangled = await isEntangled(currentUser.id, targetUserId).catch(() => false);
          setIsEntangledWithUser(entangled);
        } else {
          setIsEntangledWithUser(false);
        }
      } catch (error) {
        console.warn("[Profile] Failed to load entanglement insights", error);
        setEntanglementCounts({ followers: 0, following: 0 });
        if (currentUser && currentUser.id !== targetUserId) {
          setIsEntangledWithUser(false);
        }
      }
    },
    [currentUser]
  );

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setViewingBlockedUser(false);
    setEntanglementCounts({ followers: 0, following: 0 });
    setIsEntangledWithUser(false);
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
        setFileManifests([]);
        setFilesLoading(false);
        setPreviewManifest(null);
        setHiddenPostIds([]);
        return;
      }

      setUser(targetUser);

      let hiddenIds: string[] = [];

      if (currentUser) {
        hiddenIds = await getHiddenPostIds(currentUser.id);
        setHiddenPostIds(hiddenIds);

        const isDifferentUser = currentUser.id !== targetUser.id;
        if (isDifferentUser) {
          const blockedIds = await getBlockedUserIds(currentUser.id);
          if (blockedIds.includes(targetUser.id)) {
            setViewingBlockedUser(true);
            setPosts([]);
            setProjects([]);
            setCredits(0);
            setAchievementBadges([]);
            setQcmSeries({});
            setFileManifests([]);
            setFilesLoading(false);
            setPreviewManifest(null);
            setAchievementsLoading(false);
            setQcmLoading(false);
            return;
          }
        }
      } else {
        setHiddenPostIds([]);
      }

      await Promise.all([
        loadUserContent(targetUser.id, hiddenIds),
        loadCreditsForUser(targetUser.id),
        loadAchievementData(targetUser.id),
        loadQcmSeries(targetUser.id),
      ]);
      await loadEntanglementInsights(targetUser.id);
    } finally {
      setLoading(false);
    }
  }, [
    currentUser,
    isOwnProfile,
    loadEntanglementInsights,
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
    if (!user) {
      return;
    }

    const handleCreditEvent = (event: Event) => {
      const detail = (event as CustomEvent<CreditNotificationEventDetail | undefined>).detail;
      if (!detail) {
        return;
      }

      if (detail.userId === user.id || detail.counterpartyId === user.id) {
        void loadCreditsForUser(user.id);
      }
    };

    window.addEventListener("credits:transaction", handleCreditEvent as EventListener);
    return () => {
      window.removeEventListener("credits:transaction", handleCreditEvent as EventListener);
    };
  }, [loadCreditsForUser, user]);

  useEffect(() => {
    const tabValue = searchParams.get("tab");
    const nextTab = TAB_VALUES.includes((tabValue ?? "") as TabKey)
      ? (tabValue as TabKey)
      : "posts";
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, searchParams]);

  const clearComposerParams = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("composer");
    next.delete("project");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (composerOpen && !isOwnProfile) {
      clearComposerParams();
    }
  }, [clearComposerParams, composerOpen, isOwnProfile]);

  const handleTabChange = useCallback((value: string) => {
    if (!TAB_VALUES.includes(value as TabKey)) {
      return;
    }
    setActiveTab(value as TabKey);
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    if (value !== "posts") {
      next.delete("composer");
      next.delete("project");
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handlePostCreated = useCallback(() => {
    clearComposerParams();
    void loadProfile();
  }, [clearComposerParams, loadProfile]);

  const handleDeleteFile = useCallback(async (manifestId: string) => {
    if (!isOwnProfile) return;
    if (!window.confirm("Delete this file? This cannot be undone.")) return;
    try {
      await deleteManifest(manifestId);
      setFileManifests((prev) => prev.filter((manifest) => manifest.fileId !== manifestId));
      toast.success("File deleted");
    } catch (error) {
      console.error("[Profile] Failed to delete file", error);
      toast.error("Failed to delete file");
    }
  }, [isOwnProfile]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const totalFileSize = useMemo(
    () => fileManifests.reduce((sum, manifest) => sum + manifest.size, 0),
    [fileManifests],
  );

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

  useEffect(() => {
    const bannerRef = user?.profile?.bannerRef ?? fallbackBannerRef ?? undefined;
    if (!bannerRef) {
      setBannerUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const loadBanner = async () => {
      try {
        let manifest = await get<StoredManifest>("manifests", bannerRef);
        const manifestIncomplete = !manifest?.fileKey || !manifest?.chunks?.length;

        if (!manifest || manifestIncomplete) {
          const ensured = await ensureManifest(bannerRef);
          if (ensured) {
            manifest = ensured;
          }
        }

        if (!manifest) {
          if (!cancelled) {
            setBannerUrl(null);
          }
          return;
        }

        if (!manifest.fileKey) {
          console.warn(`Banner manifest ${bannerRef} is missing its encryption key.`);
          if (!cancelled) {
            setBannerUrl(null);
          }
          return;
        }

        if (!manifest.chunks || manifest.chunks.length === 0) {
          console.warn(`Banner manifest ${bannerRef} does not contain any chunks.`);
          if (!cancelled) {
            setBannerUrl(null);
          }
          return;
        }

        const fileKey = await importKeyRaw(manifest.fileKey);
        // Ensure manifest has required properties for decryption
        const manifestForDecryption: EncryptedManifest = {
          ...manifest,
          mime: manifest.mime || "image/png",
          size: manifest.size || 0,
          originalName: manifest.originalName || "banner",
        };
        const blob = await decryptAndReassembleFile(manifestForDecryption, fileKey);
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setBannerUrl(objectUrl);
        }
      } catch (error) {
        console.error("Failed to load banner:", error);
        if (!cancelled) {
          setBannerUrl(null);
        }
      }
    };

    void loadBanner();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [ensureManifest, fallbackBannerRef, user?.profile?.bannerRef]);

  const handleProfileUpdate = (updatedUser: User) => {
    setUser(updatedUser);
    setShowEditor(false);
  };

  const handleEntangleToggle = useCallback(async () => {
    if (!currentUser || !user) {
      toast.error("You need an account to entangle with creators");
      return;
    }

    setEntangleLoading(true);
    try {
      if (isEntangledWithUser) {
        await detangle(currentUser.id, user.id);
        toast.success(`Detangled from ${user.displayName || user.username}`);
      } else {
        await entangle(currentUser.id, user.id, user.displayName || user.username || user.id);
        toast.success(`Entangled with ${user.displayName || user.username}`);
      }
      await loadEntanglementInsights(user.id);
    } catch (error) {
      console.error("[Profile] Failed to toggle entanglement", error);
      toast.error("Unable to update entanglement right now");
    } finally {
      setEntangleLoading(false);
    }
  }, [currentUser, isEntangledWithUser, loadEntanglementInsights, user]);

  useEffect(() => {
    if (!user) return;

    const handleEntanglementUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; targetUserId: string }>).detail;
      if (!detail) return;
      if (
        detail.targetUserId === user.id ||
        (currentUser && detail.userId === currentUser.id)
      ) {
        void loadEntanglementInsights(user.id);
      }
    };

    window.addEventListener(
      "entanglements-updated",
      handleEntanglementUpdate as EventListener
    );
    return () => {
      window.removeEventListener(
        "entanglements-updated",
        handleEntanglementUpdate as EventListener
      );
    };
  }, [currentUser, loadEntanglementInsights, user]);

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
            <div className="h-48 overflow-hidden">
              {bannerUrl ? (
                <img
                  src={bannerUrl}
                  alt={`${user.displayName || user.username}'s profile banner`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-[hsla(326,71%,62%,0.35)] via-[hsla(245,70%,12%,0.45)] to-[hsla(174,59%,56%,0.35)]" />
              )}
            </div>
            
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

                {!isOwnProfile && !viewingBlockedUser && (
                  <Button
                    onClick={handleEntangleToggle}
                    variant={isEntangledWithUser ? "outline" : "default"}
                    size="sm"
                    disabled={entangleLoading}
                    className={`gap-2 rounded-xl border-[hsla(174,59%,56%,0.18)] ${
                      isEntangledWithUser
                        ? "bg-[hsla(245,70%,12%,0.45)] hover:bg-[hsla(245,70%,16%,0.6)]"
                        : "bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-[hsl(253,82%,6%)]"
                    }`}
                  >
                    {entangleLoading
                      ? "Updating..."
                      : isEntangledWithUser
                        ? "Detangle"
                        : "Entangle"}
                  </Button>
                )}

                {!isOwnProfile && !viewingBlockedUser && (
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
                    <div className="space-y-1">
                      <div className="text-2xl font-display tracking-[0.15em] text-foreground">
                        {entanglementCounts.followers}
                      </div>
                      <div className="text-xs font-display uppercase tracking-[0.3em] text-foreground/55">
                        Entangled With You
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-2xl font-display tracking-[0.15em] text-foreground">
                        {entanglementCounts.following}
                      </div>
                      <div className="text-xs font-display uppercase tracking-[0.3em] text-foreground/55">
                        Creators You Entangle
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
            {viewingBlockedUser ? (
              <div className="mt-8 rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                You've blocked this user. Unblock them from your settings to view their posts and activity.
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] p-2 backdrop-blur-xl md:grid-cols-5">
                <TabsTrigger value="posts" className="rounded-xl">
                  Posts
                </TabsTrigger>
                <TabsTrigger value="projects" className="rounded-xl">
                  Projects
                </TabsTrigger>
                <TabsTrigger value="achievements" className="rounded-xl">
                  Achievements
                </TabsTrigger>
                <TabsTrigger value="metrics" className="rounded-xl">
                  QCM
                </TabsTrigger>
                <TabsTrigger value="files" className="rounded-xl">
                  Files
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="posts"
                id="profile-feed-top"
                className="mt-8 space-y-6"
              >
                {isOwnProfile && (
                  <PostComposer
                    className="space-y-6"
                    showHeader={false}
                    showPostHistory={false}
                    autoFocus={composerOpen}
                    defaultProjectId={defaultProjectParam}
                    onPostCreated={handlePostCreated}
                    onSetupDismiss={clearComposerParams}
                  />
                )}

                {posts.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    {!isOwnProfile && hiddenPostIds.length > 0
                      ? "You've hidden posts from this creator. Adjust your hidden posts list to see them again."
                      : "No posts yet"}
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

              <TabsContent value="files" className="mt-8 space-y-4">
                <div className="flex flex-col gap-2">
                  <div>
                    <h3 className="text-lg font-display uppercase tracking-[0.2em] text-foreground">
                      {isOwnProfile ? "Your Files" : "Shared Files"}
                    </h3>
                    <p className="text-xs text-foreground/60">
                      {fileManifests.length} files • {formatFileSize(totalFileSize)} stored
                    </p>
                  </div>
                </div>

                {filesLoading ? (
                  <div className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    Loading files…
                  </div>
                ) : fileManifests.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
                    {isOwnProfile ? "You haven't uploaded any files yet" : "No shared files available"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {fileManifests.map((manifest) => (
                      <div
                        key={manifest.fileId}
                        className="flex flex-col gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-4 py-4 text-sm backdrop-blur-xl md:flex-row md:items-center md:justify-between"
                      >
                        <div className="flex items-start gap-3 md:items-center">
                          <div className="mt-0.5 rounded-xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)] p-2">
                            <FileIcon className="h-4 w-4 text-[hsl(174,59%,56%)]" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">
                              {manifest.originalName}
                            </div>
                            <div className="text-xs text-foreground/60">
                              {formatFileSize(manifest.size)} • {formatDate(manifest.createdAt)}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => setPreviewManifest(manifest)}
                          >
                            <Eye className="h-4 w-4" />
                            Preview
                          </Button>
                          {isOwnProfile && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void handleDeleteFile(manifest.fileId)}
                              aria-label="Delete file"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
            )}
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

      {previewManifest && (
        <FilePreview
          manifest={previewManifest}
          onClose={() => setPreviewManifest(null)}
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
