# Fix header overlapping page content

## Problem
The fixed top bar wraps onto multiple rows at mid widths (roughly 768–1100px, as in the screenshot), so it grows taller than the fixed page offset. The page body reserves only a hard-coded `padding-top: clamp(4.5rem, 14vw, 7.5rem)` in `src/index.css`, so once the bar wraps, it covers the Explore filter/menu row underneath.

## Fix (presentation only)

1. **Measure the real header height.**
   In `TopNavigationBar.tsx`, attach a ref to the bar and use a `ResizeObserver` to write the measured height into a CSS variable on `document.documentElement` (`--app-header-h`). Clean up on unmount.

2. **Use the measured value for the page offset.**
   In `src/index.css`, set a sane default (`--app-header-h: 4.5rem`) and change `body { padding-top: ... }` to `calc(var(--app-header-h) + 0.75rem)`. Content then always clears the bar, no matter how many rows it occupies.

3. **Stop the bar from wrapping in the first place.**
   In the desktop nav row, replace `flex-wrap` with `flex-nowrap` plus `overflow-x-auto` and tighten padding/tracking at the `md` breakpoint so links stay on one line and scroll horizontally instead of pushing the bar taller.

No behaviour, routing, or data changes — only layout/styling.

## Files
- `src/components/TopNavigationBar.tsx`
- `src/index.css`

## Verification
Load `/explore` in the live preview at 965px wide (the reported width) plus 375px and 1440px, screenshot each, and confirm the header sits on one row and the Explore tab row ("Most Recent / Trending / People / Projects") is fully visible below it.
