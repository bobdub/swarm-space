import { useMemo, useState } from "react";
import type { ComponentProps } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useStreaming } from "@/hooks/useStreaming";
import type { StreamRoom, StreamVisibility } from "@/types/streaming";

interface ProjectOption {
  id: string;
  name: string;
}

interface StartLiveRoomButtonProps {
  label?: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  projectId?: string | null;
  projectName?: string;
  projectOptions?: ProjectOption[];
  initialProjectId?: string | null;
  defaultVisibility?: StreamVisibility;
  defaultTitle?: string;
  disabled?: boolean;
  onRoomCreated?: (room: StreamRoom) => void;
}

type TargetSelection = "profile" | `project:${string}`;

const VISIBILITY_OPTIONS: { value: StreamVisibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "followers", label: "Followers" },
  { value: "invite-only", label: "Invite Only" },
];

export function StartLiveRoomButton({
  label = "Start live room",
  className,
  variant = "secondary",
  size = "sm",
  projectId,
  projectName,
  projectOptions,
  initialProjectId,
  defaultVisibility = "followers",
  defaultTitle = "",
  disabled,
  onRoomCreated,
}: StartLiveRoomButtonProps) {
  const {
    isStreamingEnabled,
    status,
    startRoom,
    connect,
  } = useStreaming();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [visibility, setVisibility] = useState<StreamVisibility>(defaultVisibility);
  const mergedProjectOptions = useMemo(() => {
    const options = [...(projectOptions ?? [])];
    if (projectId && !options.some((option) => option.id === projectId)) {
      options.push({ id: projectId, name: projectName ?? "Project" });
    }
    return options;
  }, [projectId, projectName, projectOptions]);

  const initialTarget = useMemo<TargetSelection>(() => {
    if (projectId) {
      return `project:${projectId}`;
    }
    if (initialProjectId) {
      return `project:${initialProjectId}`;
    }
    return "profile";
  }, [projectId, initialProjectId]);

  const [target, setTarget] = useState<TargetSelection>(initialTarget);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isStreamingEnabled) {
      toast.error("Streaming is disabled in this environment");
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Please enter a room title");
      return;
    }

    const contextValue = target.startsWith("project:")
      ? ((): { context: "project"; projectId: string } | null => {
          const targetProjectId = target.slice("project:".length);
          if (!targetProjectId) {
            return null;
          }
          return { context: "project", projectId: targetProjectId };
        })()
      : { context: "profile" as const };

    if (!contextValue) {
      toast.error("Please choose a project for this room");
      return;
    }

    setIsSubmitting(true);
    try {
      await connect();
      const room = await startRoom({
        ...contextValue,
        title: trimmedTitle,
        visibility,
      });
      toast.success(`Live room "${room.title}" created`);
      onRoomCreated?.(room);
      setOpen(false);
    } catch (error) {
      console.error("[StartLiveRoomButton] Failed to start room", error);
      toast.error(error instanceof Error ? error.message : "Failed to start live room");
    } finally {
      setIsSubmitting(false);
    }
  };

  const streamingUnavailable = !isStreamingEnabled || disabled;
  const showProjectSelector = mergedProjectOptions.length > 0;
  const currentStatusLabel =
    status === "connecting"
      ? "Connecting…"
      : status === "error"
        ? "Connection error"
        : status === "connected"
          ? "Connected"
          : "Idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!streamingUnavailable) {
          setOpen(nextOpen);
          if (nextOpen) {
            setTitle(defaultTitle);
            setVisibility(defaultVisibility);
            setTarget(initialTarget);
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          disabled={streamingUnavailable || status === "connecting"}
        >
          {status === "connecting" ? "Starting…" : label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle>Start a live room</DialogTitle>
            <DialogDescription>
              Launch a live audio/video room and invite peers in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="streaming-title">Room title</Label>
            <Input
              id="streaming-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Team sync"
              autoFocus
              required
            />
          </div>

          {showProjectSelector ? (
            <div className="space-y-2">
              <Label htmlFor="streaming-context">Where should this room appear?</Label>
              <Select
                value={target}
                onValueChange={(next) => setTarget(next as TargetSelection)}
              >
                <SelectTrigger id="streaming-context">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profile">My profile</SelectItem>
                  {mergedProjectOptions.map((option) => (
                    <SelectItem key={option.id} value={`project:${option.id}`}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="streaming-visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(next) => setVisibility(next as StreamVisibility)}
            >
              <SelectTrigger id="streaming-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-foreground/60">Status: {currentStatusLabel}</p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
