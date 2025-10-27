import { Calendar, Sparkles } from "lucide-react";
import { format } from "date-fns";

import type { AchievementDisplayItem } from "@/components/achievement-types";
import { Progress } from "@/components/ui/progress";

interface AchievementGalleryProps {
  achievements: AchievementDisplayItem[];
  isLoading?: boolean;
  emptyMessage?: string;
}

function formatUnlockDate(date: string | null | undefined): string | null {
  if (!date) return null;
  try {
    return format(new Date(date), "MMM d, yyyy");
  } catch (error) {
    console.warn("[AchievementGallery] Failed to format date", error);
    return null;
  }
}

export function AchievementGallery({
  achievements,
  isLoading,
  emptyMessage = "No achievements yet",
}: AchievementGalleryProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-40 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] backdrop-blur-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!achievements.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-12 text-center text-sm text-foreground/60 backdrop-blur-xl">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {achievements.map((achievement) => {
        const unlockDate = formatUnlockDate(achievement.unlockedAt ?? null);
        const progressValue = achievement.progress ?? undefined;

        return (
          <div
            key={achievement.id}
            className="relative overflow-hidden rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.55)] p-6 backdrop-blur-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-display uppercase tracking-[0.28em] text-foreground/60">
                  {achievement.category.toUpperCase()}
                </p>
                <h3 className="text-xl font-display uppercase tracking-[0.18em] text-foreground">
                  {achievement.title}
                </h3>
                <p className="text-sm text-foreground/70">{achievement.description}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
                  {achievement.creditReward !== undefined && achievement.creditReward > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-3 py-1">
                      <Sparkles className="h-3.5 w-3.5" />+{achievement.creditReward} credits
                    </span>
                  )}
                  {achievement.qcmImpact && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-3 py-1">
                      {achievement.qcmImpact}
                    </span>
                  )}
                </div>
              </div>

              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-[hsla(174,59%,56%,0.25)] ${
                  achievement.unlocked
                    ? "bg-[hsla(174,59%,56%,0.18)] text-[hsl(174,59%,76%)]"
                    : "bg-[hsla(245,70%,12%,0.45)] text-foreground/50"
                }`}
              >
                <Sparkles className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-6 space-y-3 text-sm text-foreground/60">
              {achievement.unlocked ? (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>
                    Unlocked{unlockDate ? ` on ${unlockDate}` : ""}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="font-display text-xs uppercase tracking-[0.3em] text-foreground/55">
                    {achievement.progressLabel ?? "Locked"}
                  </p>
                  <Progress
                    value={
                      progressValue !== undefined && progressValue !== null && !Number.isNaN(progressValue)
                        ? Math.min(progressValue * 100, 100)
                        : 0
                    }
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
