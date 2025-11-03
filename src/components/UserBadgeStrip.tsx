import type { ReactNode } from "react";

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
  customItems?: ReactNode[];
  showWhenEmpty?: boolean;
}

export function UserBadgeStrip({
  userId,
  size = 28,
  maxBadges = 3,
  className,
  fallbackBadgeSnapshots,
  customItems,
  showWhenEmpty = false,
}: UserBadgeStripProps) {
  const badges = useUserBadges(userId, { fallbackUnlockedBadges: fallbackBadgeSnapshots });

  const hasCustomItems = Boolean(customItems && customItems.length > 0);
  const badgeList = badges ?? [];

  if (!userId && !hasCustomItems && !showWhenEmpty) {
    return null;
  }

  if (!hasCustomItems && badgeList.length === 0 && !showWhenEmpty) {
    return null;
  }

  const visibleBadges = badgeList.slice(0, maxBadges);

  const ariaLabel = userId ? `Unlocked badges for ${userId}` : "Badge strip";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label={ariaLabel} role="list">
      {customItems?.map((item, index) => (
        <div key={`custom-${index}`} role="listitem">
          {item}
        </div>
      ))}
      {visibleBadges.map((badge) => (
        <div key={badge.id} role="listitem" title={badge.title} className="relative">
          <AchievementSigil badge={badge} size={size} className="shadow-none" />
          <span className="sr-only">{badge.title}</span>
        </div>
      ))}
    </div>
  );
}

