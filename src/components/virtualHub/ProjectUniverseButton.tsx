import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Boxes, ChevronDown, Lock, Radio, Megaphone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProject, isProjectMember } from "@/lib/projects";
import { getCurrentUser } from "@/lib/auth";
import { useStreaming } from "@/hooks/useStreaming";
import { getPeerId } from "@/lib/p2p/manager";
import {
  ProjectUniversePreSpawnModal,
  type PreSpawnMode,
} from "@/components/brain/ProjectUniversePreSpawnModal";
import type { StreamRoom } from "@/types/streaming";
import { cn } from "@/lib/utils";

interface ProjectUniverseButtonProps {
  projectId: string;
  projectName?: string;
}

/**
 * Unified context-aware launcher that replaces the separate
 * "Enter Project Universe" + "Start live room" buttons. Adapts to whether
 * a live room exists for the project and whether the local user is the host.
 */
export function ProjectUniverseButton({ projectId, projectName }: ProjectUniverseButtonProps) {
  const navigate = useNavigate();
  const { roomsById, promoteRoomToPost } = useStreaming();
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [openMode, setOpenMode] = useState<PreSpawnMode | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [p, user] = await Promise.all([getProject(projectId), getCurrentUser()]);
        if (cancelled) return;
        setIsMember(!!(p && user && isProjectMember(p, user.id)));
      } catch {
        if (!cancelled) setIsMember(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Find the most recent active live room scoped to this project.
  const projectLiveRoom = useMemo<StreamRoom | null>(() => {
    const candidates = Object.values(roomsById).filter((room) => {
      if (room.context !== "project" || room.projectId !== projectId) return false;
      const ended = room.state === "ended" || room.broadcast?.state === "ended" || Boolean(room.endedAt);
      return !ended;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => new Date(b.startedAt ?? b.createdAt).getTime() - new Date(a.startedAt ?? a.createdAt).getTime());
    return candidates[0];
  }, [roomsById, projectId]);

  const localPeerId = (() => {
    try {
      return getPeerId();
    } catch {
      return null;
    }
  })();

  const isHost = Boolean(
    projectLiveRoom && localPeerId && projectLiveRoom.hostPeerId === localPeerId,
  );
  const isPromoted = Boolean(projectLiveRoom?.broadcast?.postId);

  if (isMember === false) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => navigate(`/projects/${projectId}`)}
        className="gap-2"
        title="Only project members can enter this universe"
      >
        <Lock className="h-4 w-4" />
        Members only
      </Button>
    );
  }

  const loading = isMember === null;
  const liveTitle = projectLiveRoom?.title ?? "live room";

  const openEnter = () => {
    setQuiet(false);
    setOpenMode("enter");
  };
  const openGoLive = () => {
    setQuiet(false);
    setOpenMode("go-live");
  };
  const openJoinLive = () => {
    setQuiet(false);
    setOpenMode("join-live");
  };
  const openEnterQuiet = () => {
    setQuiet(true);
    setOpenMode("join-live");
  };
  const returnToHostedRoom = () => {
    // Host already has the room active — go straight in (skip pre-spawn).
    navigate(`/projects/${projectId}/hub`);
  };

  const handlePromote = async () => {
    if (!projectLiveRoom || isPromoted || promoting) return;
    setPromoting(true);
    try {
      await promoteRoomToPost(projectLiveRoom.id);
      toast.success("Promoted to feed — open Explore to see it");
    } catch (error) {
      console.error("[ProjectUniverseButton] promote failed", error);
      toast.error(error instanceof Error ? error.message : "Couldn't promote to feed");
    } finally {
      setPromoting(false);
    }
  };

  // ----- State C: host has an active room -----
  if (projectLiveRoom && isHost) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={returnToHostedRoom}
            className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive-foreground opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive-foreground" />
            </span>
            <span className="max-w-[10rem] truncate">You're live · Return</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={isPromoted ? "outline" : "secondary"}
            onClick={() => void handlePromote()}
            disabled={isPromoted || promoting}
            className="gap-2"
          >
            {promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
            {isPromoted ? "Promoted ✓" : "Promote to feed"}
          </Button>
        </div>
        {openMode && (
          <ProjectUniversePreSpawnModal
            open
            onOpenChange={(next) => !next && setOpenMode(null)}
            projectId={projectId}
            mode={openMode}
            liveRoom={projectLiveRoom}
            quiet={quiet}
          />
        )}
      </>
    );
  }

  // ----- State B: live room exists, user is not host -----
  if (projectLiveRoom) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={openJoinLive}
            disabled={loading}
            className={cn(
              "gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            title={`Join "${liveTitle}"`}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive-foreground opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive-foreground" />
            </span>
            <span className="max-w-[10rem] truncate">LIVE · Join "{liveTitle}"</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openEnterQuiet}
            disabled={loading}
            className="gap-2"
          >
            <Boxes className="h-4 w-4" />
            Enter quietly
          </Button>
        </div>
        {openMode && (
          <ProjectUniversePreSpawnModal
            open
            onOpenChange={(next) => !next && setOpenMode(null)}
            projectId={projectId}
            mode={openMode}
            liveRoom={projectLiveRoom}
            quiet={quiet}
          />
        )}
      </>
    );
  }

  // ----- State A: no live room -----
  return (
    <>
      <div className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openEnter}
          disabled={loading}
          className="gap-2 rounded-r-none"
        >
          <Boxes className="h-4 w-4" />
          Enter Project Universe
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              className="rounded-l-none border-l-0 px-2"
              aria-label="More universe actions"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={openGoLive} className="gap-2">
              <Radio className="h-4 w-4" />
              Go live in this project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {openMode && (
        <ProjectUniversePreSpawnModal
          open
          onOpenChange={(next) => !next && setOpenMode(null)}
          projectId={projectId}
          mode={openMode}
          liveRoom={projectLiveRoom}
          quiet={quiet}
        />
      )}
    </>
  );
}