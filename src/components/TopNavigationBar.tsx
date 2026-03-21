import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Search, Coins, PenSquare, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { primaryNavigationItems } from "@/components/navigationItems";
import { cn } from "@/lib/utils";
import { P2PStatusIndicator } from "./P2PStatusIndicator";
import { PeerConnectionManager } from "./PeerConnectionManager";
import { MobileNav } from "./MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";

const NAV_COLLAPSED_KEY = "nav-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function TopNavigationBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuth();
  const { balance } = useCreditBalance(user?.id || null);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(NAV_COLLAPSED_KEY, next ? "true" : "false"); } catch {}
  };

  const handleCreateClick = () => {
    const params = new URLSearchParams();
    params.set("tab", "posts");
    params.set("composer", "open");
    navigate(`/profile?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-0 pointer-events-none">
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-2 md:gap-3 border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.82)] px-4 md:px-6 shadow-[0_0_55px_hsla(326,71%,62%,0.28)] backdrop-blur-xl pointer-events-auto transition-all duration-300",
          collapsed ? "min-h-12 py-1.5" : "min-h-14 md:min-h-16 py-3 md:py-4"
        )}
      >
        {/* Mobile Menu */}
        <MobileNav />

        {/* Search Bar - Hidden when collapsed or on mobile */}
        {!collapsed && (
          <form onSubmit={handleSearch} className="hidden sm:flex flex-shrink-0 w-40 lg:w-56">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="h-8 pl-8 pr-3 border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,8%,0.6)] text-xs placeholder:text-foreground/30"
              />
            </div>
          </form>
        )}

        {/* Desktop Navigation Items */}
        <div className={cn(
          "hidden md:flex flex-1 flex-wrap items-center justify-center gap-1 content-center transition-all duration-300",
          collapsed && "gap-0.5"
        )}>
          {primaryNavigationItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-1.5 rounded-full border border-transparent text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.78)] hover:text-foreground whitespace-nowrap",
                collapsed
                  ? "px-2 py-1 text-[0.6rem]"
                  : "px-2.5 lg:px-3 py-1.5 text-[0.65rem] font-display uppercase tracking-[0.1em]",
                location.pathname === item.path
                  ? "border-[hsla(326,71%,62%,0.4)] bg-gradient-to-r from-[hsla(326,71%,62%,0.55)] to-[hsla(174,59%,56%,0.5)] text-foreground shadow-[0_0_40px_hsla(174,59%,56%,0.35)]"
                  : "",
              )}
            >
              <item.icon className={cn("text-[hsl(174,59%,56%)]", collapsed ? "h-3.5 w-3.5" : "h-4 w-4")} />
              {!collapsed && <span className="hidden md:inline">{item.label}</span>}
            </Link>
          ))}
        </div>

        {/* Spacer for mobile */}
        <div className="flex-1 md:hidden" />

        {/* Create Post Button */}
        {!collapsed && (
          <Button
            onClick={handleCreateClick}
            aria-label="Create a new post"
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] shadow-[0_10px_40px_hsla(326,71%,62%,0.35)] transition-transform hover:scale-[1.02]"
          >
            <PenSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Create</span>
          </Button>
        )}

        {/* Credit Balance */}
        {user && !collapsed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2 text-xs font-semibold hover:bg-primary/10"
          >
            <Coins className="h-3.5 w-3.5 text-secondary" />
            <span>{balance.toLocaleString()}</span>
          </Button>
        )}

        {/* P2P Status */}
        <div className="flex-shrink-0">
          <P2PStatusIndicator />
        </div>

        {/* Peer Connection Manager */}
        {!collapsed && (
          <div className="flex-shrink-0">
            <PeerConnectionManager />
          </div>
        )}

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          className="hidden md:flex h-7 w-7 flex-shrink-0 text-foreground/40 hover:text-foreground/70"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  );
}
