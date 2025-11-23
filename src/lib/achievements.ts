import type {
  Post,
  Project,
  Comment,
  CreditTransaction,
  AchievementDefinition,
  AchievementProgressRecord,
} from "@/types";
import {
  listAchievementDefinitions,
  saveAchievementDefinitions,
  getAchievementProgressRecord,
  saveAchievementProgressRecord,
  markAchievementUnlocked,
  recordQcmPoint,
} from "./achievementsStore";
import { getAll, getAllByIndex } from "./store";
import type { P2PStats } from "./p2p/manager";

export type AchievementEvent =
  | { type: "post:created"; userId: string; post: Post }
  | { type: "project:created"; userId: string; project: Project }
  | { type: "project:updated"; userId: string; project: Project; change?: string }
  | { type: "credits:earned"; userId: string; amount: number; source: string; transactionId?: string; meta?: Record<string, unknown> }
  | { type: "credits:hype"; userId: string; amount: number; postId: string; recipientId: string }
  | { type: "social:comment"; userId: string; postId: string; commentId: string }
  | { type: "p2p:connected"; userId: string; stats?: P2PStats }
  | { type: "p2p:stats-update"; userId: string; stats: P2PStats };

interface AchievementRuleResult {
  unlocked?: boolean;
  progress?: number;
  progressLabel?: string;
  meta?: Record<string, unknown>;
  qcm?: {
    series: string;
    value: number;
    source?: string;
    meta?: Record<string, unknown>;
  };
}

interface AchievementRule {
  slug: string;
  supportedEvents: AchievementEvent["type"][];
  evaluate: (
    event: AchievementEvent,
    progress: AchievementProgressRecord | undefined
  ) => Promise<AchievementRuleResult | null>;
}

const BUILT_IN_ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "achv-first-transmission",
    slug: "first-transmission",
    title: "First Transmission",
    description: "Publish your first post to the swarm.",
    creditReward: 1,
    qcmImpact: "+25 content spike",
    category: "content",
    rarity: "common",
  },
  {
    id: "achv-content-cascade",
    slug: "content-cascade",
    title: "Content Cascade",
    description: "Share five unique posts to start a content wave.",
    creditReward: 1,
    qcmImpact: "+50 content wave",
    category: "content",
    rarity: "uncommon",
  },
  {
    id: "achv-project-architect",
    slug: "project-architect",
    title: "Project Architect",
    description: "Spin up your first collaborative project.",
    creditReward: 1,
    qcmImpact: "Node network surge",
    category: "node",
    rarity: "uncommon",
  },
  {
    id: "achv-project-steward",
    slug: "project-steward",
    title: "Project Steward",
    description: "Refresh or evolve a project you own.",
    creditReward: 1,
    qcmImpact: "Project caretaking boost",
    category: "node",
    rarity: "common",
  },
  {
    id: "achv-hype-spark",
    slug: "hype-spark",
    title: "Hype Spark",
    description: "Send your first hype boost to energize a post.",
    creditReward: 1,
    qcmImpact: "Social hype pulse",
    category: "social",
    rarity: "common",
  },
  {
    id: "achv-credit-claimer",
    slug: "credit-claimer",
    title: "Credit Claimer",
    description: "Earn credits for the first time.",
    creditReward: 1,
    qcmImpact: "Creator balance spike",
    category: "social",
    rarity: "common",
  },
  {
    id: "achv-mesh-runner",
    slug: "mesh-runner",
    title: "Mesh Runner",
    description: "Connect your node to the P2P mesh.",
    creditReward: 1,
    qcmImpact: "Node mesh surge",
    category: "node",
    rarity: "rare",
  },
  {
    id: "achv-conversation-starter",
    slug: "conversation-starter",
    title: "Conversation Starter",
    description: "Leave three comments across the swarm.",
    creditReward: 1,
    qcmImpact: "Social ripple",
    category: "social",
    rarity: "uncommon",
  },
];

let cachedDefinitions: AchievementDefinition[] | null = null;

function clamp(value: number | undefined, min = 0, max = 1): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(Math.max(value, min), max);
}

async function ensureAchievementDefinitions(): Promise<AchievementDefinition[]> {
  if (cachedDefinitions) return cachedDefinitions;

  const existing = await listAchievementDefinitions();
  const now = new Date().toISOString();
  const toUpsert: AchievementDefinition[] = [];
  const bySlug = new Map(existing.map((def) => [def.slug, def]));
  const byId = new Map(existing.map((def) => [def.id, def]));

  for (const definition of BUILT_IN_ACHIEVEMENTS) {
    const match = bySlug.get(definition.slug) ?? byId.get(definition.id);
    if (!match) {
      toUpsert.push({
        ...definition,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const needsUpdate =
      match.title !== definition.title ||
      match.description !== definition.description ||
      match.creditReward !== definition.creditReward ||
      match.qcmImpact !== definition.qcmImpact ||
      match.category !== definition.category ||
      match.rarity !== definition.rarity;

    if (needsUpdate) {
      toUpsert.push({
        ...match,
        ...definition,
        createdAt: match.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  if (toUpsert.length) {
    await saveAchievementDefinitions(toUpsert);
    const refreshed = await listAchievementDefinitions();
    cachedDefinitions = refreshed;
    return refreshed;
  }

  cachedDefinitions = existing;
  return existing;
}

async function awardCreditsForAchievement(params: {
  userId: string;
  definition: AchievementDefinition;
}): Promise<void> {
  try {
    const creditsModule = await import("./credits");
    if (typeof creditsModule.awardAchievementCredits === "function") {
      await creditsModule.awardAchievementCredits({
        userId: params.userId,
        amount: params.definition.creditReward,
        achievementId: params.definition.id,
        achievementSlug: params.definition.slug,
        achievementTitle: params.definition.title,
        skipAchievementEvent: true,
      });
    }
  } catch (error) {
    console.warn("[achievements] Failed to award achievement credits", error);
  }
}

async function showAchievementToast(definition: AchievementDefinition): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { toast } = await import("sonner");
    const rewardText = definition.creditReward > 0 ? ` +${definition.creditReward} credits` : "";
    toast.success(`Badge unlocked: ${definition.title}`, {
      description: `${definition.description}${rewardText ? ` •${rewardText}` : ""}`,
      duration: 5000,
    });
  } catch (error) {
    console.warn("[achievements] Failed to display toast", error);
  }
}

async function recordQcmSpike(
  userId: string,
  qcm: NonNullable<AchievementRuleResult["qcm"]>,
  achievementId: string
): Promise<void> {
  await recordQcmPoint({
    id: crypto.randomUUID(),
    userId,
    series: qcm.series,
    value: qcm.value,
    recordedAt: new Date().toISOString(),
    source: qcm.source ?? "achievement",
    meta: {
      achievementId,
      ...qcm.meta,
    },
  });
}

const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    slug: "first-transmission",
    supportedEvents: ["post:created"],
    async evaluate(event) {
      if (event.type !== "post:created") return null;
      const posts = await getAll<Post>("posts");
      const userPosts = posts.filter((post) => post.author === event.userId);
      const count = userPosts.length;
      const unlocked = count >= 1;
      return {
        unlocked,
        progress: clamp(count / 1),
        progressLabel: `${count}/1 posts`,
        meta: { postCount: count },
        qcm: unlocked
          ? {
              series: "content",
              value: 25,
              source: "first-post",
              meta: { postId: event.post.id },
            }
          : undefined,
      };
    },
  },
  {
    slug: "content-cascade",
    supportedEvents: ["post:created"],
    async evaluate(event) {
      if (event.type !== "post:created") return null;
      const posts = await getAll<Post>("posts");
      const userPosts = posts.filter((post) => post.author === event.userId);
      const count = userPosts.length;
      const target = 5;
      const unlocked = count >= target;
      return {
        unlocked,
        progress: clamp(count / target),
        progressLabel: `${Math.min(count, target)}/${target} posts`,
        meta: { postCount: count },
        qcm: unlocked
          ? {
              series: "content",
              value: 50,
              source: "content-cascade",
              meta: { latestPostId: event.post.id },
            }
          : undefined,
      };
    },
  },
  {
    slug: "project-architect",
    supportedEvents: ["project:created"],
    async evaluate(event) {
      if (event.type !== "project:created") return null;
      const projects = await getAll<Project>("projects");
      const ownedProjects = projects.filter((project) => project.owner === event.userId);
      const unlocked = ownedProjects.length >= 1;
      return {
        unlocked,
        progress: clamp(ownedProjects.length / 1),
        progressLabel: `${ownedProjects.length}/1 projects`,
        meta: { projectCount: ownedProjects.length },
        qcm: unlocked
          ? {
              series: "node",
              value: 40,
              source: "project-architect",
              meta: { projectId: event.project.id },
            }
          : undefined,
      };
    },
  },
  {
    slug: "project-steward",
    supportedEvents: ["project:updated"],
    async evaluate(event, progress) {
      if (event.type !== "project:updated") return null;
      const previous = Number(progress?.meta?.updateCount ?? 0);
      const totalUpdates = previous + 1;
      const target = 3;
      const unlocked = totalUpdates >= target;
      return {
        unlocked,
        progress: clamp(totalUpdates / target),
        progressLabel: `${Math.min(totalUpdates, target)}/${target} updates`,
        meta: { updateCount: totalUpdates, lastProjectId: event.project.id },
        qcm: unlocked
          ? {
              series: "node",
              value: 20,
              source: "project-steward",
              meta: { projectId: event.project.id },
            }
          : undefined,
      };
    },
  },
  {
    slug: "hype-spark",
    supportedEvents: ["credits:hype"],
    async evaluate(event) {
      if (event.type !== "credits:hype") return null;
      const sentTransactions = await getAllByIndex<CreditTransaction>(
        "creditTransactions",
        "fromUserId",
        event.userId
      );
      const hypeCount = sentTransactions.filter((tx) => tx.type === "hype").length;
      const unlocked = hypeCount >= 1;
      return {
        unlocked,
        progress: clamp(hypeCount / 1),
        progressLabel: `${Math.min(hypeCount, 1)}/1 hype`,
        meta: { hypeCount, lastPostId: event.postId },
        qcm: unlocked
          ? {
              series: "social",
              value: 15,
              source: "hype-spark",
              meta: { postId: event.postId },
            }
          : undefined,
      };
    },
  },
  {
    slug: "credit-claimer",
    supportedEvents: ["credits:earned"],
    async evaluate(event) {
      if (event.type !== "credits:earned") return null;
      const receivedTransactions = await getAllByIndex<CreditTransaction>(
        "creditTransactions",
        "toUserId",
        event.userId
      );
      const meaningfulCredits = receivedTransactions.filter((tx) =>
        ["earned_post", "earned_hosting", "achievement_reward", "tip"].includes(tx.type)
      );
      const unlocked = meaningfulCredits.length >= 1;
      return {
        unlocked,
        progress: clamp(meaningfulCredits.length / 1),
        progressLabel: `${Math.min(meaningfulCredits.length, 1)}/1 credit events`,
        meta: { earnedCount: meaningfulCredits.length, source: event.source },
        qcm: unlocked
          ? {
              series: "social",
              value: 10,
              source: "credit-claimer",
              meta: { transactionId: event.transactionId },
            }
          : undefined,
      };
    },
  },
  {
    slug: "mesh-runner",
    supportedEvents: ["p2p:connected"],
    async evaluate(event, progress) {
      if (event.type !== "p2p:connected") return null;
      const previous = Number(progress?.meta?.connections ?? 0);
      const totalConnections = previous + 1;
      const unlocked = totalConnections >= 1;
      return {
        unlocked,
        progress: clamp(totalConnections / 1),
        progressLabel: `${Math.min(totalConnections, 1)}/1 connections`,
        meta: { connections: totalConnections },
        qcm: unlocked
          ? {
              series: "node",
              value: 30,
              source: "achievement:mesh-runner",
              meta: {
                connections: totalConnections,
                status: event.stats?.status,
                connectedPeers: event.stats?.connectedPeers
              } as Record<string, unknown>,
            }
          : undefined,
      };
    },
  },
  {
    slug: "conversation-starter",
    supportedEvents: ["social:comment"],
    async evaluate(event) {
      if (event.type !== "social:comment") return null;
      const comments = await getAllByIndex<Comment>("comments", "author", event.userId);
      const count = comments.length;
      const target = 3;
      const unlocked = count >= target;
      return {
        unlocked,
        progress: clamp(count / target),
        progressLabel: `${Math.min(count, target)}/${target} comments`,
        meta: { commentCount: count, lastCommentId: event.commentId },
        qcm: unlocked
          ? {
              series: "social",
              value: 20,
              source: "conversation-starter",
              meta: { postId: event.postId },
            }
          : undefined,
      };
    },
  },
];

export async function evaluateAchievementEvent(event: AchievementEvent): Promise<void> {
  const definitions = await ensureAchievementDefinitions();
  const relevantRules = ACHIEVEMENT_RULES.filter((rule) =>
    rule.supportedEvents.includes(event.type)
  );
  if (!relevantRules.length) {
    return;
  }

  const definitionsBySlug = new Map(definitions.map((definition) => [definition.slug, definition]));

  for (const rule of relevantRules) {
    const definition = definitionsBySlug.get(rule.slug);
    if (!definition) continue;

    const existing = await getAchievementProgressRecord(event.userId, definition.id);
    if (existing?.unlocked) continue;

    try {
      const result = await rule.evaluate(event, existing ?? undefined);
      if (!result) continue;

      if (result.unlocked) {
        const progressRecord = {
          id: existing?.id ?? crypto.randomUUID(),
          userId: event.userId,
          achievementId: definition.id,
          unlocked: true,
          unlockedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          progress: 1,
          progressLabel: "Unlocked",
          meta: result.meta,
        };

        await markAchievementUnlocked({
          id: progressRecord.id,
          userId: event.userId,
          achievementId: definition.id,
          unlockedAt: progressRecord.unlockedAt,
          meta: result.meta,
        });

        if (definition.creditReward > 0) {
          await awardCreditsForAchievement({ userId: event.userId, definition });
        }

        if (result.qcm) {
          await recordQcmSpike(event.userId, result.qcm, definition.id);
        }

        await showAchievementToast(definition);

        // Dispatch event for NFT wrapping
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("achievement-unlocked", {
              detail: { 
                achievement: definition, 
                progress: progressRecord 
              },
            })
          );
        }
      } else if (result.progress !== undefined || result.progressLabel) {
        await saveAchievementProgressRecord({
          id: existing?.id ?? crypto.randomUUID(),
          userId: event.userId,
          achievementId: definition.id,
          unlocked: false,
          progress: clamp(result.progress),
          progressLabel: result.progressLabel,
          lastUpdated: new Date().toISOString(),
          meta: result.meta,
        });
      }
    } catch (error) {
      console.warn("[achievements] Failed to evaluate achievement", {
        slug: rule.slug,
        error,
      });
    }
  }
}

export function resetAchievementDefinitionCache(): void {
  cachedDefinitions = null;
}
