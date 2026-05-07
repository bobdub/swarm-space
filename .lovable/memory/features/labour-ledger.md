---
name: labour-ledger
description: Phase 3 — labour:<actor> coin.fill aggregation; IndexedDB swarm-labour v1; BroadcastChannel swarm:labour:fills; surfaced in Wallet → Credits → Labour Payouts; NPC productive verbs minted via coin.bus
type: feature
---
`src/lib/blockchain/labourLedger.ts` is the single subscriber to
scaffold-bus `coin` events that filters `labour:<actorId>` fills into
a totals + recent-events ledger. Throttled 2.5 m IndexedDB snapshots
(non-destructive upgrade, sync flush on `visibilitychange` /
`beforeunload`). Cross-tab gossip via `BroadcastChannel('swarm:labour:fills')`
with `origin: 'peer'` tagging.

`coin.bus.ts` extended: `onNpcDecision` mints
`labour:<npcId>` coin.fills for productive verbs only
(gather/hunt/fish/grow/craft 0.03–0.06; drink/eat 0.005; rest/socialise none).
World mutations already credited via existing `world.mutation` listener.

UI: `src/components/wallet/LabourPayoutsPanel.tsx` mounted in
`Wallet → Credits` tab. Pure observer; reads `subscribeLabourLedger`.

Boot: `src/main.tsx` `bootLabourLedger()` on idle.

Discipline: re-entrancy safe (npc → coin is one-way; ledger does not
emit). Honors `scaffoldBus` kill-switch. Never injects into the field.

See `docs/PHASE_3_LABOUR_PAYOUTS.md`.