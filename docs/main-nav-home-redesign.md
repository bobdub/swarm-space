# Main Navigation + Home Refresh (March 24, 2026)

## 1) Documented Current State (Before this update)

- Main navigation showed `Home`, `Trending`, `Explore`, `Node`, `Wallet`, `Profile`, `Alerts`, `Settings`.
- Logged-in and logged-out users saw the same nav set.
- Explore tabs included `Most Recent`, `Projects`, `People`, and `Trending`.
- Home page styling already used gradients, but did not expose a dedicated command-deck style wrapper.

## 2) Redesign Goals

- Push the home surface to a stronger sci-fi / future-tech visual identity.
- Remove `Home` from main nav for logged-in users.
- Add/rename profile destination to `My Profile`.
- Place `Explore` directly under `My Profile` in navigation order.
- Remove `Trending` from main nav.
- Replace Explore's trending tab with a "Rolling Random" strip above tabs where higher-hype posts are more likely to appear.

## 3) Implementation Notes

- Navigation now resolves from auth-aware helper functions so desktop, mobile sheet, and mobile bottom bar remain aligned.
- Explore now computes a rolling weighted random post using trending score data (credits/views/engagement freshness composite) and animates it across screen.
- Home page sections now use command-deck panels and stronger neon/mesh framing while keeping existing React/Tailwind stack.
