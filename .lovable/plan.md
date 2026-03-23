## Plan: Update Whitepaper Page & Documentation to Match Production

### Problem

The Whitepaper page and `docs/PROJECT_OVERVIEW.md` are outdated. They describe the system as it was several sprints ago and miss many features that are now in production, including:

- Three-tier P2P standalone system (SWARM Mesh, Builder Mode, Test Mode)
- Multi-chain blockchain with coin deployment, credit wrapping, cross-chain swaps
- Blog/Book classification system with torrent-wrapped books
- Auto-mining service
- Streaming rooms with recording
- Achievement/badge NFT wrapping
- Quantum Metrics panel with daily burn
- Onboarding walkthrough system
- CREATOR proof mining
- Block transversal and custom extentions for blockchain
  &nbsp;

### Changes

#### 1. Rewrite `src/pages/Whitepaper.tsx`

Update every section to reflect actual production code:

- **Vision** — Minor refresh, mention "Imagination Network" branding properly
- **Hybrid P2P Transport** → **Three-Tier P2P Architecture** — Document the actual SWARM Mesh (Cascade Connect with bootstrap/library/manual phases, PEX, triangle gossip), Builder Mode (manual orchestration), and Test Mode (stability cornerstone). Mention the Never-Rotate identity policy and mutual exclusivity with 2