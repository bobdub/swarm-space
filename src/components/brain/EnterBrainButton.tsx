import { useNavigate, useLocation } from "react-router-dom";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useStreaming } from "@/hooks/useStreaming";

/**
 * Floating CTA → public Infinity lobby (/brain).
 * Hidden on Brain/hub/preview/auth routes, when no user is logged in,
 * and whenever a live room is active (BrainChatLauncher owns that slot).
 */
export function EnterBrainButton(): JSX.Element | null {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { activeRoom } = useStreaming();

  if (!user) return null;
  if (activeRoom) return null;

  const path = location.pathname;
  const isExcluded =
    path === "/brain" ||
    path === "/preview" ||
    path === "/auth" ||
    /^\/projects\/[^/]+\/hub$/.test(path);
  if (isExcluded) return null;

  return (
    <div className="fixed left-4 z-50 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4">
      <Button
        type="button"
        onClick={() => navigate("/brain")}
        className="h-11 gap-2 rounded-full px-3 sm:px-4 shadow-xl bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] text-foreground hover:scale-[1.02] transition-transform animate-pulse-soft"
        aria-label="Enter Brain — public Infinity lobby"
      >
        <Brain className="h-4 w-4" />
        <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider">
          Enter Brain
        </span>
      </Button>
    </div>
  );
}

export default EnterBrainButton;