import { useEffect, useState } from "react";

import type { AchievementDisplayItem } from "@/components/achievement-types";
import { listAchievementDefinitions, listUserAchievementProgress } from "@/lib/achievementsStore";

let definitionsPromise: ReturnType<typeof listAchievementDefinitions> | null = null;
const badgeCache = new Map<string, AchievementDisplayItem[]>();

async function loadAchievementDefinitions() {
  if (!definitionsPromise) {
    definitionsPromise = listAchievementDefinitions();
  }

  return definitionsPromise;
}

async function fetchBadgesForUser(userId: string): Promise<AchievementDisplayItem[]> {
  if (badgeCache.has(userId)) {
    return badgeCache.get(userId)!;
  }

  try {
    const [definitions, progressRecords] = await Promise.all([
      loadAchievementDefinitions(),
      listUserAchievementProgress(userId),
    ]);

    const progressById = new Map(progressRecords.map((record) => [record.achievementId, record]));

    const badges: AchievementDisplayItem[] = definitions
      .map((definition) => {
        const progress = progressById.get(definition.id);
        const unlocked = Boolean(progress?.unlocked);

        return {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          category: definition.category,
          rarity: definition.rarity,
          creditReward: definition.creditReward,
          qcmImpact: definition.qcmImpact,
          unlocked,
          unlockedAt: progress?.unlockedAt ?? null,
          progress: progress?.progress ?? null,
          progressLabel: progress?.progressLabel,
          isSecret: definition.isSecret,
          meta: definition.meta,
        } satisfies AchievementDisplayItem;
      })
      .filter((badge) => badge.unlocked)
      .sort((a, b) => {
        const aTime = a.unlockedAt ? new Date(a.unlockedAt).getTime() : 0;
        const bTime = b.unlockedAt ? new Date(b.unlockedAt).getTime() : 0;
        return bTime - aTime;
      });

    badgeCache.set(userId, badges);
    return badges;
  } catch (error) {
    console.warn(`[useUserBadges] Failed to load badges for ${userId}`, error);
    badgeCache.set(userId, []);
    return [];
  }
}

export function useUserBadges(userId: string | undefined): AchievementDisplayItem[] | null {
  const [badges, setBadges] = useState<AchievementDisplayItem[] | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (!userId) {
      setBadges([]);
      return () => {
        isMounted = false;
      };
    }

    fetchBadgesForUser(userId).then((items) => {
      if (isMounted) {
        setBadges(items);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  return badges;
}

export function invalidateUserBadgeCache(userId?: string) {
  if (userId) {
    badgeCache.delete(userId);
    return;
  }

  badgeCache.clear();
  definitionsPromise = null;
}

