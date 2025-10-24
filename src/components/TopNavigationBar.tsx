import { Link, useLocation } from "react-router-dom";
import { primaryNavigationItems } from "@/components/navigationItems";
import { cn } from "@/lib/utils";

export function TopNavigationBar() {
  const location = useLocation();

  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 mb-6">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 overflow-x-auto px-6">
        {primaryNavigationItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              location.pathname === item.path
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
