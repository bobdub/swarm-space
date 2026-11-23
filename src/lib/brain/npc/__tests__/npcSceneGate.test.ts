import { describe, it, expect, beforeEach } from 'vitest';
import {
  retainNpcScene,
  isNpcSceneActive,
  reportNpcViewerDistance,
  NPC_WAKE_RADIUS_M,
  NPC_SLEEP_RADIUS_M,
  _resetNpcSceneGateForTest,
} from '../npcSceneGate';

describe('npcSceneGate', () => {
  beforeEach(() => { _resetNpcSceneGateForTest(); });

  it('sleeps until a Brain scene retains it', () => {
    expect(isNpcSceneActive()).toBe(false);
    const release = retainNpcScene();
    expect(isNpcSceneActive()).toBe(true);
    release();
    expect(isNpcSceneActive()).toBe(false);
  });

  it('counts overlapping scenes and ignores double releases', () => {
    const a = retainNpcScene();
    const b = retainNpcScene();
    a();
    a();
    expect(isNpcSceneActive()).toBe(true);
    b();
    expect(isNpcSceneActive()).toBe(false);
  });

  it('sleeps while the viewer is far from the village, with hysteresis', () => {
    const release = retainNpcScene();
    reportNpcViewerDistance(NPC_SLEEP_RADIUS_M + 1);
    expect(isNpcSceneActive()).toBe(false);
    reportNpcViewerDistance((NPC_WAKE_RADIUS_M + NPC_SLEEP_RADIUS_M) / 2);
    expect(isNpcSceneActive()).toBe(false);
    reportNpcViewerDistance(NPC_WAKE_RADIUS_M - 1);
    expect(isNpcSceneActive()).toBe(true);
    reportNpcViewerDistance((NPC_WAKE_RADIUS_M + NPC_SLEEP_RADIUS_M) / 2);
    expect(isNpcSceneActive()).toBe(true);
    release();
  });
});
