/**
 * bootNpcWorld — single idempotent entry point that the world scene
 * calls on mount so NPCs always exist when the player is in-world.
 *
 * Mirrors the discipline of other scaffold bus bridges: safe to call
 * many times, never throws, all I/O routed through the existing NPC
 * modules (engine, registry, persistence, scheduler).
 */
let _booted = false;
let _bootInFlight: Promise<void> | null = null;
let _bootAnchor: string | null = null;

function scheduleLocalAnchorHeal(targetAnchor: string): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(async () => {
    try {
      const [engine, reg] = await Promise.all([
        import('./npcEngine'),
        import('./npcRegistry'),
      ]);
      let healed = 0;
      for (const npc of reg.listNpcs()) {
        if (npc.anchorPeerId === targetAnchor) continue;
        if (engine.reanchorNpc(npc.id, targetAnchor)) healed += 1;
      }
      if (healed > 0) console.log(`[npcBoot] healed ${healed} NPC anchor(s) to ${targetAnchor}`);
    } catch (err) {
      console.warn('[npcBoot] local anchor heal failed', err);
    }
  }, 1200);
}

export function bootNpcWorld(anchorPeerId?: string): Promise<void> {
  if (anchorPeerId) _bootAnchor = anchorPeerId;
  if (_booted) return Promise.resolve();
  if (_bootInFlight) return _bootInFlight;
  const anchor = _bootAnchor ?? anchorPeerId ?? 'swarm-shared-village';
  _bootInFlight = (async () => {
    try {
      console.log(`[npcBoot] world boot starting (anchor=${anchor})`);
      const persistence = await import('./npcPersistence');
      const engine = await import('./npcEngine');
      const reg = await import('./npcRegistry');
      const roster = await persistence.loadNpcRoster();
      const persisted = roster?.length ?? 0;
      console.log(`[npcBoot] persisted roster loaded — ${persisted} NPC(s)`);

      if (roster && roster.length > 0 && reg.listNpcs().length === 0) {
        let restored = 0;
        for (const n of roster) {
          try {
            const res = engine.spawnNpc({
              name: n.name,
              sex: n.sex,
              // Always anchor to the shared village frame — historic peer-id
              // anchors stranded NPCs on the player's far hemisphere and the
              // camera never visited them.
              anchorPeerId: anchor,
              tx: n.tx,
              tz: n.tz,
              seed: n.seed,
            });
            if ('ok' in res && res.ok) restored += 1;
          } catch (err) {
            console.warn('[npcBoot] rehydrate spawn failed', n.name, err);
          }
        }
        console.log(`[npcBoot] rehydrated ${restored}/${persisted} NPC(s)`);
      }

      // First-boot seed — if nothing was persisted yet, spawn the starter
      // community so the player always meets the village on arrival.
      if (reg.listNpcs().length === 0) {
        const { INITIAL_NPCS } = await import('./seedCommunity');
        let seeded = 0;
        for (const spec of INITIAL_NPCS) {
          try {
            const res = engine.spawnNpc({
              name: spec.name,
              sex: spec.sex,
              anchorPeerId: anchor,
              seed: spec.baseString,
            });
            if ('ok' in res && res.ok) seeded += 1;
          } catch (err) {
            console.warn('[npcBoot] seed spawn failed', spec.name, err);
          }
        }
        console.log(`[npcBoot] seeded ${seeded}/${INITIAL_NPCS.length} starter NPC(s)`);
      }

      const sched = await import('./npcTickScheduler');
      sched.startNpcTickScheduler();

      const repro = await import('./reproductionScheduler');
      repro.startReproductionScheduler();

      scheduleLocalAnchorHeal(anchor);

      console.log(`[npcBoot] world boot complete — registry has ${reg.listNpcs().length} NPC(s)`);
      _booted = true;
    } catch (err) {
      console.warn('[npcBoot] world boot failed', err);
      // Allow another attempt on next mount.
      _bootInFlight = null;
    }
  })();
  return _bootInFlight;
}