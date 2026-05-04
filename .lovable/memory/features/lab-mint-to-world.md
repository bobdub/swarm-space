---
name: Lab → World mint pipeline
description: Phase 1 of full build — molecules minted from Lab become Builder Bar prefabs, persisted to IndexedDB and gossiped via BroadcastChannel
type: feature
---
Lab "Mint as Asset" derives a Prefab from the selected Molecule using
the same atomic-mass / oxide / mineral coefficients as
`prefabHouseCatalog.ts`, then:

1. `registerCustomPrefab()` adds it to the runtime Builder Bar catalog.
2. IndexedDB `swarm-lab-mints` v1 stores `{id, prefab, actorId, createdAt, _origin}`.
3. `BroadcastChannel('swarm:lab:mints')` fans out to other tabs.
4. `attachMintedGossip(bridge)` is the P2P hook (Gun.js relay plugs in here — module stays standalone).
5. `emitLabRecipe()` injects into the shared field via the scaffold bus.

**Local protection rule:** peer records must NEVER overwrite a local-origin
record with the same id (mirrors `_origin: local` rule from posts).

**DB upgrade rule:** `db.onversionchange` closes the connection cleanly so
other tabs can upgrade without destroying data.

Boot path: `src/main.tsx` → `bootLabBusBridges()` on idle hydrates prior
mints into the catalog so the Builder Bar shows them after reload.

Files:
- `src/lib/remix/labMint.ts` (pure derivation)
- `src/lib/remix/mintedPrefabsStore.ts` (IDB + gossip)
- `src/lib/remix/lab.bus.ts` (orchestration)
- `src/components/remix/LabTab.tsx` (Mint button)
- `docs/PHASE_1_LAB_TO_WORLD.md`