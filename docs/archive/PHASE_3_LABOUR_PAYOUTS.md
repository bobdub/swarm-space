# Phase 3 — Labour Payouts Surfacing

> Cross-scaffolding visibility: the work the world does becomes a
> number you can see.

## What it does

Every `coin.fill` whose `coinId` starts with `labour:<actorId>` is
aggregated into a local-first, throttled, gossiped ledger and rendered
inside `Wallet → Credits → Labour Payouts`.

Sources of `labour:*` fills:

| Origin | Delta | Path |
|---|---|---|
| User sculpting / placement | `min(1, laborWeight × 0.05)` | `world.mutation` → `coin.bus` (existing) |
| NPC productive verb | 0.03–0.06 per tick | `npc.decision` → `coin.bus` (Phase 3) |
| Cross-tab gossip | echoed | `BroadcastChannel('swarm:labour:fills')` |

`drink` / `eat` add a token 0.005 so basic survival shows up; `rest` /
`socialise` contribute nothing.

## Files

- `src/lib/blockchain/labourLedger.ts` — singleton, IndexedDB v1
  (`swarm-labour`), 2.5 m throttled writes, sync flush on
  `visibilitychange` / `beforeunload`, BroadcastChannel gossip.
- `src/components/wallet/LabourPayoutsPanel.tsx` — read-only surface.
- `src/lib/blockchain/coin.bus.ts` — extended with
  `onNpcDecision → emitCoinFill('labour:<npcId>')`.
- `src/main.tsx` — `bootLabourLedger()` on idle.
- `src/pages/Wallet.tsx` — panel mounted in the Credits tab.

## UQRC discipline

- Pure observer. The ledger never injects back into the field.
- Single writer pattern preserved — only `coin.bus` mints labour fills;
  the ledger only reads scaffold-bus events.
- Re-entrancy safe — `npc → coin` is a one-way edge (coin events are
  not consumed by the NPC layer).
- Honors `featureFlags.scaffoldBus` — when off, no fills flow, no
  panel content appears.

## QA checklist

1. Open Wallet → Credits. Panel renders, "no labour credits yet" empty
   state with 8 seeded NPCs spawning.
2. Within ~1 minute, NPC names appear with totals climbing.
3. Sculpt a tree (or any world mutation) — your own user id appears
   with `You` badge, total > 0.
4. Open Wallet in a second tab — totals match (cross-tab gossip).
5. Reload — totals persist (IndexedDB hydration).
6. Toggle `scaffoldBus` flag off — new fills stop, existing totals
   stay (kill-switch).

## Phase map

- ✅ **Phase 1 — Lab → World**
- ✅ **Phase 2 — NPCs come alive**
- ✅ **Phase 3 — Coins payouts surfacing** (this doc)
- ⏳ Phase 4 — Sculpting tools mint into `toolCatalog`
- ⏳ Phase 5 — Memory/Media coin pins reassembled prefabs
- ⏳ Phase 6 — Per-scaffolding sub-Q badges in App Health