import { AchievementSigil } from "@/components/AchievementSigil";
import { useUserBadges } from "@/hooks/useUserBadges";
import { cn } from "@/lib/utils";

interface UserBadgeStripProps {
  userId?: string;
  size?: number;
  maxBadges?: number;
  className?: string;
}

export function UserBadgeStrip({ userId, size = 28, maxBadges = 3, className }: UserBadgeStripProps) {
  const badges = useUserBadges(userId);

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

