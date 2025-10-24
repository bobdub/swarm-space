import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Search, Coins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { primaryNavigationItems } from "@/components/navigationItems";
import { cn } from "@/lib/utils";
import { P2PStatusIndicator } from "./P2PStatusIndicator";
import { MobileNav } from "./MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { useCreditBalance } from "@/hooks/useCreditBalance";

export function TopNavigationBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuth();
  const { balance } = useCreditBalance(user?.id || null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  return (
    <div className="sticky top-0 z-30 mb-6 md:mb-12 px-3 md:px-6 pt-3 md:pt-6">
      <div className="mx-auto flex h-14 md:h-16 w-full max-w-5xl items-center gap-2 md:gap-3 rounded-full border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.82)] px-2 md:px-3 shadow-[0_0_55px_hsla(326,71%,62%,0.28)] backdrop-blur-xl">
        
        {/* Mobile Menu */}
        <MobileNav />

        {/* Search Bar - Hidden on mobile, shown on tablet+ */}
        <form onSubmit={handleSearch} className="hidden sm:flex flex-shrink-0 w-48 lg:w-64">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="h-9 pl-9 pr-3 border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,8%,0.6)] text-sm placeholder:text-foreground/30"
            />
          </div>
        </form>

        {/* Desktop Navigation Items - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 flex-1 overflow-x-auto">
          {primaryNavigationItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-2 rounded-full border border-transparent px-3 lg:px-4 py-2 text-[0.75rem] font-display uppercase tracking-[0.18em] text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.78)] hover:text-foreground whitespace-nowrap",
                location.pathname === item.path
                  ? "border-[hsla(326,71%,62%,0.4)] bg-gradient-to-r from-[hsla(326,71%,62%,0.55)] to-[hsla(174,59%,56%,0.5)] text-foreground shadow-[0_0_40px_hsla(174,59%,56%,0.35)]"
                  : "",
              )}
            >
              <item.icon className="h-4 w-4 text-[hsl(174,59%,56%)]" />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          ))}
        </div>

        {/* Spacer for mobile */}
        <div className="flex-1 md:hidden" />

        {/* Credit Balance */}
        {user && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="hidden sm:flex items-center gap-2 h-9 px-3 text-xs font-semibold hover:bg-primary/10"
          >
            <Coins className="h-4 w-4 text-secondary" />
            <span>{balance.toLocaleString()}</span>
          </Button>
        )}

        {/* P2P Status */}
        <div className="flex-shrink-0">
          <P2PStatusIndicator />
        </div>
      </div>
    </div>
  );
}
