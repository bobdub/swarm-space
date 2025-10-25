import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { User } from "@/types";
import { get, put } from "@/lib/store";
import { toast } from "sonner";
import { FileUpload } from "./FileUpload";
import { decryptAndReassembleFile, importKeyRaw, Manifest } from "@/lib/fileEncryption";
import { useP2PContext } from "@/contexts/P2PContext";

interface ProfileEditorProps {
  user: User;
  onSave: (user: User) => void;
  onClose: () => void;
}

export const ProfileEditor = ({ user, onSave, onClose }: ProfileEditorProps) => {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [bio, setBio] = useState(user.profile?.bio || "");
  const [location, setLocation] = useState(user.profile?.location || "");
  const [website, setWebsite] = useState(user.profile?.website || "");
  const [github, setGithub] = useState(user.profile?.links?.github || "");
  const [twitter, setTwitter] = useState(user.profile?.links?.twitter || "");
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);
  const [showBannerUpload, setShowBannerUpload] = useState(false);
  const [avatarRef, setAvatarRef] = useState(user.profile?.avatarRef || "");
  const [bannerRef, setBannerRef] = useState(user.profile?.bannerRef || "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const p2p = useP2PContext();

  const updatePreviewUrl = useCallback((setter: Dispatch<SetStateAction<string | null>>, url: string | null) => {
    setter((prev) => {
      if (prev && prev !== url) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
  }, []);

  const createPreviewFromManifest = useCallback(async (
    manifest: Manifest,
    setter: Dispatch<SetStateAction<string | null>>
  ) => {
    if (!manifest.fileKey) {
      console.warn(`Manifest ${manifest.fileId} is missing an encryption key.`);
      return;
    }

    try {
      const fileKey = await importKeyRaw(manifest.fileKey);
      const blob = await decryptAndReassembleFile(manifest, fileKey);
      const url = URL.createObjectURL(blob);
      updatePreviewUrl(setter, url);
    } catch (error) {
      console.error(`Failed to build preview for ${manifest.fileId}:`, error);
      updatePreviewUrl(setter, null);
    }
  }, [updatePreviewUrl]);

  const loadPreviewById = useCallback(async (
    manifestId: string,
    setter: Dispatch<SetStateAction<string | null>>
  ) => {
    try {
      const manifest = await get("manifests", manifestId) as Manifest | undefined;
      if (!manifest) {
        updatePreviewUrl(setter, null);
        return;
      }
      await createPreviewFromManifest(manifest, setter);
    } catch (error) {
      console.error(`Failed to load manifest ${manifestId}:`, error);
      updatePreviewUrl(setter, null);
    }
  }, [createPreviewFromManifest, updatePreviewUrl]);

  const handleAvatarReady = (manifests: Manifest[]) => {
    if (manifests.length > 0) {
      const manifest = manifests[0];
      setAvatarRef(manifest.fileId);
      setShowAvatarUpload(false);
      createPreviewFromManifest(manifest, setAvatarPreview);
    }
  };

  const handleBannerReady = (manifests: Manifest[]) => {
    if (manifests.length > 0) {
      const manifest = manifests[0];
      setBannerRef(manifest.fileId);
      setShowBannerUpload(false);
      createPreviewFromManifest(manifest, setBannerPreview);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarRef("");
    updatePreviewUrl(setAvatarPreview, null);
  };

  const handleRemoveBanner = () => {
    setBannerRef("");
    updatePreviewUrl(setBannerPreview, null);
  };

  useEffect(() => {
    if (avatarRef) {
      loadPreviewById(avatarRef, setAvatarPreview);
    } else {
      updatePreviewUrl(setAvatarPreview, null);
    }
  }, [avatarRef, loadPreviewById, updatePreviewUrl]);

  useEffect(() => {
    if (bannerRef) {
      loadPreviewById(bannerRef, setBannerPreview);
    } else {
      updatePreviewUrl(setBannerPreview, null);
    }
  }, [bannerRef, loadPreviewById, updatePreviewUrl]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedUser: User = {
        ...user,
        displayName: displayName.trim() || user.username,
        profile: {
          ...user.profile,
          bio: bio.trim(),
          location: location.trim(),
          website: website.trim(),
          avatarRef: avatarRef || undefined,
          bannerRef: bannerRef || undefined,
          links: {
            ...user.profile?.links,
            github: github.trim(),
            twitter: twitter.trim(),
          },
        },
      };

      await put("users", updatedUser);
      
      // Update localStorage for current user
      localStorage.setItem("me", JSON.stringify(updatedUser));
      
      // Broadcast user update to P2P network
      if (p2p.isEnabled) {
        // Create a simplified user object for syncing (exclude private keys)
        const syncUser = {
          id: updatedUser.id,
          username: updatedUser.username,
          displayName: updatedUser.displayName,
          publicKey: updatedUser.publicKey,
          profile: updatedUser.profile,
          createdAt: new Date().toISOString()
        };
        // Note: broadcastUserUpdate will be added to P2PContext in next step
        if ('broadcastUserUpdate' in p2p) {
          (p2p as any).broadcastUserUpdate(syncUser);
        }
      }
      
      // Notify other components about profile update
      window.dispatchEvent(new Event("user-login"));
      
      toast.success("Profile updated");
      onSave(updatedUser);
    } catch (error) {
      console.error("Failed to save profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display uppercase tracking-[0.2em]">
            Edit Profile
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Avatar Upload */}
          <div className="space-y-3">
            <Label>Avatar</Label>
            <div className="flex flex-wrap gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-primary/30 bg-background/40">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No avatar selected
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowAvatarUpload((prev) => !prev)}
                    disabled={saving}
                  >
                    {showAvatarUpload ? "Cancel" : avatarRef ? "Change Avatar" : "Upload Avatar"}
                  </Button>
                  {avatarRef && (
                    <Button variant="ghost" onClick={handleRemoveAvatar} disabled={saving}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended: square image (PNG, JPG, or WEBP) up to 5MB.
                </p>
              </div>
            </div>
            {showAvatarUpload && (
              <FileUpload
                onFilesReady={handleAvatarReady}
                maxFiles={1}
                maxFileSize={5 * 1024 * 1024}
                acceptedTypes={["image/jpeg", "image/png", "image/webp"]}
              />
            )}
          </div>

          {/* Banner Upload */}
          <div className="space-y-3 border-t border-primary/10 pt-4">
            <Label>Profile Banner</Label>
            <div className="space-y-3">
              <div className="h-36 w-full overflow-hidden rounded-2xl border border-primary/30 bg-background/40">
                {bannerPreview ? (
                  <img src={bannerPreview} alt="Banner preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                    No banner selected
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowBannerUpload((prev) => !prev)}
                  disabled={saving}
                >
                  {showBannerUpload ? "Cancel" : bannerRef ? "Change Banner" : "Upload Banner"}
                </Button>
                {bannerRef && (
                  <Button variant="ghost" onClick={handleRemoveBanner} disabled={saving}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Recommended: wide image (PNG, JPG, or WEBP) up to 8MB.
              </p>
            </div>
            {showBannerUpload && (
              <FileUpload
                onFilesReady={handleBannerReady}
                maxFiles={1}
                maxFileSize={8 * 1024 * 1024}
                acceptedTypes={["image/jpeg", "image/png", "image/webp"]}
              />
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={user.username}
              maxLength={50}
            />
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself..."
              maxLength={500}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {bio.length}/500 characters
            </p>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="San Francisco, CA"
              maxLength={100}
            />
          </div>

          {/* Website */}
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          {/* Social Links */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-display uppercase tracking-[0.2em] text-sm">
              Social Links
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="github">GitHub Username</Label>
              <Input
                id="github"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="octocat"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twitter">Twitter Username</Label>
              <Input
                id="twitter"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="jack"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
