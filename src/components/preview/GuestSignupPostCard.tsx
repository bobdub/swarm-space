import { Link } from "react-router-dom";
import { Pin, Sparkles, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { guestSignupHref } from "@/lib/preview/guestAccess";

/**
 * Pinned, post-styled prompt shown to guest nodes at the top of Explore,
 * inviting them to turn their temporary guest identity into an account.
 */
export function GuestSignupPostCard({ redirect = "/explore" }: { redirect?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[26px]" data-testid="guest-signup-post">
      <div className="absolute inset-0 rounded-[26px] bg-gradient-to-br from-[hsla(326,71%,62%,0.28)] via-transparent to-[hsla(174,59%,56%,0.28)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <Card className="relative rounded-[26px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-6 text-foreground shadow-[0_30px_90px_hsla(244,70%,5%,0.65)] backdrop-blur-2xl">
        <div className="flex gap-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)]">
            <Sparkles className="h-6 w-6 text-background" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-1.5">
              <p className="text-lg font-semibold tracking-[0.08em]">Swarm Space</p>
              <div className="flex items-center gap-2 text-[0.65rem] font-display uppercase tracking-[0.35em] text-foreground/55">
                <Pin className="h-3 w-3" />
                <span>Pinned</span>
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Create an account</h2>
              <p className="text-sm text-foreground/70">
                You're browsing as a guest. Sign up to keep your identity, post, comment, follow people, and earn credits on the mesh.
              </p>
            </div>
            <Button asChild className="gap-2">
              <Link to={guestSignupHref(redirect)}>
                <UserPlus className="h-4 w-4" />
                Sign up
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
