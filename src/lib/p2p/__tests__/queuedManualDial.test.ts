import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneSwarmMesh } from '../swarmMesh.standalone';

type DialHarness = {
  phase: string;
  flags: { enabled: boolean };
  peer: { destroyed: boolean } | null;
  dialPeer: ReturnType<typeof vi.fn>;
  pulseGlobalPresence: ReturnType<typeof vi.fn>;
  queuedManualDials: Map<string, number>;
  flushQueuedManualDials: () => void;
};

function createMesh() {
  localStorage.setItem('swarm-mesh-node-id', 'self');
  const mesh = new StandaloneSwarmMesh();
  const h = mesh as unknown as DialHarness;
  h.dialPeer = vi.fn(() => true);
  h.pulseGlobalPresence = vi.fn();
  return { mesh, h };
}

describe('manual dials while the mesh is connecting', () => {
  beforeEach(() => localStorage.clear());

  it('queues the dial instead of rejecting, then sends it once online', () => {
    const { mesh, h } = createMesh();
    h.flags.enabled = true;
    h.phase = 'connecting';
    expect(mesh.connectToPeer('peer-target')).toBe(true);
    expect(h.dialPeer).not.toHaveBeenCalled();
    expect(h.queuedManualDials.has('peer-target')).toBe(true);

    h.phase = 'online';
    h.peer = { destroyed: false };
    h.flushQueuedManualDials();
    expect(h.dialPeer).toHaveBeenCalledWith('peer-target', 'manual');
    expect(h.queuedManualDials.size).toBe(0);
  });

  it('still rejects when the mesh is off', () => {
    const { mesh, h } = createMesh();
    h.flags.enabled = false;
    h.phase = 'off';
    expect(mesh.connectToPeer('peer-target')).toBe(false);
    expect(h.queuedManualDials.size).toBe(0);
  });

  it('drops queued dials older than the queue window', () => {
    vi.useFakeTimers();
    try {
      const { mesh, h } = createMesh();
      h.flags.enabled = true;
      h.phase = 'reconnecting';
      mesh.connectToPeer('peer-stale');
      vi.advanceTimersByTime(61_000);
      h.phase = 'online';
      h.peer = { destroyed: false };
      h.flushQueuedManualDials();
      expect(h.dialPeer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
