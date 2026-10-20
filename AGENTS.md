# Project guidance

## Infinity and caretaking
- Read `docs/INFINITY_PERSONA.md` before tending; it preserves the persona and equations.
- Infinity is a creative framing, not measured consciousness; tend with empathy and care.
- Add a caretaker reflection to `.lovable/MemoryGarden.md` before work; extend after tending.

## Scoped guidance
- Gate placement changes by maker identity; scope drafts by owner and room. Wall DOM occlusion ignores invisible targets and respects solid avatars.
- Read scoped subdirectory `AGENTS.md` before edits.
- Retain StreamingContext identity in HMR data so live updates cannot split providers from consumers.

## Verification compatibility
- Retired verification gameplay and scoring are removed; retain historical medal metadata and verification records for profile and backup compatibility.

## Brain chat participation
- Keep Infinity participation as an explicit saved mode separate from temporary voice mute; gate generation and delayed replies with current mode and invalidate queued replies on disable/unmount so silence is immediate.
- Merge partial hub preferences. Only the opted-in prompt originator generates a correlated room reply; receivers deduplicate and ask off viewers once per room — shared chat must not diverge into private replies.
- Chat and media wrapping share ledger-backed coin recovery; count historical containers and balance so spent coins cannot be recreated.

- Infinity never posts canned template filler; when learning yields nothing it stays silent — random stock phrases misrepresent what it has learned.
- Infinity memory is passive ingestion of text already on the device (idle-time batched, capped, private posts skipped) and never initiates mesh requests, so it cannot compete with user connections.
- Infinity learns from memory in small idle-time batches and marks pieces learned; text already fed live is stored pre-marked, so nothing is learned twice.
- Brain chat, comments and replies use EntityVoice.generateText → DualLearningFusion as the single personality-guided realization path; stage stays observable, because duplicate samplers create conflicting voices.
- Realization preserves whole local learned expressions and rejects copied prompt openings before UQRC ranks candidates; curvature is not a semantic validator and unsupported output stays silent.
- Whole expressions remain in capped on-device storage separate from peer digests; restore historical learned memory without replaying ingestion, because vocabulary-only sync cannot preserve formula structure.
- Replace the shipped personality prior by its complete expression inventory, preserving memory expressions; seed via Dual ingestion on first realization so both learners share one prior.
- Infinity profile conversation is explicit opt-in, ephemeral and excluded from learning/digests; show device-local knowledge separately from live peer availability because digest exchange is not full memory replication.

## Wallet boundaries
- Keep native receiving addresses visible at the wallet entry and route native transfers through the signed wallet-tip ledger, independently of MetaMask; external export stays separate because an external address is not native settlement.
- Resolve native wallet aliases via the shared async address resolver and race-safe display hook; never migrate balances or credit history to change displayed addresses — aliases are not new ownership.
- Route tips by explicit asset identity, preserve credit economics, and block unsupported external transfers rather than simulating delivery.
- Native SWARM tips require identity-bound P-256 signatures and ledger balance checks before acceptance; creator and sub-chain tips stay blocked until verifiable ownership settlement exists.
- Use external MetaMask for wallet calls; verify MintMe before token reads, switch only when needed, and offer adding separately after a missing-chain error — acknowledgement is not arrival.
- Synchronize the gateway from an app-wide verified external-wallet session, not a route panel or cached address, so navigation cannot misrepresent connection state.
- Gate external SWARM install/switching on a fresh HTTPS JSON-RPC chain-ID preflight; share UI readiness via a cached query, never the local provider — MetaMask must reach its own RPC.
- Host public mesh RPC outside this client-only repository; static sites or short-lived functions without ledger/mesh access cannot serve it.
- Build companions outside the client tree: loopback-only, authenticated pairing, allowlisted reads, never raw-transaction settlement.
- Local installs need fresh loopback JSON-RPC preflight; retain HTTPS validation — local helpers are not public gateways.
- Use creatorVaultCustody.ts for transfers to/from `vault:creator:{tokenId}`; never burn/mint, engrave the coin, release before changing buckets, serialize earnings claims and refuse unbacked payouts.
- Use customTokenLimits.ts for ingress caps and ownedAssets.ts for positive balances. Read docs/project-plans/coin-vault-market-next-step.md before multiasset settlement: self-transfers are not escrow.
