import { formatDistanceToNowStrict } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AchievementDisplayItem } from "@/components/achievement-types";
import { AchievementSigil } from "@/components/AchievementSigil";
import { cn } from "@/lib/utils";

interface AchievementBadgeGridProps {
  badges: AchievementDisplayItem[];
  isLoading?: boolean;
  maxBadges?: number;
  emptyMessage?: string;
}

const rarityStrapGradients: Record<NonNullable<AchievementDisplayItem["rarity"]>, string> = {
  common: "linear-gradient(180deg, hsla(174,59%,56%,0.85) 0%, hsla(245,70%,18%,0.92) 100%)",
  uncommon: "linear-gradient(180deg, hsla(165,75%,65%,0.85) 0%, hsla(245,70%,20%,0.92) 100%)",
  rare: "linear-gradient(180deg, hsla(202,80%,66%,0.88) 0%, hsla(245,70%,22%,0.92) 100%)",
  epic: "linear-gradient(180deg, hsla(285,72%,72%,0.9) 0%, hsla(245,70%,24%,0.92) 100%)",
  legendary: "linear-gradient(180deg, hsla(42,96%,62%,0.92) 0%, hsla(245,70%,24%,0.95) 100%)",
};

const lockedStrapGradient = "linear-gradient(180deg, hsla(245,40%,28%,0.6) 0%, hsla(245,40%,18%,0.75) 100%)";

export function AchievementBadgeGrid({
  badges,
  isLoading,
  maxBadges = 4,
  emptyMessage = "No badges yet",
}: AchievementBadgeGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {Array.from({ length: maxBadges }).map((_, index) => (
          <div key={index} className="flex flex-col items-center gap-3">
            <div className="relative flex flex-col items-center">
              <div className="absolute -top-6 h-10 w-16 rounded-b-[18px] bg-[hsla(245,40%,24%,0.45)]" />
              <div className="h-[4.5rem] w-[4.5rem] rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.55)]/60 animate-pulse" />
            </div>
            <div className="h-3 w-20 rounded-full bg-[hsla(245,40%,24%,0.35)] animate-pulse" />
            <div className="h-3 w-16 rounded-full bg-[hsla(245,40%,24%,0.25)] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  const ordered = [...badges].sort((a, b) => {
    if (a.unlocked === b.unlocked) {
      const aTime = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
      const bTime = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
      return bTime - aTime;
    }
    return a.unlocked ? -1 : 1;
  });

  const visible = ordered.slice(0, maxBadges);

  if (!visible.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-10 text-center text-sm text-foreground/60 backdrop-blur-xl">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
      {visible.map((badge) => {
        const rarityKey = badge.rarity ?? "common";
        const strapGradient = badge.unlocked
          ? rarityStrapGradients[rarityKey]
          : lockedStrapGradient;
        const unlockedSince = badge.unlockedAt ? formatDistanceToNowStrict(new Date(badge.unlockedAt)) : null;

        return (
          <Tooltip key={badge.id}>
            <TooltipTrigger asChild>
              <div
                tabIndex={0}
                className={cn(
                  "group relative flex flex-col items-center rounded-3xl p-4 text-center transition-transform",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[hsla(174,59%,66%,0.55)]",
                  badge.unlocked ? "text-foreground" : "text-foreground/70",
                  "hover:-translate-y-1"
                )}
              >
                <div className="relative flex flex-col items-center">
                  <div
                    className="pointer-events-none absolute -top-6 h-10 w-16 rounded-b-[18px] opacity-95 transition-opacity group-hover:opacity-100"
                    style={{ background: strapGradient }}
                  />
                  <AchievementSigil
                    badge={badge}
                    size={72}
                    className={cn(
                      "transition-transform duration-300",
                      "shadow-[0_18px_34px_rgba(10,8,30,0.45)]",
                      "group-hover:scale-105"
                    )}
                  />
                </div>

                <div className="mt-4 space-y-1">
                  <p className="text-[0.65rem] font-display uppercase tracking-[0.36em] text-foreground/55">
                    {badge.category.toUpperCase()}
                  </p>
                  <p className="font-semibold text-sm leading-tight text-foreground">
                    {badge.title}
                  </p>
                  {badge.unlocked ? (
                    <p className="text-xs text-foreground/60">
                      Unlocked{unlockedSince ? ` • ${unlockedSince} ago` : ""}
                    </p>
                  ) : (
                    <p className="text-xs font-display uppercase tracking-[0.3em] text-foreground/45">
                      {badge.progressLabel ?? "Locked"}
                    </p>
                  )}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" className="max-w-xs text-left">
              <p className="font-medium text-foreground">{badge.title}</p>
              <p className="mt-1 text-xs text-foreground/70">{badge.description}</p>
              <div className="mt-2 space-y-1 text-xs text-foreground/60">
                {badge.creditReward !== undefined && badge.creditReward > 0 && (
                  <p>Reward: +{badge.creditReward} credits</p>
                )}
                {badge.qcmImpact && <p>QCM Impact: {badge.qcmImpact}</p>}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
