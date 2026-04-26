---
name: auth-ready-gate
description: Single app-wide auth resolution gate that eliminates /brain misroutes and P2P auto-connect races
type: feature
---

All boot-time routing and P2P auto-enablement flow through one primitive:
`useAuthReady` (`src/hooks/useAuthReady.ts`). It runs `attemptSessionRestore`
exactly once per page load behind a module-level promise and exposes
`{ user, isReady }` that flips to `true` on the same tick for every subscriber.

Rules:

- Index/Auth/AuthGuard MUST consume `useAuthReady`, not `useAuth`. They render
  a single `<Navigate>` after `isReady` — no rAF safety nets, no stacked
  redirect effects.
- Canonical home for logged-in users is `/brain` via `getCanonicalHome` in
  `src/lib/routing/canonicalHome.ts`. `/` and `/index` collapse to "no
  preference" and re-resolve to canonical home.
- `useP2P` auto-enable is a single effect keyed on
  `useAuthReady().user?.id` + `authIsReady`. Do NOT re-introduce the
  on-mount `maybeEnable` + `user-login` listener — it loses the kick when
  the hook mounts after restore has already fired.
- Concurrent `enable()` callers serialize through the module-level
  `inflightEnable` promise, so the `p2pManager` reassignment block can
  never race itself.
- The `/brain` chunk is preloaded by `BrainChunkPreloader` in `src/App.tsx`
  the moment auth resolves with a user — keep this to avoid Suspense flicker.

If a future ordering bug appears, fix it inside `useAuthReady` or the
`enableP2P` lock — never by adding another rAF or per-page redirect effect.