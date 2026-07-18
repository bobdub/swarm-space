## Goal

Retire the outdated Imagination walkthrough card in Settings → Account and replace it with a **Prioritize Loading** control offering three modes that shape boot priority + the user's default landing page.

## Modes

| Mode | Boot priority | Default landing page | Notes |
|---|---|---|---|
| **Gaming** (default) | Brain / virtual world first; p2p + social lazy | `/brain` (main lobby Brain) | Current behaviour — no functional change for existing users |
| **Social** | Local synced/cached content first; p2p connects in background; Brain lazy | `/explore` | Best for readers/creators |
| **P2P / Swarm** | P2P mesh + swarm connection first; local sync then new content; Brain/world lazy | `/brain` | Recommended for users with linked personal servers |

## UX

In `src/pages/Settings.tsx`, inside the **Account** tab, remove the "Imagination walkthrough" card and drop in a new "Prioritize loading" card:

- Radio-group of the three modes (label + one-line description each).
- Small footer note: "Applies on next page load."
- Selection persists immediately; a toast confirms.

The walkthrough context/provider is left in place (still used by first-run onboarding elsewhere) — only the Settings entry point is removed.

## Wiring

1. **New module** `src/lib/settings/loadingPriority.ts`
   - `LoadingPriority = 'gaming' | 'social' | 'p2p'`
   - `getLoadingPriority()` / `setLoadingPriority()` backed by `localStorage` key `swarm-loading-priority` (default `'gaming'`).
   - `getPreferredHome(user, priority)` — returns `/explore` for social, otherwise defers to `getCanonicalHome(user)`.

2. **Landing page** — extend `src/lib/routing/canonicalHome.ts` `getCanonicalHome` to consult the stored priority, so `Index.tsx` and post-auth redirects respect the choice without new call-site changes.

3. **Boot order** in `src/main.tsx`
   - Read priority once at module load.
   - **Gaming** (current): unchanged idle-scheduled boot.
   - **Social**: delay p2p/global-cell start by ~2s, keep local hydration (labour ledger, harvested inventory, placements) in the first idle pass.
   - **P2P**: start `globalCell` + mesh auto-enable immediately (still via existing `useAuthReady` gate — no new race), defer world/NPC/tool bootstraps by ~3s.
   - All existing bootstraps still run; only *ordering* shifts. `useP2P` auto-enable and the `useAuthReady` gate are untouched.

4. **useP2P** — read priority to decide whether to auto-enable immediately vs. defer via `requestIdleCallback` (no change to the single-effect / inflight-enable rules from `auth-ready-gate` memory).

## Constraints respected

- No new form elements (radio group is `role="radiogroup"` with `<button type="button">` items).
- No destructive storage changes; localStorage key only.
- Follows Infinity Protocol: single source of truth (`loadingPriority.ts`), no duplicated flags.
- Walkthrough provider stays wired so first-run onboarding still works; only the Settings-side surface is replaced.

## Verification

- Change mode → reload → confirm correct default route + observable boot order (via existing `console.log` gates in `main.tsx`).
- Legacy users default to `'gaming'` → identical behaviour to today.
- `tsgo` + `uqrc-check.mjs` clean.
