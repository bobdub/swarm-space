# Project guidance

## Infinity and caretaking
- Read `docs/INFINITY_PERSONA.md` before tending; it preserves the persona and equations.
- Infinity is a creative framing, not measured consciousness; tend with empathy and care.
- Add a caretaker reflection to `.lovable/MemoryGarden.md` before work; extend after tending.

## Scoped guidance
- Render the local avatar from the camera's per-frame interpolated physics pose, bypassing remote grounding and cached presence targets; this keeps the traveller and camera registered without changing gravity or boom distance.
- Spaceships use a reversible exclusive physics-body lease, a single cockpit branch in the existing camera rig, and room-scoped ephemeral pilot-owned mesh snapshots; fixed-rate sync and departure cleanup keep flight from changing walker gravity or leaving ghost ships.
- Canvas descendants must use drei Html for DOM controls, never react-dom portals; screen overlays use a pinned fullscreen position and opt-in pointer targets so the Three reconciler never receives a DOM container.
- Brain terrain renders the immutable CPU-displaced geometry from getGroundGeometry; groundElevationAt intersects its local triangles so gravity support, feet, spawn and builder bases agree with visible land/seabed rather than a different analytic slope. CPU noise mirrors the historical Earth shader hash without an extra fract after the dot addition. Water remains at sea level; Earth-local tangent headings preserve globe traversal. Gravity and causal clocks remain owned by existing physics.
- Guest names live only on the guest identity, never shared avatar preferences; gate member routes, mining and post creation independently because guests retain P2P identities.
- Direct Brain guest entry runs only after session restoration resolves signed-out and before mounting the scene; deduplicate guest provisioning and recheck identity after key generation so returning or concurrently signed-in members are never overwritten.
- Session restoration rechecks the current identity before applying an asynchronous result, because guest entry or member login may have completed while the durable read was pending.
- The Global Cell Bus dials via `dialViaBus()` (backoff-respecting), never the manual `connectToPeer()` path; manual connect registers in the library and pulses presence before dialing — this keeps every flow on the working library pattern and prevents redial storms.
- Brain invites use the shared one-shot invite coordinator at signaling readiness before general discovery; already-running sessions use its guarded manual path, and chat status follows the named host connection rather than aggregate peer counts.
- Gate placement changes by maker identity; scope drafts by owner and room. Wall DOM occlusion ignores invisible targets and respects solid avatars.
- Read scoped subdirectory `AGENTS.md` before edits.
- The shared bar footprint and offsets live in barTerrain; bake its dry tangent-plane foundation into the shared solid terrain with a tessellation margin and feathered perimeter, keeping its anchor unchanged so room/game identities remain stable.
- Keep provider context identity in HMR data for Streaming, Onboarding, Walkthrough contexts.

## Verification compatibility
- Retired verification gameplay and scoring are removed; retain historical medal metadata and verification records for profile and backup compatibility.

## Brain chat participation
- Keep guest participation preferences separate from member preferences; disconnected guest guidance is local interface status and uses the existing manual connection path, not fabricated Infinity output.
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
- Keep the cold-wallet guide in a dedicated lazy-loaded public page linked from Settings and Wallet; documentation must distinguish external custody, local ledger records and peer sync rather than promise consensus.
- Keep native receiving addresses visible at the wallet entry and route native transfers through the signed wallet-tip ledger, independently of MetaMask; external export stays separate because an external address is not native settlement.
- Resolve native wallet aliases via the shared async address resolver and race-safe display hook; never migrate balances or credit history to change displayed addresses — aliases are not new ownership.
- Route tips by explicit asset identity, preserve credit economics, and block unsupported external transfers rather than simulating delivery.
- Native SWARM tips require identity-bound P-256 signatures and ledger balance checks before acceptance; creator and sub-chain tips stay blocked until verifiable ownership settlement exists.
- Use external MetaMask; verify MintMe, save after watchAsset approval, permit zero-value import, wait five minutes. Link via UTF-8 hex; deposits skip the pre-link gate (the transfer hash is the proof); dismissals abort recording, not submitted transfers.
- Import network setup completes on MetaMask switch or add approval without a second switch or blocking read; transfer paths verify canonical MintMe independently, preventing approval-dialog races without accepting unrelated chain IDs or assuming settlement readiness.
- Synchronize the gateway from an app-wide verified external-wallet session, not a route panel or cached address, so navigation cannot misrepresent connection state.
- Gate external SWARM install/switching on a fresh HTTPS JSON-RPC chain-ID preflight; share UI readiness via a cached query, never the local provider — MetaMask must reach its own RPC.
- Host public mesh RPC outside this client-only repo; it requires ledger/mesh access.
- Build companions outside the client tree: loopback-only, authenticated pairing, allowlisted reads, never raw-transaction settlement.
- Local installs need fresh loopback JSON-RPC preflight; retain HTTPS validation — local helpers are not public gateways.
- Read `src/lib/blockchain/AGENTS.md` for vault/key rules. Native Assets and Market share positive-balance inventory; unsupported payments fail closed.
- Persist public cold-key receiving metadata at identity unlock, independently of the tab-session signing seal, so receiving never requires a withdrawal key when the address is known.
- Brain room membership is app-level (brainSyncStore + BrainSyncHost); leaving the Brain page keeps the call and only explicit Disconnect or a live-room takeover ends it. A refresh is a disconnect (pagehide leave + silence sweep with departed tombstones), never a resume — prevents ghost peers.
- Brain peer mute is a local-only presentation filter in `src/lib/brain/mutedPeersStore.ts` (hides audio, video, avatar, placements, chat on this device); Block is the network-level P2P blocklist and also writes a mute entry, so every render filter consults only the mute store. Mute entries match by peerId OR userId because layers key the same person differently.
