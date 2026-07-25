## Explore Feed — Stop the Post-Load Refresh Strain

### Problem (verified in `src/pages/Explore.tsx`)

1. Initial paint runs `loadRecentPosts()` deferred via `requestIdleCallback` → shows content.
2. Almost immediately, the `p2p-posts-updated` listener fires (peers announcing on connect) and after a 3s debounce runs `loadRecentPosts(true)` again — a **full IndexedDB re-read + re-filter + re-sort + full `getPostMetricsMap` refetch** for every post.
3. Even when nothing new arrived, `postMetricsMap` state is replaced with a brand-new `Map` reference, forcing every `PostCard`/`BlogPostCard` to reconcile → visible strain / flash.
4. There is no gate on P2P status: even when the mesh is offline, we still burn the same reload cycle whenever the event fires (e.g. from local writes).

### Goals

- No feed refresh when disconnected — local-only reads on mount, no scheduled reloads.
- When connected, **new posts stream in above** existing ones without touching already-rendered cards.
- Media / metrics for posts already in the list are **not re-fetched**.

### Changes (all in `src/pages/Explore.tsx`, plus one small helper)

1. **Gate reload on P2P status**
   - Import `useP2PContext`; read `isEnabled` + `stats.connectedPeers`.
   - The `p2p-posts-updated` / `p2p-projects-updated` listener only schedules work when `isEnabled && connectedPeers > 0`. Otherwise it's a no-op (local writes already update local state via the composer flow).

2. **Incremental merge instead of full replace**
   - Split `loadRecentPosts` into two paths:
     - `loadRecentPostsInitial()` — current behaviour, runs once on mount and on `filters.query` change.
     - `mergeIncomingPosts()` — on `p2p-posts-updated`, read only posts with `createdAt > newestLoadedAt` (track `newestLoadedAtRef`). Apply the same block/hidden/membership/query filters. Prepend to `recentPosts` state, dedup by `id`. Never re-order or replace existing entries.
   - Track a `knownIdsRef: Set<string>` to skip anything already rendered → guarantees existing cards keep their reference identity and don't re-render.

3. **Metrics — only hydrate for new IDs**
   - Change the metrics step to only call `getPostMetricsMap(newIds)` for IDs not already in `postMetricsMap`, then `setPostMetricsMap(prev => new Map([...prev, ...added]))`. Skip the state update entirely when `added.size === 0`.

4. **Drop redundant full-refresh on `network-content-toggle`**
   - Explore doesn't apply the show-network gate (unlike Home/Posts), so no listener is needed. Verify nothing else here listens.

5. **Small helper `src/lib/posts.ts` (or new `src/lib/postsQuery.ts`)**
   - Add `getPostsNewerThan(iso: string): Promise<Post[]>` — thin wrapper over `getAll("posts")` that filters by `createdAt`. Keeps Explore lean and lets Home reuse it later.

6. **Preserve behaviour**
   - `filters.query` change still triggers a full `loadRecentPostsInitial()` (correct — the visible set actually changes).
   - Projects tab reload flow is unchanged aside from being wrapped in the same connection gate.

### Verification

- Load Explore offline → cards paint once, no second render (React DevTools profiler shows a single commit for the list).
- Load Explore connected, then fire a synthetic `window.dispatchEvent(new Event('p2p-posts-updated'))` with no new rows → zero list re-render, zero IndexedDB read for existing IDs.
- Fire the event after inserting a fresh post → new card slides in at the top, existing cards keep the same DOM nodes.
- Typecheck + `bun run scripts/uqrc-check.mjs`.

### Out of scope

- Home (`src/lib/feed.ts`) and `src/pages/Posts.tsx` follow the same pattern and can be migrated in a follow-up once the Explore approach is proven.
- No changes to P2P transport, storage, or PostCard internals.