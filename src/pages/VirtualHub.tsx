/**
 * VirtualHub — Per-project Brain universe (members only).
 *
 * The legacy grass disc + post-billboard hub has been replaced by a
 * per-project instance of the shared `BrainUniverseScene` (hollow Earth +
 * UQRC street + voice/chat/avatars). Access is gated by project membership;
 * non-members are redirected back to the project page with a toast.
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProject, isProjectMember } from "@/lib/projects";
import { getCurrentUser } from "@/lib/auth";
import type { Project } from "@/types";
import BrainUniverseScene from "@/components/brain/BrainUniverseScene";
import { useStreaming } from "@/hooks/useStreaming";
import { projectVariant } from "@/lib/brain/variants";

export default function VirtualHub() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { activeRoom } = useStreaming();
  const [project, setProject] = useState<Project | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) {
        navigate("/explore");
        return;
      }
      try {
        const [p, user] = await Promise.all([getProject(projectId), getCurrentUser()]);
        if (cancelled) return;
        if (!p) {
          navigate("/explore");
          return;
        }
        if (!user || !isProjectMember(p, user.id)) {
          toast.error("Only members can enter this universe.");
          navigate(`/projects/${projectId}`);
          return;
        }
        setProject(p);
        setAllowed(true);
      } catch (err) {
        console.error("[VirtualHub] load error", err);
        navigate(`/projects/${projectId ?? ""}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  if (loading || !allowed || !project) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // When a live room belongs to this project, bind voice/chat to it so
  // Promote-to-feed lines up with the active broadcast.
  const activeRoomId =
    activeRoom && (activeRoom.projectId === project.id || activeRoom.id === `brain-project-${project.id}`)
      ? activeRoom.id
      : undefined;
  const variant = projectVariant({
    project,
    activeRoomId,
    onLeave: () => navigate(`/projects/${project.id}`),
  });
  return <BrainUniverseScene variant={variant} />;
}
