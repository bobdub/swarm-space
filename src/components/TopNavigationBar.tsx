import { Link, useLocation, useNavigate } from "react-router-dom";
import { Coins, PenSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { primaryNavigationItems } from "@/components/navigationItems";
import { cn } from "@/lib/utils";
import { P2PStatusIndicator } from "./P2PStatusIndicator";
import { MobileNav } from "./MobileNav";
import { AppHealthBadge } from "./AppHealthBadge";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";

export function TopNavigationBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, pending } = useCreditBalance(user?.id || null);

  const handleCreateClick = () => {
    const params = new URLSearchParams();
    params.set("tab", "posts");
    params.set("composer", "open");
    navigate(`/profile?${params.toString()}`);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-0 pointer-events-none">
      <div className="mx-auto flex max-w-6xl items-center gap-3 md:gap-4 border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.82)] px-4 md:px-6 min-h-16 md:min-h-[4.5rem] py-4 md:py-5 shadow-[0_0_55px_hsla(326,71%,62%,0.28)] backdrop-blur-xl pointer-events-auto">
        {/* Mobile Menu */}
        <MobileNav />

        {/* Desktop Navigation Items */}
        <div className="hidden md:flex flex-1 flex-wrap items-center justify-center gap-2 content-center">
          {primaryNavigationItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-2 rounded-full border border-transparent px-4 lg:px-5 py-2 text-sm font-display uppercase tracking-[0.15em] text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.78)] hover:text-foreground whitespace-nowrap",
                location.pathname === item.path &&
                  "border-[hsla(326,71%,62%,0.4)] bg-gradient-to-r from-[hsla(326,71%,62%,0.55)] to-[hsla(174,59%,56%,0.5)] text-foreground shadow-[0_0_40px_hsla(174,59%,56%,0.35)]"
              )}
            >
              <item.icon className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        {/* Spacer for mobile */}
        <div className="flex-1 md:hidden" />

        {/* Create Post Button */}
        <Button
          onClick={handleCreateClick}
          aria-label="Create a new post"
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.15em] shadow-[0_10px_40px_hsla(326,71%,62%,0.35)] transition-transform hover:scale-[1.02]"
        >
          <PenSquare className="h-4 w-4" />
          <span className="hidden sm:inline">Create</span>
        </Button>

        {/* Credit Balance */}
        {user && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="hidden sm:flex items-center gap-2 h-9 px-3 text-sm font-semibold hover:bg-primary/10"
            title={pending !== 0 ? `${pending > 0 ? '+' : ''}${pending} pending mesh confirmation` : undefined}
          >
            <Coins className="h-4 w-4 text-secondary" />
            <span>{balance.toLocaleString()}</span>
            {pending !== 0 && (
              <span className="ml-1 rounded-full bg-[hsla(326,71%,62%,0.18)] px-1.5 py-0.5 text-[10px] font-mono text-[hsl(326,71%,72%)]">
                {pending > 0 ? '+' : ''}{pending} ⏳
              </span>
            )}
          </Button>
        )}

        {/* P2P Status */}
        <div className="flex-shrink-0">
          <P2PStatusIndicator />
        </div>

        {/* App Health (UQRC-derived) */}
        <div className="flex-shrink-0">
          <AppHealthBadge />
        </div>
      </div>
    </header>
  );
}
