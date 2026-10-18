## SWARM public RPC installation (2026-10-18)
- [ ] Verify the advertised HTTPS RPC and trace the mesh gateway boundary
- [ ] Validate public eth_chainId before offering installation and test failures
- [ ] Provide the missing public mesh gateway (requires an always-on mesh host if none exists)

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
