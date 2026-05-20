---
name: npc-wetwork
description: Phase 8 — NPCs gain chemistry/inventory, wet-work contact, smooth-decay mortality, true-bond reproduction. Cap 25.
type: feature
---
NPCs are now fully embodied UQRC entities, not markers.

- Chemistry: `npcChemistry.ts` derives `composition` from body constituents on spawn, holds per-NPC `inventory`.
- Wet work: `src/lib/world/wetWork.ts` is the only site mutating inventory + resource sites; emits `world.mutation`.
- Sites have `yieldLeft / yieldMax / regrowSeconds`; depleted sites filtered by `nearestSite`; `tickRegrowth` runs per tick.
- Contact-gated outcome: `npcTickScheduler` only relaxes deficits when wet work actually lands.
- Mortality: logistic `mortalityProbability(age)` + deterministic `selectByMinCurvature(['live','die'])`.
- Reproduction: `reproductionScheduler.ts` runs every 30 s; reserves = `inventory.food + inventory.water`; cap 25.
- Visual: `NpcSwarmLayer` pulses on resource-verb decisions, markers fade with yield.
- Boot: `main.tsx` starts `startReproductionScheduler()` after `startNpcTickScheduler()`.