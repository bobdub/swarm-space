## Goal

In **Wallet → Creator**, let a creator upload a banner image for their Creator Token, and add a button that jumps straight to their profile Market tab.

## What gets built

### 1. Banner field on the token record
`CreatorToken` already has an optional `image` field (used as a 16×16 avatar in the market header). Add a sibling optional `banner?: string` (data URL) so the square logo and the wide banner stay independent.

New helper `updateCreatorTokenBanner(userId, banner | null)` in `src/lib/blockchain/profileToken.ts` that loads the token via `getProfileToken`, sets/clears `banner`, saves via `saveProfileToken`, and dispatches a `creator-token-updated` window event. Purely a metadata edit — no credits, no SWARM, no chain transaction, no effect on redeploy/permanence rules.

### 2. Banner uploader in Wallet → Creator
In the deployed-token card in `src/pages/Wallet.tsx`:
- Show the current banner (or a dashed empty state) as a wide 3:1 strip at the top of the card.
- "Upload banner" button opens a hidden `<input type="file" accept="image/*">`.
- Client-side downscale in a `<canvas>` to max 1200px wide, export as JPEG (quality ~0.82) so the stored data URL stays small; reject files over 8 MB before reading and show a toast.
- "Remove banner" button when one exists.
- Save through `updateCreatorTokenBanner`, then refresh local state.

### 3. "Open my Market" button
Next to Rename/Redeploy, a primary button navigating to `/profile?tab=market` (Profile already reads the `tab` search param and has a `market` tab). Shown only when a token is deployed.

### 4. Banner on the market header
In `src/components/profile/CreatorMarketTab.tsx`, when `token.banner` exists, render it as a full-width image strip at the top of the existing header card (rounded, `object-cover`, ~3:1, `alt` = `${token.name} banner`). Existing avatar/name/price row is unchanged and still renders below it.

## Technical notes

- Banner lives with the token record in IndexedDB (same store as the rest of the token metadata) — no new store, no DB version bump, `banner` is optional so old records load fine.
- Downscaling keeps the data URL in the low hundreds of KB, safe for IndexedDB and for the record's P2P propagation path.
- No `<form>` elements; buttons use `type="button"` per project convention.

## Verification

- Typecheck.
- Live-preview pass with Playwright: open `/wallet` → Creator tab, upload a small generated PNG, confirm the banner strip renders and persists after a reload; click "Open my Market" and confirm it lands on `/profile?tab=market` with the banner shown in the market header.

## Files touched

- `src/lib/blockchain/types.ts` (add `banner?`)
- `src/lib/blockchain/profileToken.ts` (add `updateCreatorTokenBanner`)
- `src/pages/Wallet.tsx` (uploader + market button)
- `src/components/profile/CreatorMarketTab.tsx` (render banner)
