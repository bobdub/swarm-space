import type { ExploreActivityFilter, ExplorePopularityFilter } from "@/lib/projects";

export type ExplorePopularityOption = ExplorePopularityFilter;

export type ExploreActivityOption = ExploreActivityFilter;

export interface ExploreFilters {
  query: string;
  tag: string | null;
  popularity: ExplorePopularityOption;
  activity: ExploreActivityOption;
  page: number;
  pageSize: number;
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export const POPULARITY_OPTIONS: FilterOption<ExplorePopularityOption>[] = [
  { value: "default", label: "Balanced" },
  { value: "most-members", label: "Most members" },
  { value: "fewest-members", label: "Fewest members" },
  { value: "most-posts", label: "Most posts" },
];

export const ACTIVITY_OPTIONS: FilterOption<ExploreActivityOption>[] = [
  { value: "default", label: "Balanced" },
  { value: "recently-updated", label: "Recently updated" },
  { value: "most-active", label: "Most active" },
  { value: "least-recent", label: "Least recent" },
];

const DEFAULT_PAGE_SIZE = 9;

export function createInitialFilters(overrides: Partial<ExploreFilters> = {}): ExploreFilters {
  return {
    query: "",
    tag: null,
    popularity: "default",
    activity: "default",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    ...overrides,
  } satisfies ExploreFilters;
}

const PAGE_RESET_KEYS: Array<keyof ExploreFilters> = ["query", "tag", "popularity", "activity", "pageSize"];

export function deriveNextFilters(current: ExploreFilters, updates: Partial<ExploreFilters>): ExploreFilters {
  const merged: ExploreFilters = { ...current, ...updates };

  const shouldResetPage = PAGE_RESET_KEYS.some((key) =>
    key in updates ? updates[key as keyof ExploreFilters] !== current[key] : false,
  );

  if (shouldResetPage) {
    merged.page = 1;
  } else if (updates.page) {
    merged.page = Math.max(1, Math.floor(updates.page));
  }

  return merged;
}

export function toggleTagFilter(current: ExploreFilters, tag: string | null): ExploreFilters {
  const normalized = tag?.trim() || null;
  if (!normalized) {
    return deriveNextFilters(current, { tag: null });
  }

  if (current.tag && current.tag.toLowerCase() === normalized.toLowerCase()) {
    return deriveNextFilters(current, { tag: null });
  }

  return deriveNextFilters(current, { tag: normalized });
}

export function filtersEqual(a: ExploreFilters, b: ExploreFilters): boolean {
  return (
    a.query === b.query &&
    a.tag === b.tag &&
    a.popularity === b.popularity &&
    a.activity === b.activity &&
    a.page === b.page &&
    a.pageSize === b.pageSize
  );
}
