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

function scheduleLocalAnchorHeal(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(async () => {
    try {
      const [{ resolveLocalAnchorId }, engine, reg] = await Promise.all([
        import('./localAnchor'),
        import('./npcEngine'),
        import('./npcRegistry'),
      ]);
      const liveAnchor = resolveLocalAnchorId('self');
      if (liveAnchor === 'self') return;
      let healed = 0;
      for (const npc of reg.listNpcs()) {
        if (npc.anchorPeerId !== 'self') continue;
        if (engine.reanchorNpc(npc.id, liveAnchor)) healed += 1;
      }
      if (healed > 0) console.log(`[npcBoot] healed ${healed} NPC anchor(s) to live peer ${liveAnchor}`);
    } catch (err) {
      console.warn('[npcBoot] local anchor heal failed', err);
    }
  }, 1200);
}

export function bootNpcWorld(): Promise<void> {
  if (_booted) return Promise.resolve();
  if (_bootInFlight) return _bootInFlight;
  _bootInFlight = (async () => {
    try {
      console.log('[npcBoot] world boot starting');
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
              anchorPeerId: n.anchorPeerId,
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

      const sched = await import('./npcTickScheduler');
      sched.startNpcTickScheduler();

      const repro = await import('./reproductionScheduler');
      repro.startReproductionScheduler();

      scheduleLocalAnchorHeal();

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