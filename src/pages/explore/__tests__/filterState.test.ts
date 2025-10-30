import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_OPTIONS,
  POPULARITY_OPTIONS,
  createInitialFilters,
  deriveNextFilters,
  filtersEqual,
  toggleTagFilter,
} from "../filterState";

describe("createInitialFilters", () => {
  test("provides sensible defaults", () => {
    const filters = createInitialFilters();
    expect(filters).toEqual({
      query: "",
      tag: null,
      popularity: POPULARITY_OPTIONS[0].value,
      activity: ACTIVITY_OPTIONS[0].value,
      page: 1,
      pageSize: 9,
    });
  });

  test("applies overrides without mutating defaults", () => {
    const filters = createInitialFilters({ query: "mesh", page: 3 });
    expect(filters.query).toBe("mesh");
    expect(filters.page).toBe(3);
    const baseline = createInitialFilters();
    expect(baseline.page).toBe(1);
  });
});

describe("deriveNextFilters", () => {
  const base = createInitialFilters({ query: "", page: 4 });

  test("resets page when query changes", () => {
    const next = deriveNextFilters(base, { query: "ai" });
    expect(next.page).toBe(1);
    expect(next.query).toBe("ai");
  });

  test("resets page when popularity changes", () => {
    const next = deriveNextFilters(base, { popularity: "most-members" });
    expect(next.page).toBe(1);
    expect(next.popularity).toBe("most-members");
  });

  test("does not reset page when navigating pagination", () => {
    const next = deriveNextFilters(base, { page: 2 });
    expect(next.page).toBe(2);
  });
});

describe("toggleTagFilter", () => {
  const base = createInitialFilters();

  test("activates the provided tag", () => {
    const next = toggleTagFilter(base, "Art");
    expect(next.tag).toBe("Art");
    expect(next.page).toBe(1);
  });

  test("clears the tag when toggled twice", () => {
    const active = toggleTagFilter(base, "build");
    const cleared = toggleTagFilter(active, "build");
    expect(cleared.tag).toBeNull();
    expect(cleared.page).toBe(1);
  });

  test("clears to default when falsy value provided", () => {
    const active = toggleTagFilter(base, "music");
    const cleared = toggleTagFilter(active, "");
    expect(cleared.tag).toBeNull();
  });
});

describe("filtersEqual", () => {
  test("detects identical filter objects", () => {
    const first = createInitialFilters({ query: "mesh" });
    const second = createInitialFilters({ query: "mesh" });
    expect(filtersEqual(first, second)).toBe(true);
  });

  test("detects changes across properties", () => {
    const first = createInitialFilters();
    const second = deriveNextFilters(first, { popularity: "most-members" });
    expect(filtersEqual(first, second)).toBe(false);
  });
});
