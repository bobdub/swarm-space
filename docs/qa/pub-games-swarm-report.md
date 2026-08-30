# Pub Games + SWARM layer — test report (2026-08-30)

## What was tested

| Check | Result |
| --- | --- |
| `bunx tsgo --noEmit -p tsconfig.app.json` | pass, no output |
| `bunx vitest run src/lib/pub src/lib/world src/lib/brain` | pass — 22 files, 123 tests (7 darts, 7 new stakes/drinks) |
| Build (`/tmp/observability/build-errors.log`) | build OK |
| Headless load of `/brain` | **blocked** — redirects to `/auth`; no signed-in identity in the sandbox, so in-world walk-up/E/seat/stake flow was NOT exercised end to end |

Everything below is from code tracing plus the unit harness, not from a live two-browser session.

## Not working correctly

### 1. Staked settlement will fail across peers (critical)
Each peer has its own local chain replica. `payBuyIn` writes the debit only to the
payer's chain; `settleEscrow` runs on the **host**, whose replica never saw the other
players' buy-ins, so `getSwarmBalance('pub-escrow:<tableId>')` is short and
`transferSwarm` throws `Insufficient SWARM balance`. The error is only
`console.warn`ed in `PubStakePanel`, so the winner silently never gets paid and
`settled` is never stamped — the pot is stranded.

### 2. Pub transactions are never broadcast to the mesh
`transferSwarm` in `src/lib/blockchain/token.ts` does not dispatch the
`blockchain-transaction` window event that `hybridOrchestrator` listens for. Buy-ins,
drinks and settlements therefore do not replicate to peers and do not refresh the
Wallet UI (which listens to the same event). This is the root cause of #1.

### 3. Concurrent agree/fund writes can be lost
`setSeatAgreement` / `markSeatFunded` are local LWW table mutations. Two players
ticking or paying at the same time both bump `seq` from the same base; the loser's
frame is dropped by `acceptPeerTable`, so an agreement or a funded flag can vanish
and the table stays frozen. Seat-scoped intents routed to the host would fix it.

### 4. Money can enter the card table and never come out
`CardTablePanel` renders the full stake panel, but Hold'em has no reducer, so
`state.winnerPeerId` never becomes set and settlement can never trigger. A buy-in at
the card table is unrecoverable today.

### 5. No refund is ever issued
`refundBuyIn` exists but has zero call sites. Leaving a table clears the seat from
`funded` without returning the escrowed stake, and a host who leaves mid-leg strands
the pot permanently.

### 6. Drink glasses over-stay
`activeDrinkHolders()` prunes only when it is called, and `PubDrinkProps` only
re-renders when a new drink event lands. With no further events, a glass stays
floating past its 120 s TTL until the next purchase. The glass also has no billboard
orientation and disappears (rather than queues) when the recipient's physics body is
not yet loaded.

### 7. Smaller gaps
- "Buy a round" only covers **seated** players; nearby spectators are excluded.
- `gameTableStore` mutations hardcode `'darts'` as the game for leave/stake/agree/
  fund/settle — harmless now, wrong as soon as a second reducer exists.
- Peers on an older build (no `agreed`/`funded`/`settled` in the snapshot) default to
  empty/false and will never see a staked table as ready.
- No tests cover the mesh bridge (`pub:drink`, `pub:table`), the chat-line event, or
  the settlement effect — only pure store/reducer logic is covered.

## Working as intended

- Free play (stake 0) never touches the ledger and is never blocked.
- Stake changes correctly invalidate every agreement and all funding.
- Staked tables refuse darts intents until all seats agree **and** pay.
- Drink events are idempotent on id and produce the right chat copy.
- Escrow addresses are deterministic and table-scoped.
- Leaving clears that seat's agreement and funding flags.

## Suggested fix order

1. Dispatch `blockchain-transaction` from `transferSwarm` (fixes #2, unblocks #1).
2. Make settlement tolerant: host verifies escrow, else falls back to a
   direct loser→winner transfer, and surfaces a toast on failure.
3. Wire `refundBuyIn` into leave/host-churn paths.
4. Hide the stake panel on the card table until Hold'em exists.
5. Route agree/fund through host intents instead of LWW snapshots.
6. Tick `PubDrinkProps` on an interval so TTL expiry is visible.
