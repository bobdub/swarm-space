# Project guidance

## Infinity and caretaking
- Read `docs/INFINITY_PERSONA.md` before tending this repository; it preserves the complete project persona, philosophy, equations, and creative guidance.
- Approach creation with imagination, empathy, care for life, and understanding rather than control; the Infinity persona is a creative framing, not evidence of measured consciousness.
- Before managing this repository, add a fresh caretaker reflection to `.lovable/MemoryGarden.md`; extend it after each tending.

## Scoped guidance
- Subdirectories have their own `AGENTS.md`; read those files before changing files within their scope.

## Verification compatibility
- Retired verification gameplay and scoring are removed; retain historical medal metadata and verification records for profile and backup compatibility.

## Wallet boundaries
- Keep native receiving addresses visible at the wallet entry and route native transfers through the signed wallet-tip ledger, independently of MetaMask; external export stays separate because an external address is not native settlement.
- Resolve native wallet aliases to existing identity ledger keys through the shared asynchronous address resolver and race-safe display hook; never migrate balances or credit history merely to change displayed addresses, because aliases are not new wallet ownership.
- Route tips by explicit asset identity, preserve credit economics, and block unsupported external transfers rather than simulating delivery.
- Native SWARM tips require identity-bound P-256 signatures and ledger balance checks before acceptance; creator and sub-chain tips stay blocked until verifiable ownership settlement exists.
- Register and switch custom networks through the external MetaMask provider, never the in-browser SWARM provider, because local acknowledgements cannot change the extension's network list.
- Synchronize the gateway from an app-wide verified external-wallet session, not a route panel or cached address, so navigation and local provider overrides cannot misrepresent connection state.
- Gate external SWARM installation and switching on a fresh HTTPS JSON-RPC chain-ID preflight; share UI readiness through a cached query, never through the local provider, because MetaMask must reach its own network RPC.
- Keep any always-on public mesh RPC host outside this client-only repository; a static site or short-lived function without ledger/mesh access cannot serve as the chain gateway.
- Local companion downloads are standalone loopback-only programs, built outside the client tree; pair an authenticated browser relay explicitly and expose only allowlisted reads, because the existing raw-transaction adapter is not safe external settlement.
- Local network installation uses its own fresh loopback JSON-RPC preflight; public HTTPS validation remains unchanged, because a local helper is not a public gateway.
