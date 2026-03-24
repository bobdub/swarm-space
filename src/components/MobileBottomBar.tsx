import { Link, useLocation } from "react-router-dom";
import { getMobileBottomBarItems } from "./navigationItems";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

export function MobileBottomBar() {
  const location = useLocation();
  const { user } = useAuth();
  const mobileBottomBarItems = getMobileBottomBarItems(Boolean(user));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,6%,0.92)] backdrop-blur-xl safe-area-bottom">
      <div className="flex items-center justify-around px-1 py-1.5">
        {mobileBottomBarItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[0.6rem] font-medium transition-colors duration-150",
                isActive
                  ? "text-[hsl(174,59%,56%)]"
                  : "text-foreground/45 active:text-foreground/70"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5 transition-colors duration-150",
                  isActive ? "text-[hsl(174,59%,56%)]" : "text-foreground/45"
                )}
              />
              <span className="uppercase tracking-wider">{item.label}</span>
              {isActive && (
                <span className="absolute -bottom-0 h-0.5 w-6 rounded-full bg-[hsl(174,59%,56%)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
