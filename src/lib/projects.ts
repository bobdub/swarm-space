// Project management utilities
import { Project } from "@/types";
import { put, get, getAll, remove } from "./store";
import { getCurrentUser } from "./auth";
import type { AchievementEvent } from "./achievements";

async function notifyAchievements(event: AchievementEvent): Promise<void> {
  try {
    const module = await import("./achievements");
    await module.evaluateAchievementEvent(event);
  } catch (error) {
    console.warn("[projects] Failed to notify achievements", error);
  }
}

/**
 * Create a new project
 */
export async function createProject(
  name: string,
  description: string,
  settings?: Project["settings"]
): Promise<Project> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const newProject: Project = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: description.trim(),
    owner: user.id,
    members: [user.id],
    feedIndex: [],
    settings: settings || {
      visibility: "public",
      allowJoinRequests: true,
    },
    tags: [],
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", newProject);
  void notifyAchievements({ type: "project:created", userId: user.id, project: newProject });
  return newProject;
}

/**
 * Get project by ID
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const project = await get("projects", projectId) as Project | undefined;
  return project || null;
}

/**
 * Get all projects
 */
export async function getAllProjects(): Promise<Project[]> {
  return await getAll("projects") as Project[];
}

/**
 * Get projects where user is a member
 */
export async function getUserProjects(): Promise<Project[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const allProjects = await getAllProjects();
  return allProjects.filter((p) => p.members.includes(user.id));
}

/**
 * Get public projects for discovery
 */
export async function getPublicProjects(): Promise<Project[]> {
  const allProjects = await getAllProjects();
  return allProjects.filter((p) => p.settings?.visibility === "public");
}

/**
 * Update project details
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, "name" | "description" | "settings" | "tags">>
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const user = await getCurrentUser();
  if (!user || project.owner !== user.id) {
    throw new Error("Only the project owner can update project details");
  }

  const updatedProject: Project = {
    ...project,
    ...updates,
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", updatedProject);
  void notifyAchievements({
    type: "project:updated",
    userId: user.id,
    project: updatedProject,
    change: "details",
  });
  return updatedProject;
}

/**
 * Delete project
 */
export async function deleteProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) return;

  const user = await getCurrentUser();
  if (!user || project.owner !== user.id) {
    throw new Error("Only the project owner can delete the project");
  }

  await remove("projects", projectId);
}

/**
 * Add member to project
 */
export async function addProjectMember(
  projectId: string,
  userId: string
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  if (project.members.includes(userId)) {
    return project; // Already a member
  }

  const updatedProject: Project = {
    ...project,
    members: [...project.members, userId],
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", updatedProject);
  return updatedProject;
}

/**
 * Remove member from project
 */
export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  // Owner can remove anyone, members can remove themselves
  if (project.owner !== user.id && user.id !== userId) {
    throw new Error("Insufficient permissions");
  }

  // Cannot remove the owner
  if (userId === project.owner) {
    throw new Error("Cannot remove the project owner");
  }

  const updatedProject: Project = {
    ...project,
    members: project.members.filter((m) => m !== userId),
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", updatedProject);
  return updatedProject;
}

/**
 * Add post to project feed
 */
export async function addPostToProject(
  projectId: string,
  postId: string
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const user = await getCurrentUser();
  if (!user || !project.members.includes(user.id)) {
    throw new Error("Only project members can add posts");
  }

  if (project.feedIndex.includes(postId)) {
    return project; // Already in feed
  }

  const updatedProject: Project = {
    ...project,
    feedIndex: [postId, ...project.feedIndex],
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", updatedProject);
  void notifyAchievements({
    type: "project:updated",
    userId: user.id,
    project: updatedProject,
    change: "feed",
  });
  return updatedProject;
}

/**
 * Remove a post from a project's feed index.
 */
export async function removePostFromProject(
  projectId: string,
  postId: string
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  if (!project.feedIndex.includes(postId)) {
    return project;
  }

  const updatedProject: Project = {
    ...project,
    feedIndex: project.feedIndex.filter((id) => id !== postId),
    meta: {
      ...project.meta,
      updatedAt: new Date().toISOString(),
    },
  };

  await put("projects", updatedProject);
  return updatedProject;
}

/**
 * Check if user can manage project
 */
export function canManageProject(project: Project, userId: string): boolean {
  return project.owner === userId;
}

/**
 * Check if user is project member
 */
export function isProjectMember(project: Project, userId: string): boolean {
  return project.members.includes(userId);
}
