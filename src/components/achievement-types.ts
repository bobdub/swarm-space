import type { AchievementCategory } from "@/types";

export interface AchievementDisplayItem {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  creditReward?: number;
  qcmImpact?: string;
  unlocked: boolean;
  unlockedAt?: string | null;
  progress?: number | null;
  progressLabel?: string;
  isSecret?: boolean;
  meta?: Record<string, unknown>;
}
