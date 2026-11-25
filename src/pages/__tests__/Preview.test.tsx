import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  posts: new Map<string, Record<string, unknown>>(),
  connectToPeer: vi.fn(() => true),
  requestContent: vi.fn(() => 1),
  // PreviewContext keeps the session in state, so it is the same object every render.
  session: { creatorPeerId: 'peer-sharer', postId: 'post-1', isProfileFeed: false, startedAt: '', referralSource: null },
}));

vi.mock('@/contexts/PreviewContext', () => ({
  usePreview: () => ({
    isPreviewMode: true,
    previewSession: state.session,
  }),
}));
// A fresh object on every call, as the real useP2P returns.
vi.mock('@/contexts/P2PContext', () => ({
  useP2PContext: () => ({
    enable: async () => {},
    connectToPeer: state.connectToPeer,
    getActivePeerConnections: () => [],
  }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/preview/guestMode', () => ({
  ensureGuestIdentity: async () => null,
  isGuestActive: () => true,
  stopGuestMode: () => {},
}));
vi.mock('@/lib/store', () => ({ get: async (_s: string, id: string) => state.posts.get(id) }));
vi.mock('@/lib/p2p/contentLookup', () => ({
  requestContentHost: async () => [],
  startContentLookupResponder: () => {},
}));
vi.mock('@/lib/preview/previewCache', () => ({ cachePreviewPost: () => {}, getCachedPreviewPost: () => null }));
vi.mock('@/lib/p2p/swarmMesh.standalone', () => ({ getSwarmMeshStandalone: () => ({ requestContent: state.requestContent }) }));
vi.mock('@/lib/p2p/connectionState', () => ({ loadConnectionState: () => ({ mode: 'swarm' }) }));
vi.mock('@/components/TopNavigationBar', () => ({ TopNavigationBar: () => null }));
vi.mock('@/components/PreviewBanner', () => ({ PreviewBanner: () => null }));
vi.mock('@/components/preview/NetworkPulse', () => ({ NetworkPulse: () => null }));
vi.mock('@/components/PostCard', () => ({ PostCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div> }));

import Preview from '../Preview';

const page = () => (
  <MemoryRouter>
    <Preview />
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.posts.clear();
  state.connectToPeer.mockClear();
  state.requestContent.mockClear();
});

describe('Preview page', () => {
  it('keeps waiting for the shared post through P2P re-renders and shows it once synced', async () => {
    vi.useFakeTimers();
    const view = render(page());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getAllByText("Connecting to sharer's node…").length).toBeGreaterThan(0);

    // P2P state churns faster than the poll: each re-render hands the page a
    // new context object. That must not restart the dial or its timers.
    for (let i = 0; i < 20; i++) {
      view.rerender(page());
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    }
    // One dial on entry, one redial when the swarm search starts.
    expect(state.connectToPeer).toHaveBeenCalledTimes(2);
    expect(state.requestContent).toHaveBeenCalledWith(['post-1']);
    // The 8s fallback fired despite the churn.
    expect(screen.getAllByText('Searching the swarm for a host…').length).toBeGreaterThan(0);

    // The sharer's post lands in the local store via mesh sync.
    state.posts.set('post-1', { id: 'post-1', content: 'hello from the sharer' });
    await act(async () => {
      window.dispatchEvent(new Event('p2p-posts-updated'));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('hello from the sharer')).toBeTruthy();
  });

  it('renders straight away when the post is already synced', async () => {
    state.posts.set('post-1', { id: 'post-1', content: 'already here' });
    render(page());
    expect(await screen.findByText('already here')).toBeTruthy();
  });
});
