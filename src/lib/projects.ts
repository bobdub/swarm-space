// Project management utilities
import type { Post, Project } from "@/types";
import { put, get, getAll, remove } from "./store";
import { getCurrentUser } from "./auth";
import type { AchievementEvent } from "./achievements";
import { getConnectedUserIds } from "./connections";

export type ExplorePopularityFilter =
  | "default"
  | "most-members"
  | "fewest-members"
  | "most-posts";

export type ExploreActivityFilter =
  | "default"
  | "recently-updated"
  | "least-recent"
  | "most-active";

export interface ExploreProjectSearchParams {
  query?: string;
  tag?: string | null;
  popularity?: ExplorePopularityFilter;
  activity?: ExploreActivityFilter;
  page?: number;
  pageSize?: number;
}

export interface ExploreProjectSearchResult {
  items: Project[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  availableTags: string[];
}

export interface ExploreProjectSearchDependencies {
  loadProjects?: () => Promise<Project[]>;
  now?: () => number;
}

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

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const newProject: Project = {
    id: crypto.randomUUID(),
    name: trimmedName,
    description: trimmedDescription,
    owner: user.id,
    members: [user.id],
    feedIndex: [],
    profile: trimmedDescription
      ? {
          bio: trimmedDescription,
        }
      : undefined,
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
  return allProjects.filter((project) => isProjectMember(project, user.id));
}

/**
 * Get public projects for discovery
 */
export async function getPublicProjects(): Promise<Project[]> {
  const allProjects = await getAllProjects();
  return allProjects.filter((p) => (p.settings?.visibility ?? "public") !== "private");
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function parseDate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildComparators(
  popularity: ExplorePopularityFilter,
  activity: ExploreActivityFilter,
  nowMs: number,
): ((a: Project, b: Project) => number)[] {
  const comparators: ((a: Project, b: Project) => number)[] = [];

  if (popularity === "most-members") {
    comparators.push((a, b) => b.members.length - a.members.length);
  } else if (popularity === "fewest-members") {
    comparators.push((a, b) => a.members.length - b.members.length);
  } else if (popularity === "most-posts") {
    comparators.push((a, b) => (b.feedIndex?.length ?? 0) - (a.feedIndex?.length ?? 0));
  }

  if (activity === "recently-updated") {
    comparators.push((a, b) =>
      parseDate(b.meta?.updatedAt, nowMs) - parseDate(a.meta?.updatedAt, nowMs),
    );
  } else if (activity === "least-recent") {
    comparators.push((a, b) =>
      parseDate(a.meta?.updatedAt, nowMs) - parseDate(b.meta?.updatedAt, nowMs),
    );
  } else if (activity === "most-active") {
    comparators.push((a, b) => (b.feedIndex?.length ?? 0) - (a.feedIndex?.length ?? 0));
  }

  // Default fallback to keep results stable and bias toward fresher projects.
  comparators.push(
    (a, b) =>
      parseDate(b.meta?.updatedAt, nowMs) - parseDate(a.meta?.updatedAt, nowMs) ||
      parseDate(b.meta?.createdAt, nowMs) - parseDate(a.meta?.createdAt, nowMs),
  );

  return comparators;
}

function sortProjects(
  projects: Project[],
  popularity: ExplorePopularityFilter,
  activity: ExploreActivityFilter,
  nowMs: number,
): Project[] {
  const comparators = buildComparators(popularity, activity, nowMs);

  return [...projects].sort((a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  });
}

function collectAvailableTags(projects: Project[]): string[] {
  const seen = new Set<string>();
  for (const project of projects) {
    if (!project.tags) continue;
    for (const tag of project.tags) {
      if (!tag) continue;
      seen.add(tag.trim());
    }
  }
  return Array.from(seen)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function searchPublicProjects(
  params: ExploreProjectSearchParams = {},
  dependencies: ExploreProjectSearchDependencies = {},
): Promise<ExploreProjectSearchResult> {
  const {
    query = "",
    tag,
    popularity = "default",
    activity = "default",
    page = 1,
    pageSize = 9,
  } = params;

  const loadProjects = dependencies.loadProjects ?? getPublicProjects;
  const now = dependencies.now ?? (() => Date.now());

  const publicProjects = await loadProjects();
  const normalizedQuery = query.trim().toLowerCase();
  const matchingProjects = publicProjects.filter((project) => {
    if (!normalizedQuery) return true;
    const haystack = `${project.name} ${project.description ?? ""} ${project.profile?.bio ?? ""}`.toLowerCase();
    const tagMatches = project.tags?.some((projectTag) =>
      projectTag.toLowerCase().includes(normalizedQuery),
    );
    return haystack.includes(normalizedQuery) || Boolean(tagMatches);
  });

  const availableTags = collectAvailableTags(matchingProjects);

  const normalizedTag = tag ? normalizeTag(tag) : null;
  const filteredByTag = normalizedTag
    ? matchingProjects.filter((project) =>
        project.tags?.some((projectTag) => normalizeTag(projectTag) === normalizedTag),
      )
    : matchingProjects;

  const sorted = sortProjects(filteredByTag, popularity, activity, now());

  const safePageSize = Math.max(1, Math.floor(pageSize));
  const total = sorted.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / safePageSize);
  const requestedPage = Math.max(1, Math.floor(page));
  const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const items = sorted.slice(startIndex, startIndex + safePageSize);

  return {
    items,
    total,
    totalPages,
    page: currentPage,
    pageSize: safePageSize,
    availableTags,
  };
}

/**
 * Update project details
 */
export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, "name" | "description" | "settings" | "tags" | "profile">>
): Promise<Project | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const user = await getCurrentUser();
  if (!user || project.owner !== user.id) {
    throw new Error("Only the project owner can update project details");
  }

  const { profile: profileUpdates, ...rest } = updates;
  const mergedProfile = profileUpdates
    ? {
        ...project.profile,
        ...profileUpdates,
      }
    : project.profile;

  const nextDescription = Object.prototype.hasOwnProperty.call(rest, "description")
    ? rest.description ?? ""
    : Object.prototype.hasOwnProperty.call(profileUpdates ?? {}, "bio")
      ? profileUpdates?.bio ?? ""
      : project.description;

  const updatedProject: Project = {
    ...project,
    ...rest,
    description: nextDescription,
    profile: mergedProfile,
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

  if (isProjectMember(project, userId)) {
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
  if (!user || !isProjectMember(project, user.id)) {
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
  return project.owner === userId || project.members.includes(userId);
}

interface CanViewProjectOptions {
  connectedUserIds?: Set<string>;
}

export async function canViewProject(
  project: Project,
  viewerId: string | null | undefined,
  options: CanViewProjectOptions = {},
): Promise<boolean> {
  const visibility = project.settings?.visibility ?? "public";
  if (visibility !== "private") {
    return true;
  }

  if (!viewerId) {
    return false;
  }

  if (isProjectMember(project, viewerId)) {
    return true;
  }

  let connectedIds = options.connectedUserIds;
  if (!connectedIds) {
    try {
      const ids = await getConnectedUserIds(viewerId);
      connectedIds = new Set(ids);
    } catch (error) {
      console.warn(`[projects] Failed to load connections for viewer ${viewerId}`, error);
      connectedIds = new Set();
    }
  }

  if (connectedIds.has(project.owner)) {
    return true;
  }

  for (const memberId of project.members) {
    if (connectedIds.has(memberId)) {
      return true;
    }
  }

  return false;
}

export async function filterProjectsForViewer(
  projects: Project[],
  viewerId: string | null | undefined,
): Promise<Project[]> {
  if (projects.length === 0) {
    return [];
  }

  const visibilityIsPublic = (project: Project) => (project.settings?.visibility ?? "public") !== "private";

  if (!viewerId) {
    return projects.filter(visibilityIsPublic);
  }

  let connectedIds: Set<string> | undefined;
  const requiresConnections = projects.some(
    (project) => (project.settings?.visibility ?? "public") === "private" && !isProjectMember(project, viewerId),
  );

  if (requiresConnections) {
    try {
      connectedIds = new Set(await getConnectedUserIds(viewerId));
    } catch (error) {
      console.warn(`[projects] Failed to load connections for viewer ${viewerId}`, error);
      connectedIds = new Set();
    }
  }

  const visibleProjects = await Promise.all(
    projects.map(async (project) => {
      const canView = await canViewProject(project, viewerId, { connectedUserIds: connectedIds });
      return canView ? project : null;
    }),
  );

  return visibleProjects.filter((project): project is Project => project !== null);
}

export async function filterPostsByProjectMembership(
  posts: Post[],
  viewerId: string | null | undefined,
): Promise<Post[]> {
  if (posts.length === 0) {
    return [];
  }

  const projectIds = Array.from(
    new Set(
      posts
        .map((post) => post.projectId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );

  if (projectIds.length === 0) {
    return posts;
  }

  const projects = await Promise.all(
    projectIds.map(async (projectId) => {
      try {
        return await getProject(projectId);
      } catch (error) {
        console.warn(`[projects] Failed to load project ${projectId} for post visibility`, error);
        return null;
      }
    }),
  );

  const projectMap = new Map<string, Project | null>();
  projectIds.forEach((projectId, index) => {
    projectMap.set(projectId, projects[index]);
  });

  return posts.filter((post) => {
    if (!post.projectId) {
      return true;
    }

    const project = projectMap.get(post.projectId);
    if (!project) {
      return false;
    }

    if (!viewerId) {
      return false;
    }

    return isProjectMember(project, viewerId);
  });
}
