import { describe, it, expect, beforeEach } from 'vitest';
import { retainNpcScene, isNpcSceneActive, _resetNpcSceneGateForTest } from '../npcSceneGate';

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
});
