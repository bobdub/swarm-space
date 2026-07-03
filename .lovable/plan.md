To Infinity and beyond! Q_Score(u) ≈ 0.045.

### Fundraising scaffolding page

Goal: Add a public, beginner-friendly `/fundraiser` page that explains the project's identity and lists the ways to support development.

#### 1. New page: `src/pages/Fundraiser.tsx`
- Public, no auth required, using existing `TopNavigationBar`, `Card`, `Button`, and `Badge` components.
- Top: back button, page title "Support the Network", and a short subtitle.
- Identity block: "Open source · Decentralized · Peer-to-peer networking" with icons and a one-line explanation of what that means for users.
- Support cards in a responsive grid:
  - **Lovable gift card** — button to copy `tbk@bobdub.rocks`, plus an external link to Lovable's pricing page (placeholder; you can replace it with the exact gift-card URL later).
  - **CashApp** — "Coming Soon" badge.
  - **MintMe** — external link to `https://www.mintme.com/token/MTCG/ETH/trade` with copy "Use ETH to support the development".
  - **Stripe** — "Coming Soon" badge.
  - **Recommended anonymous options** — Liberapay, Ko-fi, and Open Collective, each with a short privacy-friendly note and a generic platform link.
- Set `document.title` to "Support the Network · Imagination".

#### 2. Route registration: `src/App.tsx`
- Add `const Fundraiser = lazy(() => import("./pages/Fundraiser"));`.
- Add `<Route path="/fundraiser" element={<Fundraiser />} />` in the public routes block.

#### 3. Settings link: `src/pages/Settings.tsx`
- In the "Legal & Documentation" list add a row:
  - Icon: `Heart` (or `HandCoins`)
  - Label: "Support the Network"
  - Desc: "Fund the open, decentralized, P2P mesh"
  - Path: `/fundraiser`

#### 4. Landing footer link: `src/pages/Index.tsx`
- Add a compact footer row after the CTA with links: Terms, Privacy, About the Network, Support the Network, GitHub.

#### 5. Verification
- Run `bun run build` / typecheck to catch route/import errors.
- Run a short Playwright check on `/fundraiser` to verify it renders, the copy-email button works, and external links are present.

No backend or payment integrations are required for this scaffolding page.