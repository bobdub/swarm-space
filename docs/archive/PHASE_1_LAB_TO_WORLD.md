# Phase 1 — Lab → World

First playable phase of the UQRC scaffolding unification. Closes the
create-then-use loop: a Molecule drawn in the Remix Lab becomes a real
Prefab placeable from the Brain Builder Bar.

## UQRC chain

`u(t)` flows through the lab field while drawing → user clicks **Mint
as Asset** → `mintMolecule()` derives a `Prefab` whose mass, basin,
H₂O resistance, and flammability are computed from the same atomic-mass
proxies used by `prefabHouseCatalog.ts`. The Prefab is registered into
the runtime catalog, persisted to IndexedDB, and gossiped via
`BroadcastChannel`. A `lab:recipe` event is emitted on the scaffold bus
so the shared field "feels" the recipe.

```
Molecule  ──deriveMintedPrefab──▶  Prefab
   │                                  │
   │                                  ├─▶ registerCustomPrefab  (Builder Bar)
   │                                  ├─▶ IndexedDB             (local-first)
   │                                  ├─▶ BroadcastChannel      (cross-tab)
   │                                  └─▶ Gun bridge hook       (P2P, opt-in)
   └─▶ emitLabRecipe ─▶ scaffoldBus ─▶ FieldEngine.inject(lab:<id>)
```

## Files

| Path | Role |
| --- | --- |
| `src/lib/remix/labMint.ts` | Pure derivation: Molecule → Prefab |
| `src/lib/remix/mintedPrefabsStore.ts` | IndexedDB + BroadcastChannel + gossip hook |
| `src/lib/remix/lab.bus.ts` | High-level `mintMolecule()` + boot bridge |
| `src/components/remix/LabTab.tsx` | Mint button wired to selected molecule |
| `src/main.tsx` | Boots `bootLabBusBridges()` on idle |

## Persistence rules

* Local-first IndexedDB store `swarm-lab-mints` / `mints` (v1).
* `_origin: 'local' | 'peer'` tag on every record.
* **Local protection:** a peer record is rejected if it would overwrite
  a local record with the same id (project core rule).
* `db.onversionchange` closes the connection cleanly so other tabs can
  upgrade without destroying data (project core rule).

## P2P gossip

`attachMintedGossip(bridge)` lets the P2P layer subscribe to local
mints and rebroadcast them via Gun.js. Inbound peer records re-enter
through `acceptPeerMint(rec)`. The mesh module owns Gun; this store
stays standalone.

## QA checklist

1. Open Lab tab, pick `Wood (Cellulose)`, click **Mint as Asset** →
   toast "Minted to World" appears.
2. Reload the app → minted prefab still appears in Builder Bar
   (consumables/walls section per inferred tier).
3. Open a second tab → mint in tab A, prefab appears in tab B's
   Builder Bar within ~1 s (BroadcastChannel).
4. Console: no errors; `lab:<id>` injection visible if `scaffoldBus`
   debug logging is on.
5. Wallet: a small `labour:<actor>` coin fill is credited via the
   existing coin bus bridge (Phase 2 of the wiring plan already in
   place).

## Next phases

* **Phase 2 — NPCs come alive:** drive `npcEngine` from the field tick.
* **Phase 3 — Coins payouts:** surface `labour:<actor>` balances in the
  Wallet view.
* **Phase 4 — Sculpting integration:** mint custom tools from the Lab,
  feed them into `toolCatalog` for use in `sculpting.ts`.