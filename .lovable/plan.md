

## Mobile-ready: Brain Chat panel + Live Room launcher

At 360 px wide the current Brain Chat panel breaks: the 140 px users rail eats the messages column, the floating launcher overlaps the bottom nav, and fullscreen has no safe-area padding. Tighten layout for phones without changing desktop UX.

### 1. `BrainChatLauncher.tsx`
- Always show the room title (drop `hidden sm:inline`) so the LIVE pill isn't a mystery on mobile; clamp width to one line with `truncate`.
- Lift above `MobileBottomBar` on phones: `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` on mobile, `bottom-4` on `md+`.
- Shrink height to `h-11` and reduce padding so it doesn't cover content.

### 2. `BrainChatPanel.tsx` (floating + modal variants)
- **Container size on mobile**: when viewport `<768 px`, switch to a bottom sheet — `inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] w-auto` with `height: min(72vh, 560px)`. Keep the current 560 px / 60 vh sizing for `md+`.
- **Anchor**: `floating` variant pins `left-2 right-2 bottom-…` on mobile (not `left-4`); `modal` variant matches.
- **Users rail collapses to a horizontal strip on mobile**:
  - `<768 px`: render the rail as a single horizontal row above the messages (avatar + mic/cam icons, no name; tap = mention). Height ~56 px, `overflow-x-auto`, `snap-x`. Frees full width for the message column.
  - `md+`: keep today's 140 px vertical rail.
- **Header tightening**: hide the "Brain Chat" wordmark below `sm`, keep the `Users · N` badge, "Voice on" pill, Promote, Maximize, Close. Promote button collapses to icon-only with tooltip when `<sm` (Upload icon, aria-label "Promote to feed").
- **Composer**: `min-h-[40px]`, `text-base` on mobile to avoid iOS auto-zoom (`text-base md:text-sm`); send button `h-10 w-10` square on mobile so it's tap-friendly.
- **Fullscreen mode**: add `pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]` and `px-[env(safe-area-inset-left)] env(safe-area-inset-right)` so notches/home indicator don't clip controls.
- **Long-message reply preview & reply banner**: already truncate — verify they wrap with `break-words` (they do).
- Reply button: today it's `hidden … group-hover:inline-flex` (hover only). On mobile add `inline-flex md:hidden md:group-hover:inline-flex` so touch users can reply.

### 3. `BrainUniverseScene.tsx` (where panel mounts inline)
- Already passes `variant="floating"`. No structural change; the sheet positioning above keeps the panel clear of the in-scene HUD on phones.

### 4. `useIsMobile` usage
- Use the existing `useIsMobile()` hook in `BrainChatPanel` to drive variant-specific class strings (rail orientation, container anchoring, composer sizing). Avoid Tailwind `md:` for the rail flip because the rail component itself needs to render differently, not just restyle.

### Files touched
- `src/components/brain/BrainChatLauncher.tsx` — title always visible, safe-area-aware bottom offset.
- `src/components/brain/BrainChatPanel.tsx` — mobile sheet sizing, horizontal users strip, icon-only Promote, larger composer font, safe-area padding in fullscreen, always-visible reply on touch.

### Acceptance

```text
1. At 360×640 the Brain Chat panel spans the screen with 8 px side gutters and clears the bottom nav (no overlap).
2. Users rail renders as a horizontal scrollable row at the top of the body on phones; vertical 140 px rail returns at ≥768 px.
3. The composer textarea uses 16 px text on mobile (no iOS zoom) and the Send button is at least 40×40 px.
4. Fullscreen mode respects safe-area insets on notched devices.
5. The "Live room" launcher sits above the mobile bottom nav, shows the room title, and never overlaps page content.
6. Promote-to-feed is reachable on mobile as an icon button in the header (aria-label preserved).
7. Reply button is tappable on touch devices without needing hover.
8. Desktop layout (≥768 px) is visually unchanged from today.
```

