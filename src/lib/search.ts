// Search utilities for posts, users, and projects
import { Post, User, Project } from "@/types";
import { getAll } from "./store";

export interface SearchResult {
  type: "post" | "user" | "project";
  id: string;
  title: string;
  description?: string;
  relevance: number;
  preview?: string;
  data?: Post | User | Project;
}

/**
 * Calculate relevance score for search results
 */
function calculateRelevance(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  if (!lowerQuery) return 0;
  
  let score = 0;
  
  // Exact match = highest score
  if (lowerText === lowerQuery) score += 100;
  
  // Starts with query = high score
  if (lowerText.startsWith(lowerQuery)) score += 50;
  
  // Contains query = medium score
  if (lowerText.includes(lowerQuery)) score += 25;
  
  // Word boundaries (e.g., "test" in "this is a test")
  const words = lowerText.split(/\s+/);
  for (const word of words) {
    if (word === lowerQuery) score += 30;
    if (word.startsWith(lowerQuery)) score += 15;
  }
  
  return score;
}

/**
 * Search posts by content and tags
 */
export async function searchPosts(query: string): Promise<SearchResult[]> {
  const posts = (await getAll("posts")) as Post[];
  const results: SearchResult[] = [];
  
  for (const post of posts) {
    let relevance = 0;
    relevance += calculateRelevance(post.content, query);
    
    if (post.tags) {
      for (const tag of post.tags) {
        relevance += calculateRelevance(tag, query) * 2; // Tags weighted higher
      }
    }
    
    if (relevance > 0) {
      results.push({
        type: "post",
        id: post.id,
        title: `Post by ${post.authorName || post.author}`,
        description: post.content.slice(0, 150),
        preview: post.content.slice(0, 100),
        relevance,
        data: post,
      });
    }
  }
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Search users by username or display name
 */
export async function searchUsers(query: string): Promise<SearchResult[]> {
  const users = (await getAll("users")) as User[];
  const results: SearchResult[] = [];
  
  for (const user of users) {
    let relevance = 0;
    relevance += calculateRelevance(user.username, query);
    
    if (user.displayName) {
      relevance += calculateRelevance(user.displayName, query);
    }
    
    if (user.profile?.bio) {
      relevance += calculateRelevance(user.profile.bio, query) * 0.5;
    }
    
    if (relevance > 0) {
      results.push({
        type: "user",
        id: user.id,
        title: user.displayName || user.username,
        description: `@${user.username}`,
        preview: user.profile?.bio?.slice(0, 100),
        relevance,
        data: user,
      });
    }
  }
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Search projects by name, description, or tags
 */
export async function searchProjects(query: string): Promise<SearchResult[]> {
  const projects = (await getAll("projects")) as Project[];
  const results: SearchResult[] = [];
  
  for (const project of projects) {
    // Only search public projects
    if (project.settings?.visibility !== "public") continue;
    
    let relevance = 0;
    relevance += calculateRelevance(project.name, query) * 2; // Name weighted higher
    relevance += calculateRelevance(project.description, query);
    
    if (project.tags) {
      for (const tag of project.tags) {
        relevance += calculateRelevance(tag, query) * 1.5;
      }
    }
    
    if (relevance > 0) {
      results.push({
        type: "project",
        id: project.id,
        title: project.name,
        description: project.description,
        preview: `${project.members.length} members`,
        relevance,
        data: project,
      });
    }
  }
  
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Global search across all content types
 */
export async function searchAll(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  
  const [posts, users, projects] = await Promise.all([
    searchPosts(query),
    searchUsers(query),
    searchProjects(query),
  ]);
  
  const allResults = [...posts, ...users, ...projects];
  return allResults.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Get filtered search results by type
 */
export async function searchByType(
  query: string,
  type: "post" | "user" | "project"
): Promise<SearchResult[]> {
  switch (type) {
    case "post":
      return searchPosts(query);
    case "user":
      return searchUsers(query);
    case "project":
      return searchProjects(query);
    default:
      return [];
  }
}
