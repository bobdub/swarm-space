// Shared type definitions

import type { StreamBroadcastPhase, StreamVisibility } from "./streaming";

export interface User {
  id: string;
  username: string;
  displayName?: string;
  profile?: {
    bio?: string;
    avatarRef?: string;
    bannerRef?: string;
    location?: string;
    website?: string;
    links?: {
      github?: string;
      twitter?: string;
      custom?: { label: string; url: string }[];
    };
    stats?: {
      postCount: number;
      projectCount: number;
      joinedAt: string;
    };
  };
  publicKey: string;
  credits?: number;
  meta?: {
    createdAt: string;
  };
}

export interface Reaction {
  id?: string;
  userId: string;
  emoji: string; // Users may store multiple distinct emoji reactions
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: "reaction" | "comment" | "mention" | "follow";
  triggeredBy: string;
  triggeredByName: string;
  postId?: string;
  commentId?: string;
  content?: string;
  emoji?: string;
  read: boolean;
  createdAt: string;
}

export interface PostBadgeSnapshot {
  id: string;
  unlockedAt?: string | null;
}

export interface StreamPostMetadata {
  roomId: string;
  title: string;
  context: "profile" | "project";
  projectId?: string | null;
  visibility: StreamVisibility;
  broadcastState: StreamBroadcastPhase;
  promotedAt: string;
  recordingId?: string | null;
  summaryId?: string | null;
  endedAt?: string | null;
}

export interface Post {
  id: string;
  author: string;
  authorName?: string;
  authorAvatarRef?: string;
  authorBannerRef?: string;
  authorBadgeSnapshots?: PostBadgeSnapshot[];
  projectId?: string | null;
  type: "text" | "image" | "video" | "file" | "stream";
  content: string;
  manifestIds?: string[];
  createdAt: string;
  editedAt?: string;
  nsfw?: boolean;
  likes?: number;
  reactions?: Reaction[];
  reactionTombstones?: Record<string, string>; // Tracks removal timestamps for reaction keys
  commentCount?: number;
  tags?: string[];
  comments?: Comment[];
  stream?: StreamPostMetadata;
  signature?: string;
  signatureAlgorithm?: 'ed25519';
  signerPublicKey?: string;
  signedAt?: string;
}

export interface PostMetrics {
  postId: string;
  viewCount: number;
  viewTotal: number;
  creditTotal: number;
  creditCount: number;
  lastViewAt?: string;
  lastCreditAt?: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  authorName?: string;
  text: string;
  createdAt: string;
  parentId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  owner: string;
  members: string[];
  feedIndex: string[];
  profile?: {
    bio?: string;
    avatarRef?: string;
    bannerRef?: string;
  };
  settings?: {
    visibility: "public" | "private";
    allowJoinRequests: boolean;
  };
  tags?: string[];
  planner?: {
    milestones: Milestone[];
  };
  tasks?: Record<string, Task>;
  meta: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  owner?: string;
  description?: string;
  linkedTasks?: string[];
  projectId?: string;
  color?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in-progress" | "review" | "done";
  priority?: "low" | "medium" | "high" | "urgent";
  assignees?: string[];
  dueDate?: string;
  comments?: Comment[];
  projectId?: string;
  tags: string[];
  attachments: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreditTransaction {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  type: "tip" | "hype" | "earned_post" | "earned_hosting" | "transfer" | "achievement_reward";
  postId?: string;
  createdAt: string;
  meta?: {
    burn?: number;
    postLoad?: number;
    description?: string;
    achievementId?: string;
    achievementSlug?: string;
    achievementTitle?: string;
    reason?: string;
    commentId?: string;
  };
}

export interface CreditBalance {
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  totalBurned: number;
  lastUpdated: string;
}

export type AchievementCategory =
  | "node"
  | "content"
  | "social"
  | "scriptable";

export interface AchievementDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  creditReward: number;
  qcmImpact: string;
  category: AchievementCategory;
  rarity?: "common" | "uncommon" | "rare" | "epic" | "legendary";
  isSecret?: boolean;
  createdAt?: string;
  updatedAt?: string;
  meta?: Record<string, unknown>;
}

export interface AchievementProgressRecord {
  id: string;
  userId: string;
  achievementId: string;
  unlocked: boolean;
  unlockedAt?: string;
  progress?: number;
  progressLabel?: string;
  lastUpdated: string;
  meta?: Record<string, unknown>;
  userAchievementKey?: string;
}

export interface QcmSeriesPoint {
  id: string;
  userId: string;
  series: string;
  value: number;
  recordedAt: string;
  delta?: number;
  source?: string;
  meta?: Record<string, unknown>;
  userSeriesKey?: string;
}

export type NodeMetricKind =
  | "uptimeMs"
  | "bytesUploaded"
  | "bytesDownloaded"
  | "relayCount"
  | "pingCount"
  | "connectionAttempts"
  | "successfulConnections"
  | "failedConnectionAttempts"
  | "rendezvousAttempts"
  | "rendezvousSuccesses"
  | "rendezvousFailures";

export interface NodeMetricAggregate {
  id: string;
  userId: string;
  metric: NodeMetricKind;
  bucket: string;
  total: number;
  firstRecordedAt: string;
  lastUpdatedAt: string;
  meta?: Record<string, unknown>;
}
