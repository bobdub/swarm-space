# Streamline menus across mobile and desktop

One consistent menu system: a slim top bar with icon actions, and one expandable menu (the current mobile sheet) used on every screen size.

## Top bar (always visible)

Left to right:

1. Expand-menu button (hamburger) — now shown on desktop too, not just mobile.
2. Create Post button (stays — it is the only place to create a post).
3. Credit balance (unchanged, `sm+`).
4. Bell / Alerts icon with unread badge — new, sits between Create Post and the network icon.
5. P2P network connection icon (unchanged).
6. Wallet connect icon (MetaMask, icon-only) — to the right of the network icon.
7. App Health badge (unchanged, `lg+`).

The desktop nav pill strip is removed — that strip is what bends/bloats at mid widths. All navigation moves into the expand menu, so the bar never needs to scroll or clip.

## Expand menu (the sheet)

Ordered exactly as drafted:

```text
[ avatar ] username            <- profile card, top-left, small avatar + handle
Explore
Brain
Settings
Node
Wallet
```

- Profile card at the top: small round avatar, username, tap goes to /profile. Replaces the "Profile" list row so the card itself is the profile entry.
- Brain becomes a real menu item; the floating Brain button is removed from the app shell.
- Settings sits directly after Brain.
- Alerts row removed (now the bell in the top bar).
- "Create Post" button removed from the sheet (duplicate of the top bar).
- MetaMask connect block removed from the sheet (now the top-bar connect icon).
- Node and Wallet stay as remaining destinations below Settings.
- P2P footer status stays.

## Page menus that bend/bloat

- Explore header: the `+ New Project` button moves out of the page header and into the Projects tab content only, so it appears once and only under Projects. Same button already exists in the Profile > Projects tab — that one stays, the Explore header one is the duplicate being relocated.
- Explore tab list keeps 4 columns but gets label-hides-on-narrow treatment so it stops wrapping.

## Technical notes

Files touched (presentation only):

- `src/components/TopNavigationBar.tsx` — drop desktop nav strip, always render the menu trigger, add Alerts bell (uses `NotificationBadge`) and icon-only MetaMask.
- `src/components/MobileNav.tsx` — rename usage to a shared "AppMenu"; add profile card header, new item order, remove Create Post + MetaMask blocks; trigger no longer `md:hidden`.
- `src/components/navigationItems.ts` — reorder to Explore, Brain, Settings, Node, Wallet; drop Alerts and Profile from the list.
- `src/components/brain/EnterBrainButton.tsx` usage removed from `src/App.tsx`.
- `src/pages/Explore.tsx` — move `CreateProjectModal` into the Projects tab; responsive tab labels.

No routing, data, or auth changes.

## Verification

Playwright pass at 375 / 768 / 1280 / 1920: assert the top bar has no horizontal overflow, the menu opens at every width, the Brain floating button is absent, and `+ New Project` appears exactly once on Explore only under the Projects tab. Screenshots at each width.
