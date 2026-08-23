import { Menu } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { primaryNavigationItems } from "./navigationItems";
import { cn } from "@/lib/utils";
import { P2PStatusIndicator } from "./P2PStatusIndicator";
import { Avatar } from "./Avatar";
import { useAuth } from "@/hooks/useAuth";

/**
 * AppMenu — the single expandable menu used on every screen size.
 * Profile card on top, then Explore → Brain → Settings → Node → Wallet.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu" className="shrink-0">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 bg-background/95 backdrop-blur-xl border-primary/20">
        <div className="flex flex-col h-full">
          {/* Profile card */}
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className={cn(
              "mb-6 mt-2 flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200",
              location.pathname === "/profile"
                ? "border-primary/40 bg-gradient-to-r from-primary/20 to-secondary/20"
                : "border-primary/20 hover:border-primary/40 hover:bg-primary/10"
            )}
          >
            <Avatar
              size="sm"
              avatarRef={user?.profile?.avatarRef}
              username={user?.username}
              displayName={user?.displayName}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {user?.displayName || user?.username || "Guest"}
              </p>
              <p className="truncate text-xs text-foreground/60">
                {user ? `@${user.username}` : "Not signed in"}
              </p>
            </div>
          </Link>

          {/* Navigation Items */}
          <nav className="flex-1 space-y-2">
            {primaryNavigationItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-transparent px-4 py-3 text-sm font-medium transition-all duration-200",
                  location.pathname === item.path
                    ? "border-primary/40 bg-gradient-to-r from-primary/20 to-secondary/20 text-foreground"
                    : "text-foreground/70 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
                )}
              >
                <item.icon className="h-5 w-5 text-secondary" />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Footer - P2P Status */}
          <div className="mt-auto pt-4 border-t border-primary/20">
            <div className="flex items-center justify-between px-2">
              <span className="text-xs text-foreground/60 uppercase tracking-wider">
                P2P Network
              </span>
              <P2PStatusIndicator />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export const AppMenu = MobileNav;
