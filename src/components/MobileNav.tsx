import { Menu, PenSquare } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { primaryNavigationItems } from "./navigationItems";
import { cn } from "@/lib/utils";
import { P2PStatusIndicator } from "./P2PStatusIndicator";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleCreateClick = () => {
    const params = new URLSearchParams();
    params.set("tab", "posts");
    params.set("composer", "open");
    navigate(`/profile?${params.toString()}`);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 bg-background/95 backdrop-blur-xl border-primary/20">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-display uppercase tracking-widest text-primary">
              Menu
            </h2>
          </div>

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

          <div className="mt-6">
            <Button
              onClick={handleCreateClick}
              className="w-full gap-2 rounded-full bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] uppercase tracking-[0.2em]"
            >
              <PenSquare className="h-4 w-4" />
              Create Post
            </Button>
          </div>

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
