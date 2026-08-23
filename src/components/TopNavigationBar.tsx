import { useLocation, useNavigate } from "react-router-dom";
import { Bell, Coins, PenSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { P2PStatusIndicator } from "./P2PStatusIndicator";
import { MobileNav } from "./MobileNav";
import { AppHealthBadge } from "./AppHealthBadge";
import { NotificationBadge } from "./NotificationBadge";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { MetaMaskConnectButton } from "./wallet/MetaMaskConnectButton";


export function TopNavigationBar() {
  const navigate = useNavigate();

  const { user } = useAuth();
  const { balance, pending } = useCreditBalance(user?.id || null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Publish the real header height so page content always clears it,
  // even when the bar grows taller at mid widths.
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) document.documentElement.style.setProperty("--app-header-h", `${Math.round(h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleCreateClick = () => {
    const params = new URLSearchParams();
    params.set("tab", "posts");
    params.set("composer", "open");
    navigate(`/profile?${params.toString()}`);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-2 sm:px-3 lg:px-4 pt-2 pointer-events-none">
      <div
        ref={barRef}
        className="mx-auto flex w-full max-w-7xl 2xl:max-w-[1600px] min-w-0 items-center gap-2 rounded-2xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.82)] px-2 sm:px-3 md:px-4 min-h-16 md:min-h-[4.5rem] py-3 md:py-4 shadow-[0_0_55px_hsla(326,71%,62%,0.28)] backdrop-blur-xl pointer-events-auto"
      >
        {/* Expand menu — all navigation lives here */}
        <MobileNav />

        <div className="flex-1" />

        {/* Create Post Button */}
        <Button
          onClick={handleCreateClick}
          aria-label="Create a new post"
          className="flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] px-3 sm:px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.15em] shadow-[0_10px_40px_hsla(326,71%,62%,0.35)] transition-transform hover:scale-[1.02]"
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
            className="hidden sm:flex shrink-0 items-center gap-2 h-9 px-3 text-sm font-semibold hover:bg-primary/10"
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

        {/* Alerts */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/notifications")}
          aria-label="Alerts"
          title="Alerts"
          className="relative shrink-0 hover:bg-primary/10"
        >
          <Bell className="h-4 w-4 text-secondary" />
          <NotificationBadge />
        </Button>

        {/* P2P Status */}
        <div className="flex-shrink-0">
          <P2PStatusIndicator />
        </div>

        {/* Wallet connect (MetaMask) */}
        <div className="flex-shrink-0">
          <MetaMaskConnectButton iconOnly />
        </div>


        {/* App Health (UQRC-derived) */}
        <div className="hidden lg:block min-w-0 shrink overflow-hidden whitespace-nowrap [&_*]:whitespace-nowrap [&_*]:truncate">
          <AppHealthBadge />
        </div>
      </div>
    </header>
  );
}
