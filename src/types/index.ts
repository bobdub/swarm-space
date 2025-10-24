// Shared type definitions

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
  meta?: {
    createdAt: string;
  };
}

export interface Reaction {
  userId: string;
  type: "like" | "hype" | "mind" | "spark";
  createdAt: string;
}

export interface Post {
  id: string;
  author: string;
  authorName?: string;
  projectId?: string | null;
  type: "text" | "image" | "video" | "file";
  content: string;
  manifestIds?: string[];
  createdAt: string;
  editedAt?: string;
  likes?: number;
  reactions?: Reaction[];
  commentCount?: number;
  tags?: string[];
  comments?: Comment[];
}

export interface Comment {
  id: string;
  author: string;
  authorName?: string;
  text: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  members: string[];
  feedIndex: string[];
  planner?: {
    milestones: Milestone[];
  };
  tasks?: Record<string, Task>;
  meta?: {
    createdAt: string;
    updatedAt?: string;
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
