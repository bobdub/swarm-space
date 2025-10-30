import { AchievementSigil } from "@/components/AchievementSigil";
import { useUserBadges } from "@/hooks/useUserBadges";
import { cn } from "@/lib/utils";
import type { PostBadgeSnapshot } from "@/types";

interface UserBadgeStripProps {
  userId?: string;
  size?: number;
  maxBadges?: number;
  className?: string;
  fallbackBadgeSnapshots?: PostBadgeSnapshot[];
}

export function UserBadgeStrip({
  userId,
  size = 28,
  maxBadges = 3,
  className,
  fallbackBadgeSnapshots,
}: UserBadgeStripProps) {
  const badges = useUserBadges(userId, { fallbackUnlockedBadges: fallbackBadgeSnapshots });

  if (!userId || !badges || badges.length === 0) {
    return null;
  }

  const visibleBadges = badges.slice(0, maxBadges);

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label={`Unlocked badges for ${userId}`}
      role="list"
    >
      {visibleBadges.map((badge) => (
        <div key={badge.id} role="listitem" title={badge.title} className="relative">
          <AchievementSigil badge={badge} size={size} className="shadow-none" />
          <span className="sr-only">{badge.title}</span>
        </div>
      ))}
    </div>
  );
}

