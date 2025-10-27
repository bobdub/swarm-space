import { Trophy, Lock } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AchievementDisplayItem } from "@/components/achievement-types";

interface AchievementBadgeGridProps {
  badges: AchievementDisplayItem[];
  isLoading?: boolean;
  maxBadges?: number;
  emptyMessage?: string;
}

const rarityColors: Record<NonNullable<AchievementDisplayItem["rarity"]>, string> = {
  common: "from-[hsla(245,70%,16%,0.8)] to-[hsla(245,70%,12%,0.6)]",
  uncommon: "from-[hsla(174,59%,56%,0.35)] to-[hsla(245,70%,12%,0.6)]",
  rare: "from-[hsla(204,88%,62%,0.55)] to-[hsla(245,70%,14%,0.7)]",
  epic: "from-[hsla(283,86%,70%,0.6)] to-[hsla(245,70%,14%,0.75)]",
  legendary: "from-[hsla(42,96%,62%,0.65)] to-[hsla(245,70%,14%,0.75)]",
};

export function AchievementBadgeGrid({
  badges,
  isLoading,
  maxBadges = 4,
  emptyMessage = "No badges yet",
}: AchievementBadgeGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: maxBadges }).map((_, index) => (
          <div
            key={index}
            className="h-24 rounded-3xl border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.55)]/60 animate-pulse"
          />
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
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {visible.map((badge) => {
        const gradient = badge.rarity ? rarityColors[badge.rarity] : rarityColors.common;
        const unlockedSince = badge.unlockedAt ? formatDistanceToNowStrict(new Date(badge.unlockedAt)) : null;
        return (
          <Tooltip key={badge.id}>
            <TooltipTrigger asChild>
              <div
                className={`group relative overflow-hidden rounded-3xl border border-[hsla(174,59%,56%,0.25)] bg-gradient-to-br ${gradient} p-4 backdrop-blur-xl transition-transform hover:-translate-y-1`}
              >
                <div className="absolute inset-0 bg-[hsla(245,70%,8%,0.45)] opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-display uppercase tracking-[0.28em] text-foreground/70">
                        {badge.category.toUpperCase()}
                      </p>
                      <h3 className="mt-1 font-display text-base uppercase tracking-[0.18em] text-foreground">
                        {badge.title}
                      </h3>
                    </div>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-foreground ${
                        badge.unlocked
                          ? "bg-[hsla(174,59%,56%,0.18)] text-[hsl(174,59%,76%)]"
                          : "bg-[hsla(245,70%,12%,0.55)] text-foreground/50"
                      }`}
                    >
                      {badge.unlocked ? <Trophy className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-foreground/70">
                    {badge.unlocked ? (
                      <span className="font-display uppercase tracking-[0.28em] text-[hsl(174,59%,76%)]">
                        Unlocked{unlockedSince ? ` • ${unlockedSince} ago` : ""}
                      </span>
                    ) : (
                      <span className="font-display uppercase tracking-[0.28em] text-foreground/55">
                        {badge.progressLabel ?? "Locked"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-xs text-left">
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
