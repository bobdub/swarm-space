import { Link, useLocation } from "react-router-dom";
import { Home, Compass, Bell, User, Calendar, CheckSquare, Settings, Plus, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";

export function Navigation() {
  const location = useLocation();
  const user = getCurrentUser();
  
  const isActive = (path: string) => location.pathname === path;
  
  const navItems = [
    { icon: Home, label: "Home", path: "/" },
    { icon: Compass, label: "Explore", path: "/explore" },
    { icon: Bell, label: "Notifications", path: "/notifications" },
    { icon: Folder, label: "Files", path: "/files" },
    { icon: Calendar, label: "Planner", path: "/planner" },
    { icon: CheckSquare, label: "Tasks", path: "/tasks" },
  ];
  
  return (
    <nav className="fixed left-0 top-0 h-screen w-64 border-r border-border bg-card p-4 flex flex-col">
      <div className="mb-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
            <span className="text-lg font-bold">I</span>
          </div>
          <span className="text-xl font-bold">Imagination</span>
        </Link>
      </div>
      
      <div className="flex-1 space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
              isActive(item.path)
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </Link>
        ))}
        
        <Link
          to="/create"
          className="flex items-center gap-3 px-4 py-3 rounded-lg gradient-primary text-white font-medium shadow-glow hover:opacity-90 transition-opacity mt-4"
        >
          <Plus className="w-5 h-5" />
          <span>Create Post</span>
        </Link>
      </div>
      
      <div className="space-y-2 pt-4 border-t border-border">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
            isActive("/settings")
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </Link>
        
        {user && (
          <Link
            to={`/u/${user.username}`}
            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{user.displayName || user.username}</div>
              <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
            </div>
          </Link>
        )}
      </div>
    </nav>
  );
}
