import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { User } from "@/types";
import { put } from "@/lib/store";
import { toast } from "sonner";
import { FileUpload } from "./FileUpload";
import { Manifest } from "@/lib/fileEncryption";

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
  const [saving, setSaving] = useState(false);

  const handleAvatarReady = (manifests: Manifest[]) => {
    if (manifests.length > 0) {
      // Store avatar reference
      const avatarRef = manifests[0].fileId;
      toast.success("Avatar uploaded");
      setShowAvatarUpload(false);
    }
  };

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
          <div className="space-y-2">
            <Label>Avatar</Label>
            {showAvatarUpload ? (
              <FileUpload
                onFilesReady={handleAvatarReady}
                maxFiles={1}
                maxFileSize={5 * 1024 * 1024}
                acceptedTypes={["image/jpeg", "image/png", "image/webp"]}
              />
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowAvatarUpload(true)}
              >
                Upload New Avatar
              </Button>
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
