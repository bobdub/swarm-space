import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Boxes, Lock } from "lucide-react";
import { VirtualHubModal } from "./VirtualHubModal";
import { getProject, isProjectMember } from "@/lib/projects";
import { getCurrentUser } from "@/lib/auth";

interface OpenVirtualHubButtonProps {
  projectId: string;
  projectName?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
}

export function OpenVirtualHubButton({
  projectId,
  variant = "outline",
  size = "sm",
}: OpenVirtualHubButtonProps) {
  const [open, setOpen] = useState(false);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const navigate = useNavigate();

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

  if (isMember === false) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => navigate(`/projects/${projectId}`)}
        className="gap-2"
        title="Only project members can enter this universe"
      >
        <Lock className="h-4 w-4" />
        Members only · Request to join
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-2"
        disabled={isMember === null}
      >
        <Boxes className="h-4 w-4" />
        Enter Project Universe
      </Button>
      <VirtualHubModal open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}