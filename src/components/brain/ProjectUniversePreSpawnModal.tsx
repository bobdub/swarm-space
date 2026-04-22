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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { AvatarSelector } from "@/components/virtualHub/AvatarSelector";
import { DeviceCheckStep } from "@/components/virtualHub/DeviceCheckStep";
import {
  loadHubPrefs,
  saveHubPrefs,
  DEFAULT_AVATAR_ID,
} from "@/lib/virtualHub/avatars";
import { getProject, isProjectMember } from "@/lib/projects";
import { useAuthGate } from "@/hooks/useAuthGate";
import { useStreaming } from "@/hooks/useStreaming";
import type { Project } from "@/types";
import type { StreamRoom, StreamVisibility } from "@/types/streaming";

export type PreSpawnMode = "enter" | "go-live" | "join-live";

interface ProjectUniversePreSpawnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  mode: PreSpawnMode;
  /** When mode is "join-live", the existing room being joined. */
  liveRoom?: StreamRoom | null;
  /** Skip auto-joining voice/video for "Enter quietly" path. */
  quiet?: boolean;
}

type Step = "avatar" | "devices" | "live-details";

const VISIBILITY_OPTIONS: { value: StreamVisibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "followers", label: "Followers" },
  { value: "invite-only", label: "Invite Only" },
];

/**
 * Unified pre-spawn gate that merges VirtualHubModal (avatar + mic) with the
 * StartLiveRoomButton flow (title + visibility). One dialog covers all entry
 * paths into a project's universe so members never see two stacked modals.
 */
export function ProjectUniversePreSpawnModal({
  open,
  onOpenChange,
  projectId,
  mode,
  liveRoom,
  quiet,
}: ProjectUniversePreSpawnModalProps) {
  const navigate = useNavigate();
  const { user } = useAuthGate();
  const { isStreamingEnabled, connect, startRoom, promoteRoomToPost, joinRoom } = useStreaming();

  const [step, setStep] = useState<Step>("avatar");
  const [avatarId, setAvatarId] = useState<string>(DEFAULT_AVATAR_ID);
  const [audioInputId, setAudioInputId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [memberCheckLoading, setMemberCheckLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<StreamVisibility>("public");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prefs = loadHubPrefs();
    setAvatarId(prefs.avatarId);
    setAudioInputId(prefs.audioInputId);
    setAudioOutputId(prefs.audioOutputId);
    setStep("avatar");
    setPermissionGranted(false);
    setMemberCheckLoading(true);
    setSubmitting(false);
    setTitle("");
    setVisibility("public");

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

  const blocked = !user || (!memberCheckLoading && !isMember);

  const persistPrefs = () => {
    saveHubPrefs({
      avatarId,
      audioInputId,
      audioOutputId,
      infinityVoice: loadHubPrefs().infinityVoice ?? true,
    });
  };

  const enterUniverse = () => {
    persistPrefs();
    onOpenChange(false);
    navigate(`/projects/${projectId}/hub`);
  };

  const handleJoinLive = async () => {
    if (!liveRoom) return;
    setSubmitting(true);
    try {
      if (!quiet) {
        await connect();
        await joinRoom(liveRoom.id);
      }
      enterUniverse();
    } catch (error) {
      console.error("[ProjectUniversePreSpawn] join failed", error);
      toast.error(error instanceof Error ? error.message : "Couldn't join live room");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoLive = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Please enter a room title");
      return;
    }
    if (!isStreamingEnabled) {
      toast.error("Streaming is disabled in this environment");
      return;
    }
    setSubmitting(true);
    try {
      await connect();
      const room = await startRoom({
        context: "project",
        projectId,
        title: trimmed,
        visibility,
      });

      if (room.visibility === "public") {
        try {
          await promoteRoomToPost(room.id);
          toast.success(`"${room.title}" posted to feed — open Explore to see it`);
        } catch (promoteError) {
          console.error("[ProjectUniversePreSpawn] promote failed", promoteError);
          toast.success(`Live room "${room.title}" created`);
        }
      } else {
        toast.success(`Live room "${room.title}" created (unlisted)`);
      }

      enterUniverse();
    } catch (error) {
      console.error("[ProjectUniversePreSpawn] start room failed", error);
      toast.error(error instanceof Error ? error.message : "Failed to start live room");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrimary = () => {
    if (mode === "enter") {
      enterUniverse();
    } else if (mode === "join-live") {
      void handleJoinLive();
    } else {
      void handleGoLive();
    }
  };

  const titles: Record<Step, string> = {
    avatar: "Choose your avatar",
    devices: "Test your mic + speakers",
    "live-details": "Set up the live room",
  };
  const descriptions: Record<Step, string> = {
    avatar: "Pick how you'll appear inside the project universe.",
    devices: "Voice chat with everyone in the universe runs over P2P.",
    "live-details": "Title and visibility for your broadcast.",
  };

  const renderBlocked = () => (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Lock className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {!user
          ? "You need an account to step inside this project's universe."
          : `Only members of ${project?.name ?? "this project"} can enter its universe.`}
      </p>
    </div>
  );

  const advanceFromAvatar = () => setStep("devices");
  const advanceFromDevices = () => {
    if (mode === "go-live") setStep("live-details");
    else handlePrimary();
  };

  const primaryLabel = (() => {
    if (step === "avatar") return "Continue";
    if (step === "devices") return mode === "go-live" ? "Continue" : mode === "join-live" ? (quiet ? "Enter quietly" : "Join live room") : "Enter universe";
    return submitting ? "Going live…" : "Go live";
  })();

  const primaryDisabled =
    submitting ||
    (step === "devices" && !permissionGranted) ||
    (step === "live-details" && !title.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {!user
              ? "Sign in required"
              : !memberCheckLoading && !isMember
                ? "Members only"
                : titles[step]}
          </DialogTitle>
          <DialogDescription>
            {!user
              ? "Create an account to enter this project's universe."
              : !memberCheckLoading && !isMember
                ? `Only members of ${project?.name ?? "this project"} can enter its universe.`
                : descriptions[step]}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          renderBlocked()
        ) : step === "avatar" ? (
          <AvatarSelector selectedId={avatarId} onSelect={setAvatarId} />
        ) : step === "devices" ? (
          <DeviceCheckStep
            audioInputId={audioInputId}
            audioOutputId={audioOutputId}
            onChange={(p) => {
              setAudioInputId(p.audioInputId);
              setAudioOutputId(p.audioOutputId);
            }}
            onPermissionGranted={setPermissionGranted}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="prespawn-title">Room title</Label>
              <Input
                id="prespawn-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Team sync"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prespawn-visibility">Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as StreamVisibility)}>
                <SelectTrigger id="prespawn-visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          {!blocked && step !== "avatar" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(step === "live-details" ? "devices" : "avatar")}
              disabled={submitting}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {blocked ? (
            !user ? (
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate("/auth");
                }}
              >
                Sign in
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/projects/${projectId}`);
                }}
              >
                Request to join
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={
                step === "avatar"
                  ? advanceFromAvatar
                  : step === "devices"
                    ? advanceFromDevices
                    : handlePrimary
              }
              disabled={primaryDisabled}
            >
              {primaryLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}