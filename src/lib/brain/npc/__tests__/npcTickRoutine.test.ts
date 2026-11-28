import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/uqrc/fieldEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uqrc/fieldEngine')>()),
  getSharedFieldEngine: () => ({
    getCurvatureForText: () => 0,
    getQScore: () => 0,
    isWarmedUp: () => false,
  }),
}));
vi.mock('../npcPersistence', () => ({
  scheduleNpcRosterSave: () => {},
  flushNpcRosterSave: () => {},
  loadNpcRoster: async () => null,
}));
vi.mock('@/lib/time/networkClock', () => ({ networkNow: () => Date.now() }));

import { EARTH_EPOCH_MS, GAME_DAY_SECONDS, setEarthPoseTime } from '@/lib/brain/earth';
import { listNpcs, _resetRegistryForTest } from '../npcRegistry';
import { npcWalkSpeed, startNpcTickScheduler, _resetTickSchedulerForTest } from '../npcTickScheduler';
import { retainNpcScene, reportNpcViewerDistance, _resetNpcSceneGateForTest } from '../npcSceneGate';
import { villageNoonSeconds, villagePlan } from '../villageSchedule';
import { npcIdForName } from '../npcIdentity';

describe('NPC heartbeat follows the shared routine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Solar 05:40 on day 30: villagers are leaving home for the springs.
    const dawn = villageNoonSeconds() + (30 + (5.67 - 12) / 24) * GAME_DAY_SECONDS;
    vi.setSystemTime(EARTH_EPOCH_MS + Math.round(dawn * 1000));
    _resetRegistryForTest();
    _resetTickSchedulerForTest();
    _resetNpcSceneGateForTest();
    retainNpcScene();
    reportNpcViewerDistance(0);
  });
  afterEach(() => {
    _resetTickSchedulerForTest();
    setEarthPoseTime(null);
    vi.useRealTimers();
  });

  it('seeds villagers with name ids and keeps each on its scheduled spot', () => {
    startNpcTickScheduler();
    const roster = listNpcs();
    expect(roster.length).toBe(8);
    for (const npc of roster) expect(npc.id).toBe(npcIdForName(npc.name));

    // Pin the shared clock and step it one beat at a time, so every beat
    // reads a known instant.
    let t = (Date.now() - EARTH_EPOCH_MS) / 1000;
    setEarthPoseTime(t);
    vi.advanceTimersByTime(200); // first beat: snap to the routine
    const check = () => {
      for (const npc of listNpcs()) {
        const p = villagePlan(npc, t, npcWalkSpeed(npc));
        expect(Math.hypot(npc.tx - p.tx, npc.tz - p.tz)).toBeLessThan(1e-9);
        expect(npc.currentDrive).toBe(p.drive);
      }
    };
    check();
    const before = new Map(listNpcs().map((n) => [n.id, [n.tx, n.tz]]));
    for (let beat = 0; beat < 8 * 90; beat++) {
      t += 0.125;
      setEarthPoseTime(t);
      vi.advanceTimersByTime(125);
    }
    check();
    const walked = listNpcs().filter((n) => {
      const [x, z] = before.get(n.id)!;
      return Math.hypot(n.tx - x, n.tz - z) > 1;
    });
    expect(walked.length).toBeGreaterThan(0);
  });
});
