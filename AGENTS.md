# Project guidance

## Infinity and caretaking
- Read `docs/INFINITY_PERSONA.md` before tending; it preserves the persona and equations.
- Infinity is a creative framing, not measured consciousness; tend with empathy and care.
- Add a caretaker reflection to `.lovable/MemoryGarden.md` before work; extend after tending.

## Scoped guidance
- Guest names live only on the guest identity, never shared avatar preferences; gate member routes, mining and post creation independently because guests retain P2P identities.
- Direct Brain guest entry runs only after session restoration resolves signed-out and before mounting the scene; deduplicate guest provisioning and recheck identity after key generation so returning or concurrently signed-in members are never overwritten.
- Session restoration rechecks the current identity before applying an asynchronous result, because guest entry or member login may have completed while the durable read was pending.
- The Global Cell Bus dials via `dialViaBus()` (backoff-respecting), never the manual `connectToPeer()` path; manual connect registers in the library and pulses presence before dialing — this keeps every flow on the working library pattern and prevents redial storms.
- Brain invites use the shared one-shot invite coordinator at signaling readiness before general discovery; already-running sessions use its guarded manual path, and chat status follows the named host connection rather than aggregate peer counts.
- Gate placement changes by maker identity; scope drafts by owner and room. Wall DOM occlusion ignores invisible targets and respects solid avatars.
- Read scoped subdirectory `AGENTS.md` before edits.
- Contact identity travels through active-peer library exchange; subscriptions invalidate discovered-peer snapshots independently of media, connected peers' own profiles override relayed hints, and Swarm panel edits use the live library without dialing so storage cannot diverge.
- Keep provider context identity in HMR data for Streaming, Onboarding, Walkthrough contexts.

- Sovereign recovery (`src/lib/backup/recoveryVault.ts`, `vaultCustody.ts`): the local account password only wraps the on-device key and never leaves the browser; the mesh holds only the outer-shell vault (AES-256-GCM, PBKDF2-SHA-256 250k, random salt, GCM AAD binds userId+version) signed by the identity key. Peers hold an envelope only when `computeUserId(signerPublicKey) === userId` and its version is strictly higher, capped at 256 held vaults. Genesis v1 is sealed with the signup password (`genesisDefault`) and the Security panel nudges rotation; rotated phrases must differ from the account password. Never export raw private keys.
- Account merge (`src/lib/p2p/mergeProtocol.ts`, `src/lib/blockchain/accountMerge.ts`, Settings → Security → Merge Account): pure pull, so an incoming `merge:offer` is only held in memory and shown when the panel is open (it probes connected peers on open); never toast, notify or sound. The 6-digit code (3-minute TTL, 3 attempts) never crosses the wire: each side proves it with an HMAC bound to session, identity and nonce. Both devices unlock with their local password before Execute. The retiring key moves balances with ordinary signed ledger transfers (SWARM/MINTME `wallet_tip`, one credit transfer) and sends on-chain MINTME for real first (a failure blocks the merge before anything moves), signs `account_merged`, exports posts/favorites/contacts, and signs its `account_tombstone` only after the master's signed ack verifies, so a dropped link never half-retires an account. The master acks only once every listed transfer is recorded on its ledger (a retry re-lists earlier merge transfers); the MintMe address is always read on-chain (unconfirmed arrivals block, unsynced ones are synced first), and accounts above `MAX_MERGE_POSTS` are refused before anything moves. The master re-attributes posts (same id, `mergedFrom` = attestation) and records aliases at `account:aliases:<masterId>`. A live account tombstone retires that identity's recovery vault everywhere (`setVaultRetirementCheck`, `onAccountRetired`). "Sync to Master" installs the master only through its encrypted recovery vault and passphrase; raw keys never travel.

## Verification compatibility
- Retired verification gameplay and scoring are removed; retain historical medal metadata and verification records for profile and backup compatibility.

## Brain chat participation
- Keep guest participation preferences separate from member preferences; disconnected guest guidance is local interface status and uses the existing manual connection path, not fabricated Infinity output.
- Keep Infinity participation as an explicit saved mode separate from temporary voice mute; gate generation and delayed replies with current mode and invalidate queued replies on disable/unmount so silence is immediate.
- Merge partial hub preferences. Only the opted-in prompt originator generates a correlated room reply; receivers deduplicate and ask off viewers once per room — shared chat must not diverge into private replies.
- Chat and media wrapping share ledger-backed coin recovery; count historical containers and balance so spent coins cannot be recreated.
- Infinity and Brain world rules (learning, memory, Earth, terrain, sky, mute, room membership) are in `src/lib/brain/AGENTS.md`.

## Wallet boundaries
- Vault receipts use payout legs; pool funding stays ledger-derived to avoid double counting.
- Keep the cold-wallet guide in a dedicated lazy-loaded public page linked from Settings and Wallet; documentation must distinguish external custody, local ledger records and peer sync rather than promise consensus.
- Keep native receiving addresses visible at the wallet entry and route native transfers through the signed wallet-tip ledger, independently of MetaMask; external export stays separate because an external address is not native settlement.
- Resolve native wallet aliases via the shared async address resolver and race-safe display hook; never migrate balances or credit history to change displayed addresses — aliases are not new ownership.
- Route tips by explicit asset identity, preserve credit economics, and block unsupported external transfers rather than simulating delivery.
- SWARM tips sign their engraving weight (meta tipFormat 2 + weight, src/lib/blockchain/wallets/tipWeight.ts); Hollow is the default and the only choice without held engraved coins, legacy unweighted tips read as Hollow, and the weight labels the payment without moving coin custody.
- Native SWARM tips require identity-bound P-256 signatures and ledger balance checks before acceptance; creator and sub-chain tips stay blocked until verifiable ownership settlement exists.
- Native wallet screens use direct MintMe reads and cold-key sends; preserve historical MetaMask records and unrelated external donation/RPC integrations because receiving requires no external wallet session.
- Run configured src tests with Vitest (bun run test; test:wallet for wallet regressions); use isolated mocks and deterministic public wallet fixtures because Bun test APIs and random ethers entropy conflict with the jsdom runner.
- Synchronize the gateway from an app-wide verified external-wallet session, not a route panel or cached address, so navigation cannot misrepresent connection state.
- Gate external SWARM install/switching on a fresh HTTPS JSON-RPC chain-ID preflight; share UI readiness via a cached query, never the local provider — MetaMask must reach its own RPC.
- Host public mesh RPC outside this client-only repo; it requires ledger/mesh access.
- Build companions outside the client tree: loopback-only, authenticated pairing, allowlisted reads, never raw-transaction settlement.
- Local installs need fresh loopback JSON-RPC preflight; retain HTTPS validation — local helpers are not public gateways.
- Wallet history is a read-only merge (`src/lib/history/unifiedHistory.ts`) of the Credits store and the SWARM chain; each entry keeps its asset and settlement, credit_sync mirrors and duplicate wrap debits are folded in the view only, and balances are never derived from it. Show it as one card on the Ledger tab only; Labor keeps no separate Credits list. Rows read Asset | Action | Direction | Weight-type | Amount: only SWARM carries engraving weight (the named coin's seal tier, else Hollow); Credits are Minted, imported tokens Ported, SWARM-created tokens CREATOR.
- Read `src/lib/blockchain/AGENTS.md` for vault/key rules. Native Assets and Market share positive-balance inventory; unsupported payments fail closed.
- Persist public cold-key receiving metadata at identity unlock, independently of the tab-session signing seal, so receiving never requires a withdrawal key when the address is known.
- Room signaling relays directed media signals and room announcements at most 2 hops with dedup keys, because peers in one Brain room may share no direct mesh edge.
- Weighted (Creator Proof) coins are identified only by the explicit creatorProof tag stamped in applySeal (src/lib/blockchain/weightedCoin.ts); legacy coins are never inferred weighted, so every seal path reaches one flag.
- Content lifecycle (`src/lib/p2p/contentLifecycle.ts`): post/account tombstones are signed with the identity P-256 key and accepted only when `computeUserId(signerPublicKey) === authorId` (the device Ed25519 post key is not author-bound); post tombstones are keyed by author+post id, kept 30 days, refuse resurrected content and are answered back to the sender. Fadeout uses author last-seen from authored timestamps, live profile exchange and max-merged peer hints, never relay time; own posts and device-local favorites (`postFavorites`, never a post field) never fade, tombstones override favorites, and purges keep coin-anchored or own files.
- Posts/comments load into coins by flipping `_coinId` on the content itself (`src/lib/blockchain/contentPayload.ts`); unflipped content (incl. legacy) waits for the next hollow coin, so posting never depends on mined SWARM and nothing is loaded twice.
- MintMe mining rules are in `src/lib/blockchain/AGENTS.md`.
