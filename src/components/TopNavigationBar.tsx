import { Link, useLocation } from "react-router-dom";

import { primaryNavigationItems } from "@/components/navigationItems";
import { cn } from "@/lib/utils";

export function TopNavigationBar() {
  const location = useLocation();

  return (
    <div className="sticky top-0 z-30 mb-12 px-6 pt-6">
      <div className="mx-auto flex h-16 w-full max-w-4xl items-center gap-2 overflow-x-auto rounded-full border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,6%,0.82)] px-3 shadow-[0_0_55px_hsla(326,71%,62%,0.28)] backdrop-blur-xl">
        {primaryNavigationItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-2 rounded-full border border-transparent px-4 py-2 text-[0.75rem] font-display uppercase tracking-[0.18em] text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,12%,0.78)] hover:text-foreground",
              location.pathname === item.path
                ? "border-[hsla(326,71%,62%,0.4)] bg-gradient-to-r from-[hsla(326,71%,62%,0.55)] to-[hsla(174,59%,56%,0.5)] text-foreground shadow-[0_0_40px_hsla(174,59%,56%,0.35)]"
                : "",
            )}
          >
            <item.icon className="h-4 w-4 text-[hsl(174,59%,56%)]" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
