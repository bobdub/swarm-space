# Update /donate page to community-token fundraising hub

## Goal
Replace the current generic donation page with a creator/project-centric fundraising page that highlights community tokens on MintMe and explains what each fund supports.

## Content structure (provided by user)
1. Page title: "Donate • Support the Community • Fuel Creation"
2. Hero: "Help Keep the Community Moving" with a short manifesto about supporting creators, shows, projects, and community growth.
3. Token/creator cards:
   - Quantum Gathering — fund Swarm Space liquidity and ecosystem
   - DWMW — fund the community web show/production
   - MTCG — fund the founding community and builders
   - bobdubbloon — behind-the-scenes production/editing/management
   - Ottoken — voice acting, podcasting, and creator presence
4. Closing CTA: "Every Contribution Helps" — choose what to support, momentum for creators, "Support creativity. Fuel community. Keep the network moving."

Each card links to its MintMe trade URL as provided.

## Implementation
- Rewrite `src/pages/Donate.tsx` to use the new content.
- Keep the existing page shell (`TopNavigationBar`, responsive container, back button).
- Reuse existing card/button components and Tailwind tokens; avoid hardcoded colors outside the design system.
- Add external-link buttons for each token trade URL.
- Update `document.title` to match the new page title.
- Preserve the existing `/fundraiser` alias route in `App.tsx` (no route changes needed).

## Verification
- Build passes without errors.
- Visual check of /donate at desktop and mobile widths confirms all five token cards render, links open the correct MintMe URLs, and no layout overlap with the top navigation occurs.
