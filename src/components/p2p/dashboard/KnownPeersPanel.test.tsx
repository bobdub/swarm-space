import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryPeer } from '@/lib/p2p/swarmMesh.standalone';

const callbacks = vi.hoisted(() => ({ listener: undefined as ((peers: LibraryPeer[]) => void) | undefined, unsubscribe: vi.fn() }));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({
  getSwarmMeshStandalone: () => ({
    onLibraryChange: (listener: (peers: LibraryPeer[]) => void) => {
      callbacks.listener = listener;
      listener([]);
      return callbacks.unsubscribe;
    },
  }),
}));
import { KnownPeersPanel } from './KnownPeersPanel';

afterEach(cleanup);
describe('Known peers library reconciliation', () => {
  it('receives a new contact snapshot without reconnecting and unsubscribes on unmount', () => {
    const view = render(<KnownPeersPanel />);
    act(() => callbacks.listener?.([{
      peerId: 'peer-c', nodeId: 'c', alias: 'Guest C', addedAt: 1,
      lastSeenAt: 0, autoConnect: true, source: 'exchange',
    }]));
    // Contact identity is the state outcome, not a styling/copy assertion.
    expect(view.getByText('peer-c')).toBeTruthy();
    act(() => callbacks.listener?.([]));
    expect(view.queryByText('peer-c')).toBeNull();
    view.unmount();
    expect(callbacks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});