// Shared type definitions

export interface User {
  id: string;
  username: string;
  displayName?: string;
  profile?: {
    bio?: string;
    avatarRef?: string;
  };
  publicKey: string;
  meta?: {
    createdAt: string;
  };
}

export interface Post {
  id: string;
  author: string;
  authorName?: string;
  projectId?: string | null;
  type: "text" | "image" | "video" | "file";
  content: string;
  chunks?: string[];
  createdAt: string;
  likes?: number;
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
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in-progress" | "review" | "done";
  assignees?: string[];
  dueDate?: string;
  comments?: Comment[];
  projectId?: string;
}
