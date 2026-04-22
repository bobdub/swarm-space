import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarSelector } from "./AvatarSelector";
import { DeviceCheckStep } from "./DeviceCheckStep";
import {
  loadHubPrefs,
  saveHubPrefs,
  DEFAULT_AVATAR_ID,
} from "@/lib/virtualHub/avatars";
import { getProject, isProjectMember } from "@/lib/projects";
import { useAuthGate } from "@/hooks/useAuthGate";
import type { Project } from "@/types";
import { Lock } from "lucide-react";

interface VirtualHubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

type Step = "avatar" | "devices";

export function VirtualHubModal({ open, onOpenChange, projectId }: VirtualHubModalProps) {
  const navigate = useNavigate();
  const { user } = useAuthGate();
  const [step, setStep] = useState<Step>("avatar");
  const [avatarId, setAvatarId] = useState<string>(DEFAULT_AVATAR_ID);
  const [audioInputId, setAudioInputId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [memberCheckLoading, setMemberCheckLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    const prefs = loadHubPrefs();
    setAvatarId(prefs.avatarId);
    setAudioInputId(prefs.audioInputId);
    setAudioOutputId(prefs.audioOutputId);
    setStep("avatar");
    setPermissionGranted(false);
    setMemberCheckLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProject(projectId);
        if (!cancelled) setProject(p);
      } finally {
        if (!cancelled) setMemberCheckLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const isMember = useMemo(() => {
    if (!project || !user) return false;
    return isProjectMember(project, user.id);
  }, [project, user]);

  const handleJoin = () => {
    saveHubPrefs({ avatarId, audioInputId, audioOutputId });
    onOpenChange(false);
    navigate(`/projects/${projectId}/hub`);
  };

  const blocked = !user || (!memberCheckLoading && !isMember);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {!user
              ? "Sign in required"
              : !memberCheckLoading && !isMember
                ? "Members only"
                : step === "avatar"
                  ? "Choose your avatar"
                  : "Test your audio"}
          </DialogTitle>
          <DialogDescription>
            {!user
              ? "Create an account to enter this project's universe."
              : !memberCheckLoading && !isMember
                ? `Only members of ${project?.name ?? "this project"} can enter its universe.`
                : step === "avatar"
                  ? "Pick how you'll appear inside the project universe."
                  : "Verify your microphone and speakers before entering."}
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You need an account to step inside the creator's universe.
            </p>
          </div>
        ) : !memberCheckLoading && !isMember ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Request to join {project?.name ?? "this project"} on its project
              page to unlock the universe.
            </p>
          </div>
        ) : step === "avatar" ? (
          <AvatarSelector selectedId={avatarId} onSelect={setAvatarId} />
        ) : (
          <DeviceCheckStep
            audioInputId={audioInputId}
            audioOutputId={audioOutputId}
            onChange={(p) => {
              setAudioInputId(p.audioInputId);
              setAudioOutputId(p.audioOutputId);
            }}
            onPermissionGranted={setPermissionGranted}
          />
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          {!blocked && step === "devices" && (
            <Button type="button" variant="outline" onClick={() => setStep("avatar")}>
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {blocked ? "Close" : "Cancel"}
          </Button>
          {!user ? (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate("/auth");
              }}
            >
              Sign in
            </Button>
          ) : !memberCheckLoading && !isMember ? (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate(`/projects/${projectId}`);
              }}
            >
              Request to join
            </Button>
          ) : step === "avatar" ? (
            <Button type="button" onClick={() => setStep("devices")}>
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleJoin} disabled={!permissionGranted}>
              Enter universe
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
