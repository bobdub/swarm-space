import { describe, expect, test } from "bun:test";

import type { Project } from "@/types";
import {
  searchPublicProjects,
  type ExploreProjectSearchParams,
  type ExploreProjectSearchResult,
} from "@/lib/projects";

const BASE_TIME = Date.parse("2024-04-10T12:00:00Z");

function makeProject(overrides: Partial<Project>): Project {
  const now = new Date(BASE_TIME).toISOString();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Project",
    description: overrides.description ?? "",
    owner: overrides.owner ?? "user-1",
    members: overrides.members ?? [],
    feedIndex: overrides.feedIndex ?? [],
    settings: overrides.settings ?? { visibility: "public", allowJoinRequests: true },
    tags: overrides.tags ?? [],
    meta: overrides.meta ?? {
      createdAt: now,
      updatedAt: now,
    },
  } satisfies Project;
}

async function runSearch(
  projects: Project[],
  params: ExploreProjectSearchParams = {},
): Promise<ExploreProjectSearchResult> {
  return searchPublicProjects(params, {
    loadProjects: async () => projects,
    now: () => BASE_TIME,
  });
}

describe("searchPublicProjects", () => {
  const projects: Project[] = [
    makeProject({
      id: "1",
      name: "Mesh Garden",
      description: "Collaborative art installations",
      members: ["a", "b", "c", "d"],
      feedIndex: ["p1", "p2", "p3"],
      tags: ["art", "community"],
      meta: {
        createdAt: new Date("2024-04-01T10:00:00Z").toISOString(),
        updatedAt: new Date("2024-04-09T10:00:00Z").toISOString(),
      },
    }),
    makeProject({
      id: "2",
      name: "Swarm Labs",
      description: "Research on mesh protocols",
      members: ["a"],
      feedIndex: ["p4"],
      tags: ["research", "mesh"],
      meta: {
        createdAt: new Date("2024-03-01T10:00:00Z").toISOString(),
        updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(),
      },
    }),
    makeProject({
      id: "3",
      name: "Quiet Collective",
      description: "Meditative soundscapes",
      members: ["a", "b"],
      feedIndex: ["p5", "p6", "p7", "p8", "p9"],
      tags: ["music", "art"],
      meta: {
        createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
        updatedAt: new Date("2024-04-05T10:00:00Z").toISOString(),
      },
    }),
    makeProject({
      id: "4",
      name: "Dormant Node",
      description: "Legacy infrastructure",
      members: ["a", "b", "c"],
      feedIndex: [],
      tags: ["infrastructure"],
      meta: {
        createdAt: new Date("2023-12-01T10:00:00Z").toISOString(),
        updatedAt: new Date("2024-02-01T10:00:00Z").toISOString(),
      },
    }),
  ];

  test("filters by text query across name and description", async () => {
    const result = await runSearch(projects, { query: "mesh" });
    expect(result.items.map((p) => p.id)).toEqual(["1", "2"]);
    expect(result.availableTags).toContain("art");
  });

  test("filters by normalized tag", async () => {
    const result = await runSearch(projects, { tag: "ART" });
    expect(result.items.map((p) => p.id)).toEqual(["1", "3"]);
  });

  test("sorts by member count when requested", async () => {
    const result = await runSearch(projects, { popularity: "most-members" });
    expect(result.items.map((p) => p.id)).toEqual(["1", "4", "3", "2"]);
  });

  test("sorts by activity when requested", async () => {
    const result = await runSearch(projects, { activity: "least-recent" });
    expect(result.items.map((p) => p.id)[0]).toBe("4");
  });

  test("combines filters together", async () => {
    const result = await runSearch(projects, {
      tag: "art",
      popularity: "most-posts",
      activity: "recently-updated",
    });
    expect(result.items.map((p) => p.id)).toEqual(["3", "1"]);
  });

  test("paginates results and clamps out-of-range pages", async () => {
    const result = await runSearch(projects, { page: 2, pageSize: 2, popularity: "fewest-members" });
    expect(result.page).toBe(2);
    expect(result.total).toBe(4);
    expect(result.totalPages).toBe(2);
    expect(result.items).toHaveLength(2);

    const clamped = await runSearch(projects, { page: 5, pageSize: 3 });
    expect(clamped.page).toBe(2);
    expect(clamped.items).toHaveLength(1);
  });
});
