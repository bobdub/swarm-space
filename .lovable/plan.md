

## Combined plan: Login-required + floating "Enter Brain" button

Two coordinated changes so the floating Brain CTA only appears for authenticated users, and the whole site sits behind a login wall.

---

### Part A — Gate the entire app behind login

Anonymous visitors currently browse most pages. Lock everything except auth, share previews, and legal pages.

**1. New `src/components/auth/AuthGuard.tsx`**
- Reads `useAuth()` for `{ user, isLoading }`.
- During `isLoading`, render a centered spinner (avoid flash to `/auth` while session restores from IndexedDB).
- If no `user` and route isn't in the public allowlist → `<Navigate to="/auth" replace state={{ from: location }} />`.
- Else `<Outlet />`.

Public allowlist:
- `/auth`
- `/preview` (sandboxed share previews)
- `/privacy`, `/terms`, `/whitepaper`, `/about`
- `/?peerID=...-preview` (existing share short-circuit on Index)

**2. Restructure `src/App.tsx`**

```text
<Routes>
  <Route path="/auth" element={<Auth />} />
  <Route path="/preview" element={<Preview />} />
  <Route path="/privacy" element={<Privacy />} />
  <Route path="/terms" element={<TermsOfService />} />
  <Route path="/whitepaper" element={<Whitepaper />} />
  <Route path="/about" element={<AboutNetwork />} />

  <Route element={<AuthGuard />}>
    <Route path="/" element={<Index />} />
    ... all other routes (explore, profile, wallet, brain, projects, etc.)
  </Route>

  <Route path="*" element={<NotFound />} />
</Routes>
```

**3. Return-to-origin in `src/pages/Auth.tsx`**
- After successful login, read `location.state?.from?.pathname` and navigate there; fall back to `/`.

**4. Hide global floating CTAs when logged out**
- `BrainChatLauncher`, `MobileBottomBar`, `TopNavigationBar`, and the new `EnterBrainButton`: early-return `null` when `useAuth().user` is null. Prevents flashes on the public allowlist pages.

---

### Part B — Floating "Enter Brain" button → public Infinity lobby

Persistent CTA that takes any **logged-in** user to `/brain` (Infinity lobby). Sibling to `BrainChatLauncher` but always available outside the Brain.

**1. New `src/components/brain/EnterBrainButton.tsx`**
- Floating bottom-left pill: brain icon + "Enter Brain" (icon-only on `<sm`).
- Soft pulsing glow to read as "always on."
- `onClick` → `navigate('/brain')`.
- Hidden when:
  - `useAuth().user` is null (Part A rule)
  - on `/brain`, `/projects/:id/hub`, `/preview`, `/auth`
  - `useStreaming().activeRoom` exists (so `BrainChatLauncher` owns the floating slot)
- Mobile: `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` to clear `MobileBottomBar`. Desktop: `bottom-4`.

**2. Mount in `src/App.tsx`**
- Render `<EnterBrainButton />` next to `<BrainChatLauncher />`, **inside** the authenticated layout so it never shows on public pages.

**3. Lobby is intrinsically un-promotable**
- `/brain` uses static `BRAIN_ROOM_ID = 'brain-universe-shared'`, not an `activeRoom`. The Promote-to-feed gate (`Boolean(activeRoom) && isHost`) naturally returns false there. No code change needed.

**4. Project portals**
- Out of scope for this CTA. Users already enter their own project worlds via `ProjectUniverseButton`. A future "open project portal from inside the lobby" affordance can be added separately.

---

### Files touched

- **NEW** `src/components/auth/AuthGuard.tsx`
- **NEW** `src/components/brain/EnterBrainButton.tsx`
- **EDIT** `src/App.tsx` — split routes into public vs. guarded; mount `<EnterBrainButton />` alongside `<BrainChatLauncher />`.
- **EDIT** `src/pages/Auth.tsx` — honor `location.state.from` after login.
- **EDIT** `src/components/brain/BrainChatLauncher.tsx`, `src/components/MobileBottomBar.tsx`, `src/components/TopNavigationBar.tsx` — early-return when `!user` (where not already gated).

### Acceptance

```text
1. Visiting any app route while logged out redirects to /auth, remembering the original path.
2. After login, the user lands on the originally requested route (or / by default).
3. /auth, /preview, /privacy, /terms, /whitepaper, /about remain reachable without login.
4. /?peerID=...-preview share links still work for anonymous visitors.
5. Session restore shows a spinner instead of flashing the login screen.
6. Logged-out users see no floating CTAs anywhere.
7. Logged-in users on non-Brain routes see a bottom-left "Enter Brain" pill that routes to /brain.
8. The pill hides on /brain, /projects/:id/hub, /preview, /auth, and whenever an active live room exists.
9. On mobile (≤768 px) the pill clears the bottom nav and collapses to icon-only on very narrow widths.
10. The /brain lobby still has no Promote-to-feed button (already enforced by the activeRoom gate).
```

