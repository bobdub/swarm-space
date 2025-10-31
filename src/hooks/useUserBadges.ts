import { useEffect, useState } from "react";

import type { AchievementDisplayItem } from "@/components/achievement-types";
import { listAchievementDefinitions, listUserAchievementProgress } from "@/lib/achievementsStore";
import type { PostBadgeSnapshot } from "@/types";

let definitionsPromise: ReturnType<typeof listAchievementDefinitions> | null = null;
const badgeCache = new Map<string, AchievementDisplayItem[]>();

async function loadAchievementDefinitions() {
  if (!definitionsPromise) {
    definitionsPromise = listAchievementDefinitions();
  }

  return definitionsPromise;
}

async function buildBadgesFromSnapshots(snapshots: PostBadgeSnapshot[]): Promise<AchievementDisplayItem[]> {
  if (snapshots.length === 0) {
    return [];
  }

  const definitions = await loadAchievementDefinitions();
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

  return snapshots
    .map((snapshot) => {
      const definition = definitionsById.get(snapshot.id);
      if (!definition) {
        return null;
      }

      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        rarity: definition.rarity,
        creditReward: definition.creditReward,
        qcmImpact: definition.qcmImpact,
        unlocked: true,
        unlockedAt: snapshot.unlockedAt ?? null,
        progress: 1,
        progressLabel: "Unlocked",
        isSecret: definition.isSecret,
        meta: definition.meta,
      } satisfies AchievementDisplayItem;
    })
    .filter((badge) => badge !== null) as AchievementDisplayItem[];
}

async function fetchBadgesForUser(
  userId: string,
  fallbackSnapshots?: PostBadgeSnapshot[],
): Promise<AchievementDisplayItem[]> {
  if (badgeCache.has(userId)) {
    const cached = badgeCache.get(userId)!;
    if (cached.length === 0 && fallbackSnapshots?.length) {
      const fallback = await buildBadgesFromSnapshots(fallbackSnapshots);
      badgeCache.set(userId, fallback);
      return fallback;
    }
    return cached;
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

    if (badges.length > 0) {
      badgeCache.set(userId, badges);
      return badges;
    }

    if (fallbackSnapshots?.length) {
      const fallback = await buildBadgesFromSnapshots(fallbackSnapshots);
      badgeCache.set(userId, fallback);
      return fallback;
    }

    badgeCache.set(userId, []);
    return [];
  } catch (error) {
    console.warn(`[useUserBadges] Failed to load badges for ${userId}`, error);
    badgeCache.set(userId, []);
    return [];
  }
}

interface UseUserBadgesOptions {
  fallbackUnlockedBadges?: PostBadgeSnapshot[];
}

export function useUserBadges(
  userId: string | undefined,
  options?: UseUserBadgesOptions,
): AchievementDisplayItem[] | null {
  const [badges, setBadges] = useState<AchievementDisplayItem[] | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (!userId) {
      setBadges([]);
      return () => {
        isMounted = false;
      };
    }

    const fallbackSnapshots = options?.fallbackUnlockedBadges;
    fetchBadgesForUser(userId, fallbackSnapshots).then((items) => {
      if (isMounted) {
        setBadges(items);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [userId, options?.fallbackUnlockedBadges]);

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

