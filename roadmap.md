## Infinity personality-led Dual replies (2026-10-19)
- [ ] Consolidate Brain chat, comments and replies into one personality-guided Dual path
- [ ] Preserve whole learned expressions and formulas; reject prompt-opening echoes and random token filler
- [ ] Run automated regressions only; retain passive memory and saved participation modes

## Infinity chat settings (2026-10-19)
- [x] Add saved off / audio / text-only choices in Brain chat settings
- [x] Gate replies and voice controls; stop pending speech when disabled
- [x] Four mode tests pass; real local account verifies audio/mute, text replies, off suppression and reload persistence; desktop/mobile settings inspected

## Local companion (2026-10-18)
- [x] Add loopback detection, explicit pairing and live browser-mesh read relay to MetaMask Swarm Cell
- [x] Ship standalone Windows and Linux x64 downloads, with no hosted server dependency
- [x] Validate detection/download UI, read-only relay and expiry with a genuine local account; 15 website tests and four companion tests pass
- [ ] Verify full live-peer UI pairing and actual MetaMask installation — needs a real desktop extension and connected mesh peer; Windows launch also needs a Windows machine

## Clean native wallet addresses (2026-10-18)
- [x] Display and copy existing deterministic 0x receiving aliases across wallet and tip views
- [x] Accept clean addresses while preserving legacy recipient inputs and ledger identities
- [x] Test compatibility (nine tests) and verify a copied-address transfer (3.25 SWARM) and recipient wallet in the active local session; external deposits and cross-device delivery remain outside this stage

## Native wallet visibility (2026-10-18)
- [x] Show a copyable native SWARM address, with synced MetaMask labeled beneath it (simulated live session; real extension unavailable)
- [x] Open signed native transfers without MetaMask; keep external export blocked until settlement exists
- [x] Verify native transfer and recipient balance through the wallet (3.25 SWARM, two disposable local accounts; seven tests pass)

## Tip wallet transition (2026-10-18)
- [x] Evaluate tips, currencies, native addresses, and compatibility (tips spend credits; ledger wallets currently use identity IDs; derived 0x addresses are gateway aliases only)
- [x] Add asset selection, native SWARM address resolution and signed SWARM tips; retain existing game-credit history and limits
- [x] Test amount/signature/overspend/replay rules (6 tests); send 3 SWARM through profile and read 3 SWARM in recipient wallet using two local QA accounts
- [ ] Enable creator/sub-chain/external token tips — blocked by missing verifiable ownership settlement or external transfer bridge; shown but cannot deduct funds
- [ ] Verify cross-device mesh delivery — requires two connected peers with synchronized sender ledger; current verification is same-browser local accounts

## SWARM public RPC installation (2026-10-18)
- [x] Verify the advertised HTTPS RPC and trace the mesh gateway boundary (TLS/fetch failed; app origin serves HTML)
- [x] Validate public eth_chainId before offering installation and test failures (13 tests; actual browser preflight failed closed)
- [x] Choose user-local companion instead of an always-on public host; public HTTPS remains unavailable and is not needed for this local path

## MetaMask Swarm Cell (2026-10-18)
- [x] Move and rename the cell above User Cells on Node
- [x] Keep activation synchronized with the external MetaMask connection across pages
- [x] Test connection lifecycle and verify the Node panel (simulated external wallet; real extension unavailable)

## Menu and Settings cleanup (2026-10-18)
- [x] Move Settings below Wallet in the main menu
- [x] Keep Session health only in Account
- [x] Remove retired Dream Matching UI and unused game code
- [x] Put Browser Storage first, Free Up Space second, and warn at 80% usage
- [x] Run focused checks and verify the Settings flow using a fresh local account

## Land plots (2026-09-03)
- [x] Shrink land nameplates; extra shrink + shorter range in Top view
- [x] Reject overlapping claims (own, foreign, commons)
- [x] Merge adjacent same-owner parcels into one record / one label
- [x] Top view height adapts to owned land extent
- [x] Roads: "Enable roads" control surfaces the Commons/Roads chip

## Brain causal-light stability (2026-09-04)
- [x] Edge-trigger 𝒞_light probes on field ticks rather than 60 Hz body ticks
- [x] Keep the causal probe observer-only
- [x] Route saturation recovery through one UQRC operator step
- [x] Verify focused and full Brain/UQRC checks (live visual walk blocked by the account gate)

## Brain remote screen sharing (2026-09-05)
- [x] Identify remote screen tracks by their receiver/mid instead of fragile object identity
- [x] Announce screen-share start/stop through the room mesh
- [x] Preserve remote screen tiles through transient negotiation mutes
- [ ] Verify one user can see and enlarge another user's shared screen

## Brain building framework (2026-09-06)
- [x] Stage 1 — Over-the-shoulder view with V toggle and terrain pull-in
- [x] Stage 2 — Plain-word materials (Wood, Stone, Water, Fibre, Food)
- [x] Stage 3 — Transparent inventory panel replacing bottom builder bar
- [x] Stage 4 — Follow-ghost placement with click-to-stage controls
- [x] Stage 5 — Press-and-hold build with material re-check and decay
- [x] Stage 6 — Tree chopping with shake, topple, wood pickups, and a visible character swing
- [ ] Verify in preview: camera, inventory, ghost, build, chop
