# Fix the top header being cut off at the ends

## What is wrong

The header bar is a single flex row (`mx-auto max-w-7xl` inside a `fixed` header with `px-0`) whose children mostly refuse to shrink:

- The header has no outer horizontal padding, so the bar's left and right borders sit flush on the viewport edges — the bar looks sliced off at both ends.
- The right-hand cluster (Create button, credit balance, P2P status, MetaMask, App Health) is all `flex-shrink-0`, and the health badge is hard-clipped with `max-w-[220px] overflow-hidden`. When the row runs out of room the last items are visually truncated rather than dropped.
- The desktop nav is a hidden-scrollbar `overflow-x-auto` strip, so its first/last items can sit half-cut with no visible affordance.

## Fix (presentation only, `src/components/TopNavigationBar.tsx`)

1. Give the bar breathing room and finished ends: horizontal padding on the `header` (`px-2 sm:px-3 lg:px-4`) and a rounded bar (`rounded-2xl`) so both ends are visibly complete instead of clipped by the viewport.
2. Make the row honestly fit instead of clipping:
   - Priority order for the right cluster as width shrinks: App Health hides below `lg`, MetaMask stays `lg+` (unchanged), credit balance stays `sm+`, P2P status and Create always visible.
   - Remove the `max-w-[220px] overflow-hidden` clip on the health badge; let it size naturally with `min-w-0` and `truncate` on its text so it never gets sliced mid-glyph.
   - Add `min-w-0` where needed so flex children can shrink rather than overflow.
3. Keep the nav strip scrollable but not deceptive: keep `overflow-x-auto`, add small left/right padding inside the strip so the first/last pill is never flush against a cut edge.

No routing, data, or behaviour changes. `--app-header-h` measurement and body padding stay as they are.

## Verification (must pass before reporting success)

The app is behind a local identity gate, so the check script must first create a local account in the preview, then for each width in 375 / 768 / 965 / 1280 / 1440 / 1920:

- assert the bar's `scrollWidth <= clientWidth` (no horizontal overflow inside the bar),
- assert the bar's bounding box is fully inside the viewport (`left >= 0`, `right <= innerWidth`),
- assert every direct child of the bar is fully inside the bar's box (catches cut-off ends),
- capture a screenshot of the header region at each width for visual confirmation.

Success is only reported if all assertions pass at every width and the screenshots show complete, uncut ends.

## Files

- `src/components/TopNavigationBar.tsx`
