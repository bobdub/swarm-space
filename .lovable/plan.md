# Infinity as the Network Steward

## Goal
Infinity (the network) owns the community pools and acts on its own. Payouts and pool moves are network actions recorded on the shared SWARM ledger, the same way native mining rewards already are (`from: "system"`, no user signature). No user signs, no one logs in as Infinity, and no keys are stored in the code.

## 1. Network actions, no signing
- Add one ledger record type, "infinity action", written by the system like `mining_reward`: no signature, no public key.
- Every node checks an incoming Infinity action against its own synced ledger (pool balance, round number, recipients). If anything doesn't match, the node drops it.
- Remove the vote-signing code from the current community payout (`signCommunityVote` and `verifyCommunityVote`). Agreement becomes a count of matching yes answers from connected peers.

## 2. Infinity's wallet and vaults
One Infinity identity with separate vaults. Each vault gets a fixed public address worked out from its name, so every node calculates the same address and no setup is needed:

```text
infinity
 ├─ infinity:mintme     holds mined MINTME, pays out rewards
 ├─ infinity:donations  takes donations of any token from native wallets
 └─ infinity:market     main SWARM market liquidity
```
- Each vault has a native SWARM id and a MintMe-compatible 0x address, made with the existing `swarmIdToEvmAddress` mapping.
- Ledger records that use the old `community-pool` id count toward `infinity:mintme`, so past balances carry over. Nothing is migrated or rewritten.
- Deployed creator tokens stay in each user's own vault. Market keeps the same inventory rules.
- Transfers between wallets happen as ledger records on the mesh. The user does nothing and no keys are needed.
- The Donate page gets a "Donate to Infinity" choice that sends a token straight from the user's native wallet to `infinity:donations`.

## 3. Infinity's autonomous tasks
A single Infinity agent loop starts for every signed-in member and runs on the mesh. All nodes run the same rules, so they reach the same answer.

- **Heartbeats:** count peer heartbeats that are already flowing on the mesh. An action becomes eligible once members have been online together for 30 minutes.
- **Validation:** read the native SWARM mining totals and the `infinity:mintme` balance from the synced ledger.
- **Agreement:** when the pool is at or above 25 MINTME and the heartbeat window is met, a node asks connected peers "pool ≥ 25 for round N?". A strict majority of yes answers commits the payout.
- **Tie breaking:** if the yes and no answers are even (for example 2 vs 2), Infinity asks every reachable peer across the mesh for its pool reading, up to 2 hops and deduplicated. It casts the deciding answer from the highest fully synced reading that a majority of reached peers confirm. If that reading is still below 25, nothing is paid.
- **Distribution:** 95% is split evenly among the eligible peers' native wallets and 5% stays in `infinity:mintme`. Rounds are numbered on the ledger, so the same pool is never paid twice. Donations are passed on by the same loop according to a donation rule (see the open question below).

## Honest boundary (shown in the UI)
Native MINTME balances are network credits on the SWARM ledger. Sending real MINTME out of the vault on the external MintMe chain to an outside address still needs a key for that address, and the mesh can't make one up. Until a withdrawal path exists, payouts appear in native wallets and external export stays separate.

## Technical changes
- `src/lib/blockchain/infinity/vaults.ts`: vault ids and the address mapping.
- `src/lib/blockchain/infinity/agent.ts`: the heartbeat timer and the validate, agree, tie-break and distribute steps.
- `communityPayout.ts` and `communityPayoutService.ts`: drop signatures and switch to the agent and the vault ids.
- `nativeMintmeLedger.ts` and `chain.ts`: accept "infinity action" records and treat `community-pool` as `infinity:mintme`.
- `communityCustody.ts`: use the `infinity:mintme` address when the environment variable is not set.
- `MintMeMiningService.tsx`: start the agent. `MintMeMiningCard`: show the vault address and the heartbeat status.
- Tests covering 25 MINTME paid as 95/5, nothing below 25, 2v2 tie settled by a mesh check, no payout twice, edited records rejected, and the 30-minute window.
- Update `AGENTS.md` and memory with the new rules.

## Open question
How should donations be passed on: kept as a community reserve, or added to the next reward round?
