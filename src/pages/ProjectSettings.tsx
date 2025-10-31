import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, ShieldAlert, Users, Image as ImageIcon } from "lucide-react";

import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/components/Avatar";
import { FileUpload } from "@/components/FileUpload";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Project, User } from "@/types";
import {
  getProject,
  updateProject,
  deleteProject,
  removeProjectMember,
  isProjectMember,
} from "@/lib/projects";
import { getAll, get, type Manifest as StoredManifest } from "@/lib/store";
import { blockUser, getBlockedUserIds } from "@/lib/connections";
import {
  decryptAndReassembleFile,
  importKeyRaw,
  type Manifest,
} from "@/lib/fileEncryption";

interface MemberProfile {
  id: string;
  username: string;
  displayName?: string;
  avatarRef?: string;
}

const ProjectSettings = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bio, setBio] = useState("");
  const [avatarRef, setAvatarRef] = useState<string | undefined>(undefined);
  const [bannerRef, setBannerRef] = useState<string | undefined>(undefined);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockingMemberId, setBlockingMemberId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const [showBannerUpload, setShowBannerUpload] = useState(false);

  const updatePreviewUrl = useCallback((setter: Dispatch<SetStateAction<string | null>>, url: string | null) => {
    setter((prev) => {
      if (typeof prev === "string" && prev !== url) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
  }, []);

  const createPreviewFromManifest = useCallback(async (manifest: Manifest, setter: Dispatch<SetStateAction<string | null>>) => {
    if (!manifest.fileKey) {
      console.warn(`Manifest ${manifest.fileId} is missing an encryption key.`);
      return;
    }

    try {
      const fileKey = await importKeyRaw(manifest.fileKey);
      const decrypted = await decryptAndReassembleFile(manifest, fileKey);
      const url = URL.createObjectURL(decrypted);
      updatePreviewUrl(setter, url);
    } catch (error) {
      console.error(`Failed to build preview for ${manifest.fileId}:`, error);
      updatePreviewUrl(setter, null);
    }
  }, [updatePreviewUrl]);

  const loadPreviewById = useCallback(async (manifestId: string, setter: Dispatch<SetStateAction<string | null>>) => {
    try {
      const stored = await get<StoredManifest>("manifests", manifestId);
      if (!stored) {
        updatePreviewUrl(setter, null);
        return;
      }

      const manifestForDecryption: Manifest = {
        ...stored,
        mime: stored.mime ?? "image/png",
        size: stored.size ?? 0,
        originalName: stored.originalName ?? manifestId,
      };

      await createPreviewFromManifest(manifestForDecryption, setter);
    } catch (error) {
      console.error(`Failed to load manifest ${manifestId}:`, error);
      updatePreviewUrl(setter, null);
    }
  }, [createPreviewFromManifest, updatePreviewUrl]);

  useEffect(() => () => {
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
    }
  }, [avatarPreview]);

  useEffect(() => () => {
    if (bannerPreview) {
      URL.revokeObjectURL(bannerPreview);
    }
  }, [bannerPreview]);

  const loadProject = useCallback(async () => {
    if (!projectId) {
      return;
    }

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

      const allUsers = await getAll<User>("users");
      const memberProfiles: MemberProfile[] = projectData.members.map((memberId) => {
        const record = allUsers.find((user) => user.id === memberId);
        if (!record) {
          return {
            id: memberId,
            username: memberId,
          };
        }

        return {
          id: record.id,
          username: record.username,
          displayName: record.displayName,
          avatarRef: record.profile?.avatarRef,
        };
      });

      setProject(projectData);
      setMembers(memberProfiles);
      setBio(projectData.profile?.bio ?? projectData.description ?? "");
      setAvatarRef(projectData.profile?.avatarRef);
      setBannerRef(projectData.profile?.bannerRef);

      if (projectData.profile?.avatarRef) {
        void loadPreviewById(projectData.profile.avatarRef, setAvatarPreview);
      } else {
        updatePreviewUrl(setAvatarPreview, null);
      }

      if (projectData.profile?.bannerRef) {
        void loadPreviewById(projectData.profile.bannerRef, setBannerPreview);
      } else {
        updatePreviewUrl(setBannerPreview, null);
      }

      if (currentUser?.id) {
        try {
          const blocked = await getBlockedUserIds(currentUser.id);
          setBlockedIds(blocked);
        } catch (error) {
          console.warn(`[ProjectSettings] Failed to load blocked users for ${currentUser.id}`, error);
          setBlockedIds([]);
        }
      } else {
        setBlockedIds([]);
      }
    } catch (error) {
      console.error("Failed to load project settings:", error);
      toast({
        title: "Failed to load project",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.id, loadPreviewById, navigate, projectId, updatePreviewUrl]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (avatarRef) {
      void loadPreviewById(avatarRef, setAvatarPreview);
    } else {
      updatePreviewUrl(setAvatarPreview, null);
    }
  }, [avatarRef, loadPreviewById, updatePreviewUrl]);

  useEffect(() => {
    if (bannerRef) {
      void loadPreviewById(bannerRef, setBannerPreview);
    } else {
      updatePreviewUrl(setBannerPreview, null);
    }
  }, [bannerRef, loadPreviewById, updatePreviewUrl]);

  const isMember = useMemo(() => {
    if (!project || !currentUser?.id) return false;
    return isProjectMember(project, currentUser.id);
  }, [currentUser?.id, project]);

  const isOwner = project && currentUser?.id ? project.owner === currentUser.id : false;

  const originalBio = project?.profile?.bio ?? project?.description ?? "";
  const originalAvatarRef = project?.profile?.avatarRef;
  const originalBannerRef = project?.profile?.bannerRef;

  const hasProfileChanges =
    originalBio !== bio || originalAvatarRef !== avatarRef || originalBannerRef !== bannerRef;

  const handleAvatarReady = (manifests: Manifest[]) => {
    if (manifests.length === 0) return;
    const manifest = manifests[0];
    setAvatarRef(manifest.fileId);
    setShowAvatarUpload(false);
    void createPreviewFromManifest(manifest, setAvatarPreview);
  };

  const handleBannerReady = (manifests: Manifest[]) => {
    if (manifests.length === 0) return;
    const manifest = manifests[0];
    setBannerRef(manifest.fileId);
    setShowBannerUpload(false);
    void createPreviewFromManifest(manifest, setBannerPreview);
  };

  const handleRemoveAvatar = () => {
    setAvatarRef(undefined);
    updatePreviewUrl(setAvatarPreview, null);
  };

  const handleRemoveBanner = () => {
    setBannerRef(undefined);
    updatePreviewUrl(setBannerPreview, null);
  };

  const handleSaveProfile = async () => {
    if (!project || !isOwner || !hasProfileChanges) {
      return;
    }

    setSavingProfile(true);
    try {
      const updated = await updateProject(project.id, {
        description: bio,
        profile: {
          ...project.profile,
          bio,
          avatarRef,
          bannerRef,
        },
      });

      if (updated) {
        setProject(updated);
        setBio(updated.profile?.bio ?? updated.description ?? "");
        setAvatarRef(updated.profile?.avatarRef);
        setBannerRef(updated.profile?.bannerRef);
        toast({
          title: "Project profile updated",
        });
      }
    } catch (error) {
      console.error("Failed to update project profile:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unable to save changes",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleToggleVisibility = async () => {
    if (!project || !isOwner || updatingSettings) {
      return;
    }

    const nextVisibility = project.settings?.visibility === "private" ? "public" : "private";

    setUpdatingSettings(true);
    try {
      const updated = await updateProject(project.id, {
        settings: {
          visibility: nextVisibility,
          allowJoinRequests: project.settings?.allowJoinRequests ?? true,
        },
      });

      if (updated) {
        setProject(updated);
        toast({
          title: "Visibility updated",
          description: `Project is now ${nextVisibility}.`,
        });
      }
    } catch (error) {
      console.error("Failed to update visibility:", error);
      toast({
        title: "Visibility update failed",
        description: error instanceof Error ? error.message : "Unable to update project visibility",
        variant: "destructive",
      });
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleToggleJoinRequests = async () => {
    if (!project || !isOwner || updatingSettings) {
      return;
    }

    const nextAllowJoin = !(project.settings?.allowJoinRequests ?? true);

    setUpdatingSettings(true);
    try {
      const updated = await updateProject(project.id, {
        settings: {
          visibility: project.settings?.visibility ?? "public",
          allowJoinRequests: nextAllowJoin,
        },
      });

      if (updated) {
        setProject(updated);
        toast({
          title: "Join settings updated",
          description: nextAllowJoin
            ? "Members can request to join this project."
            : "Join requests are now disabled.",
        });
      }
    } catch (error) {
      console.error("Failed to update join settings:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unable to update join settings",
        variant: "destructive",
      });
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!project || !isOwner || isDeleting) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete this project? This action cannot be undone.",
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteProject(project.id);
      toast({
        title: "Project deleted",
        description: `"${project.name}" has been removed.`,
      });
      navigate("/explore");
    } catch (error) {
      console.error("Failed to delete project:", error);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete project",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeaveProject = async () => {
    if (!project || !currentUser?.id || leaving) {
      return;
    }

    setLeaving(true);
    try {
      await removeProjectMember(project.id, currentUser.id);
      toast({
        title: "Left project",
        description: `You have left "${project.name}"`,
      });
      navigate(`/projects/${project.id}`);
    } catch (error) {
      console.error("Failed to leave project:", error);
      toast({
        title: "Unable to leave",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setLeaving(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!project || !isOwner || removingMemberId) {
      return;
    }

    setRemovingMemberId(memberId);
    try {
      await removeProjectMember(project.id, memberId);
      toast({
        title: "Member removed",
      });
      await loadProject();
    } catch (error) {
      console.error("Failed to remove member:", error);
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Unable to remove member",
        variant: "destructive",
      });
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleBlockMember = async (memberId: string) => {
    if (!project || !currentUser?.id || blockingMemberId || blockedIds.includes(memberId)) {
      return;
    }

    setBlockingMemberId(memberId);
    try {
      await blockUser(currentUser.id, memberId);
      setBlockedIds((prev) => [...prev, memberId]);
      toast({
        title: "User blocked",
        description: "They will no longer be able to contact you.",
      });
    } catch (error) {
      console.error("Failed to block user:", error);
      toast({
        title: "Block failed",
        description: error instanceof Error ? error.message : "Unable to block user",
        variant: "destructive",
      });
    } finally {
      setBlockingMemberId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <TopNavigationBar />
        <main className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(326,71%,62%)]" />
        </main>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const visibility = project.settings?.visibility ?? "public";
  const allowJoinRequests = project.settings?.allowJoinRequests ?? true;

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-3 pb-16 pt-10 md:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-display uppercase tracking-[0.25em] text-foreground">Project Settings</h1>
            <p className="text-sm text-foreground/60">Manage {project.name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/projects/${project.id}`)}>
              Back to project
            </Button>
            {isMember && !isOwner && (
              <Button variant="destructive" onClick={handleLeaveProject} disabled={leaving}>
                {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Leave project"}
              </Button>
            )}
          </div>
        </div>

        {!currentUser ? (
          <Card className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-10 text-center">
            <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-[hsl(326,71%,62%)]" />
            <h2 className="mb-2 text-xl font-semibold">Sign in required</h2>
            <p className="text-sm text-foreground/65">You must be signed in to manage project settings.</p>
          </Card>
        ) : !isMember ? (
          <Card className="border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-10 text-center">
            <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-[hsl(326,71%,62%)]" />
            <h2 className="mb-2 text-xl font-semibold">Access restricted</h2>
            <p className="text-sm text-foreground/65">
              Only project members can view the settings panel. Request to join or contact the project owner for
              access.
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {isOwner && (
              <Card className="space-y-6 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-6">
                <header className="space-y-1">
                  <h2 className="text-lg font-semibold uppercase tracking-[0.2em]">Project Profile</h2>
                  <p className="text-sm text-foreground/60">Update how your project appears across the mesh.</p>
                </header>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <Label htmlFor="project-bio">Project bio</Label>
                    <Textarea
                      id="project-bio"
                      value={bio}
                      onChange={(event) => setBio(event.target.value)}
                      className="min-h-[140px]"
                      placeholder="Share what this project is all about"
                    />
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-3">
                      <Label>Project avatar</Label>
                      <div className="flex flex-col items-start gap-3">
                        <div className="h-24 w-24 overflow-hidden rounded-2xl border border-[hsla(174,59%,56%,0.35)] bg-[hsla(245,70%,12%,0.4)]">
                          {avatarPreview ? (
                            <img src={avatarPreview} alt="Project avatar preview" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-foreground/50">
                              No avatar
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setShowAvatarUpload((prev) => !prev)}>
                            {showAvatarUpload ? "Cancel" : avatarRef ? "Change avatar" : "Upload avatar"}
                          </Button>
                          {avatarRef && (
                            <Button variant="ghost" onClick={handleRemoveAvatar}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                      {showAvatarUpload && (
                        <FileUpload
                          maxFiles={1}
                          acceptedTypes={["image/*"]}
                          onFilesReady={handleAvatarReady}
                        />
                      )}
                    </div>

                    <div className="space-y-3">
                      <Label>Banner image</Label>
                      <div className="flex flex-col items-start gap-3">
                        <div className="h-24 w-full overflow-hidden rounded-2xl border border-[hsla(174,59%,56%,0.35)] bg-[hsla(245,70%,12%,0.4)]">
                          {bannerPreview ? (
                            <img src={bannerPreview} alt="Project banner preview" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center gap-2 text-xs text-foreground/50">
                              <ImageIcon className="h-4 w-4" />
                              No banner
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setShowBannerUpload((prev) => !prev)}>
                            {showBannerUpload ? "Cancel" : bannerRef ? "Change banner" : "Upload banner"}
                          </Button>
                          {bannerRef && (
                            <Button variant="ghost" onClick={handleRemoveBanner}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </div>
                      {showBannerUpload && (
                        <FileUpload
                          maxFiles={1}
                          acceptedTypes={["image/*"]}
                          onFilesReady={handleBannerReady}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={!hasProfileChanges || savingProfile}>
                    {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
                  </Button>
                </div>
              </Card>
            )}

            <Card className="space-y-6 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-6">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold uppercase tracking-[0.2em]">Members</h2>
                  <p className="text-sm text-foreground/60">Manage the people collaborating on this project.</p>
                </div>
                <span className="flex items-center gap-1 text-sm text-foreground/60">
                  <Users className="h-4 w-4" />
                  {project.members.length}
                </span>
              </header>

              <div className="space-y-4">
                {members.map((member) => {
                  const isSelf = currentUser?.id === member.id;
                  const isBlocked = blockedIds.includes(member.id);
                  const canRemove = isOwner && !isSelf;

                  return (
                    <div
                      key={member.id}
                      className="flex flex-col gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.35)] p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          avatarRef={member.avatarRef}
                          username={member.username}
                          displayName={member.displayName}
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {member.displayName ?? member.username}
                          </p>
                          <p className="text-xs uppercase tracking-[0.25em] text-foreground/50">@{member.username}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!isSelf && (
                          <Button
                            variant="outline"
                            disabled={isBlocked || blockingMemberId === member.id}
                            onClick={() => handleBlockMember(member.id)}
                          >
                            {blockingMemberId === member.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : isBlocked ? (
                              "Blocked"
                            ) : (
                              "Block"
                            )}
                          </Button>
                        )}
                        {canRemove && (
                          <Button
                            variant="destructive"
                            disabled={removingMemberId === member.id}
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            {removingMemberId === member.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Remove"
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {isOwner && (
              <Card className="space-y-6 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)] p-6">
                <header className="space-y-1">
                  <h2 className="text-lg font-semibold uppercase tracking-[0.2em]">Admin tools</h2>
                  <p className="text-sm text-foreground/60">Control visibility and membership safeguards.</p>
                </header>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-6 rounded-2xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.35)] px-4 py-3">
                    <div>
                      <p className="font-medium">Private project</p>
                      <p className="text-sm text-foreground/60">
                        When enabled, only members and connected creators can see this project.
                      </p>
                    </div>
                    <Switch
                      checked={visibility === "private"}
                      onCheckedChange={handleToggleVisibility}
                      disabled={updatingSettings}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-6 rounded-2xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.35)] px-4 py-3">
                    <div>
                      <p className="font-medium">Allow join requests</p>
                      <p className="text-sm text-foreground/60">
                        Members outside the project can request access when this is enabled.
                      </p>
                    </div>
                    <Switch
                      checked={allowJoinRequests}
                      onCheckedChange={handleToggleJoinRequests}
                      disabled={updatingSettings}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button variant="destructive" onClick={handleDeleteProject} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete project"}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ProjectSettings;
