## Plan: Brain lobby as the post-auth landing buffer

### Idea (in one line)
Send authenticated users to `/brain` instead of `/explore`. The lobby scene is already running, P2P keeps connecting in the background (it lives in `P2PProvider`, not in any one page), and Explore's heavy IndexedDB / project / post fan-out only happens when the user actually walks over to it.

### Why this works inside the existing physics
- P2P, streaming, mining, and DB upgrade overlays are all **app-level providers** (`P2PProvider`, `StreamingProvider`, `AutoMiningService`, `DBUpgradeOverlay`) mounted in `App.tsx`. They are route-independent — landing on `/brain` does **not** delay them.
- `/brain` (`BrainUniverse` → `BrainUniverseScene`) is already lazy-loaded and self-contained. It gives the user something to *do* (look around, chat, walk) while the mesh stabilises.
- `/explore` currently fires three concurrent effects on mount: `loadProjects`, `loadRecentPosts`, and a window listener for sync events (`src/pages/Explore.tsx` lines 179–187). Each one hits IndexedDB and triggers re-renders. That's the "sudden flex" the user described.

### Changes

#### 1. Re-route post-auth landings from `/explore` → `/brain`
Three entry points currently send users to `/explore`:

- `src/pages/Index.tsx` line 29 — logged-in visitor on `/`
- `src/pages/Auth.tsx` line 35 — `redirectTo` defaults to `/` (which then bounces to `/explore` via Index). Change the default fallback to `/brain` so a fresh sign-in lands directly in the lobby (without breaking explicit `?redirect=` deep links).
- `src/components/onboarding/SignupWizard.tsx` `onComplete` path (called from `Index.tsx` and `Auth.tsx`) — after wizard completes, route to `/brain`.

Deep links (`?redirect=/wallet`, project pages, share previews) keep working unchanged because `redirectTo` only falls through to the new default when neither `state.from` nor `?redirect=` is set.

#### 2. Lazyier Explore — defer the bottleneck until the tab is actually viewed
In `src/pages/Explore.tsx`:

- Wrap `loadProjects` and `loadRecentPosts` initial calls in `requestIdleCallback` (with `setTimeout` fallback) so the first paint is the shell + skeletons, not a synchronous IndexedDB scan. This honours the existing **Browser Performance** memory rule (deferred boot, throttled writes).
- Gate the `loadRecentPosts` effect on the active tab — only fetch the `recent` tab data when that tab is actually selected. Same for `projects` / `people`. Today all three load eagerly on mount.
- Keep the existing 3s debounce on the post-sync listener — no change.

#### 3. Lobby "leave" button keeps current behaviour
`BrainUniverse` already wires `onLeave → navigate('/explore')` (line 15). Leave that as-is — leaving the lobby is the explicit moment the user opts into the Explore bottleneck, and by then the mesh has had seconds to settle. The lazyier Explore from step 2 means even this transition is gentler.

#### 4. No change to providers, P2P, or routing infra
`AuthGuard`, `P2PProvider`, `StreamingProvider`, `MobileBottomBar`, `EnterBrainButton`, `BrainChatLauncher` all stay exactly as they are. This is a pure landing-preference + idle-deferral change.

### Files touched
- `src/pages/Index.tsx` — change post-auth redirect target.
- `src/pages/Auth.tsx` — change `redirectTo` fallback from `/` to `/brain`.
- `src/components/onboarding/SignupWizard.tsx` — call sites in `Index.tsx` / `Auth.tsx` route to `/brain` after `onComplete` (handler change in those two pages, wizard itself unchanged).
- `src/pages/Explore.tsx` — `requestIdleCallback`-wrapped initial loads + per-tab gating.

### Validation
- Fresh sign-in → lands on `/brain`, can see avatar/lobby immediately, P2P "connecting" indicator settles in the background, no white-screen pause.
- Click Explore in bottom bar → cards appear progressively (skeleton → projects → posts), no synchronous lock-up.
- Leave lobby via the in-scene exit → still routes to `/explore` (preserves existing UX).
- Deep link `https://…/auth?redirect=/wallet` still lands on `/wallet` after sign-in.
- Share preview links (`?peerID=…-preview`) unchanged — `AuthGuard` short-circuit still applies.
- Existing memory rules respected: P2P stability untouched, no new DB writes, no new providers, lazy-loading reinforced.
