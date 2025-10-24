import { Link, useLocation } from "react-router-dom";
import { User, Settings, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { primaryNavigationItems } from "@/components/navigationItems";
import { NotificationBadge } from "@/components/NotificationBadge";
import { Avatar } from "@/components/Avatar";

export function Navigation() {
  const location = useLocation();
  const user = getCurrentUser();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed left-0 top-0 flex h-screen w-64 flex-col overflow-hidden border-r border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,6%,0.88)] px-6 py-8 text-foreground shadow-[0_0_80px_hsla(326,71%,62%,0.28)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[hsla(326,71%,62%,0.28)] via-transparent to-transparent" />
        <div className="absolute -left-24 top-1/3 h-56 w-56 rounded-full bg-[hsla(174,59%,56%,0.18)] blur-[140px]" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[hsla(253,82%,2%,0.65)] to-transparent" />
      </div>

      <div className="relative z-10 mb-10 flex items-center gap-3">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-2xl border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.85)] px-4 py-3 text-[0.75rem] font-display uppercase tracking-[0.24em] text-foreground/80 transition-colors duration-200 hover:border-[hsla(326,71%,62%,0.38)] hover:bg-[hsla(245,70%,10%,0.92)] hover:text-foreground"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(326,71%,62%)] via-[hsla(326,71%,62%,0.85)] to-[hsl(174,59%,56%)] text-sm font-display text-[hsl(253,82%,6%)] shadow-[0_18px_40px_hsla(326,71%,62%,0.42)]">
            ◢◤
          </div>
          Imagination
        </Link>
      </div>

      <div className="relative z-10 flex-1 space-y-3">
        {primaryNavigationItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,8%,0.6)] px-4 py-3 text-sm text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.85)] hover:text-foreground",
              isActive(item.path)
                ? "border-[hsla(326,71%,62%,0.4)] bg-[hsla(245,70%,14%,0.9)] text-foreground shadow-[0_20px_55px_hsla(174,59%,56%,0.32)]"
                : "",
            )}
          >
            <div className="relative">
              <item.icon className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              {item.path === "/notifications" && <NotificationBadge />}
            </div>
            <span className="font-semibold tracking-[0.12em] uppercase">{item.label}</span>
          </Link>
        ))}

        <Link
          to="/create"
          className="mt-6 flex items-center gap-3 rounded-xl border border-[hsla(326,71%,62%,0.45)] bg-[hsla(253,82%,6%,0.82)] px-4 py-3 text-sm font-display uppercase tracking-[0.2em] text-[hsl(326,71%,62%)] shadow-[0_26px_70px_hsla(326,71%,62%,0.42)] transition-transform duration-200 hover:-translate-y-0.5 hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          <span>Launch Post</span>
        </Link>
      </div>

      <div className="relative z-10 space-y-3 border-t border-[hsla(174,59%,56%,0.18)] pt-6">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 rounded-xl border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,8%,0.6)] px-4 py-3 text-sm text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.85)] hover:text-foreground",
            isActive("/settings")
              ? "border-[hsla(326,71%,62%,0.4)] bg-[hsla(245,70%,14%,0.9)] text-foreground shadow-[0_16px_45px_hsla(326,71%,62%,0.3)]"
              : "",
          )}
        >
          <Settings className="h-5 w-5 text-[hsl(174,59%,56%)]" />
          <span className="font-semibold uppercase tracking-[0.12em]">Settings</span>
        </Link>

        {user && (
          <Link
            to={`/u/${user.username}`}
            className="flex items-center gap-3 rounded-xl border border-[hsla(174,59%,56%,0.16)] bg-[hsla(245,70%,10%,0.7)] px-4 py-3 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.85)]"
          >
            <Avatar
              avatarRef={user.profile?.avatarRef}
              username={user.username}
              displayName={user.displayName}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{user.displayName || user.username}</div>
              <div className="truncate text-[0.65rem] font-display uppercase tracking-[0.32em] text-foreground/55">
                @{user.username}
              </div>
            </div>
          </Link>
        )}
      </div>
    </nav>
  );
}
