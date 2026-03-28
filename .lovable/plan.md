

## UX/UI Restructure Plan

**Summary**: Convert Home to a landing-only page, make Explore the logged-in default, remove Trending as a standalone page, clean up Explore tabs, add search popover, and move the peers panel to Node Dashboard as "Phone Book".

---

### 1. Home page becomes landing-only (no feed content)

**`src/pages/Index.tsx`**
- Remove the "Recent Activity" section (lines 131-218): tabs, post cards, feed query logic, filter state.
- Remove the feed-related imports (`fetchHomeFeed`, `PostCard`, `BlogPostCard`, `Tabs`, etc.).
- Keep: `TopNavigationBar`, `HeroSection`, `FeatureHighlights`, footer CTA, `SignupWizard`, and `SwarmApprovalCard`.
- The page becomes a clean marketing/landing page.

### 2. Redirect logged-in users to /explore

**`src/pages/Index.tsx`**
- Add a `useEffect` that checks `user` from `useAuth()`. If logged in, `navigate('/explore', { replace: true })`.
- Unauthenticated visitors stay on the landing page.

### 3. Remove "Home" from navigation

**`src/components/navigationItems.ts`**
- Remove `{ icon: Home, label: "Home", path: "/" }` from `primaryNavigationItems`.
- Remove `{ icon: Home, label: "Home", path: "/" }` from `mobileBottomBarItems`.

### 4-5. Merge Trending into Explore tab, remove Trending page/route

**`src/pages/Explore.tsx`**
- Import the trending ranking logic from `services/trending.ts` (`rankTrendingPosts`).
- Populate the "Trending" tab content with ranked posts (same logic as the standalone Trending page) instead of the placeholder card.

**`src/App.tsx`**
- Remove the `/trending` route and `Trending` import.

**`src/components/navigationItems.ts`**
- Remove `{ icon: Flame, label: "Trending", path: "/trending" }` from `primaryNavigationItems`.

### 6. Remove "Trending" from nav

Covered by step 4-5 above.

### 7. Remove "Discovered Mesh Peers" card from Explore

**`src/pages/Explore.tsx`**
- Remove `<ConnectedPeersPanel />` and its import.

### 8. Re-order Explore tabs

**`src/pages/Explore.tsx`**
- Change tab order to: **Most Recent**, **Trending**, **People**, **Projects**.
- Currently: Most Recent, Projects, People, Trending.
- Swap Projects and Trending positions in the `TabsList`.

### 9. Search as a popover icon

**`src/pages/Explore.tsx`**
- Remove the full-width `<Input>` search bar.
- Add a `Search` icon button to the right of the "Create Project" button in the header.
- Clicking it opens a `Popover` with the search input inside.
- Search functionality remains the same (filters posts and projects by query).

### 10. Move ConnectedPeersPanel to Node Dashboard as "Phone Book"

**`src/pages/NodeDashboard.tsx`**
- Import `ConnectedPeersPanel`.
- Add it in the dashboard layout (after the connection health section).

**`src/components/ConnectedPeersPanel.tsx`**
- Accept an optional `title` prop, defaulting to `"Phone Book"`.
- Update the card header text from "Discovered Mesh Peers" to use the title prop.

---

### Files modified
| File | Action |
|---|---|
| `src/pages/Index.tsx` | Strip feed content, add logged-in redirect |
| `src/components/navigationItems.ts` | Remove Home and Trending entries |
| `src/pages/Explore.tsx` | Remove peers panel, reorder tabs, populate Trending tab, replace search bar with popover icon |
| `src/App.tsx` | Remove `/trending` route and import |
| `src/pages/NodeDashboard.tsx` | Add ConnectedPeersPanel as "Phone Book" |
| `src/components/ConnectedPeersPanel.tsx` | Add configurable title prop |
| `src/components/MobileBottomBar.tsx` | No changes needed (derives from `mobileBottomBarItems`) |
| `src/components/MobileNav.tsx` | No changes needed (derives from `primaryNavigationItems`) |

