import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const invite = vi.hoisted(() => ({ state: { peerId: 'peer-host', phase: 'connected', startedAt: 0, connectedAt: 1 } as Record<string, unknown> }));
const mesh = vi.hoisted(() => ({
  active: [] as Array<{ peerId: string; profile?: { username?: string; displayName?: string } }>,
}));

const auth = vi.hoisted(() => ({ user: null as Record<string, unknown> | null }));
const guest = vi.hoisted(() => ({ setGuestName: vi.fn(() => true) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user, isLoading: false }) }));
vi.mock('@/lib/preview/guestMode', () => ({
  isGuestUser: (user: { _guest?: boolean } | null) => user?._guest === true,
  setGuestName: guest.setGuestName,
}));
vi.mock('@/components/TopNavigationBar', () => ({ TopNavigationBar: () => null }));
vi.mock('@/lib/p2p/brainInvite', () => ({
  BRAIN_JOIN_PATH: '/brain/join',
  getBrainInviteState: () => invite.state,
  subscribeBrainInvite: () => () => {},
  retryBrainInvite: vi.fn(),
}));
vi.mock('@/contexts/P2PContext', () => ({
  useP2PContext: () => ({ getActivePeerConnections: () => mesh.active, getDiscoveredPeers: () => [] }),
}));

import PeerConnect from '../PeerConnect';

function Where() {
  const { pathname, hash } = useLocation();
  return <div data-testid="where">{pathname + hash}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/connect#peer-host']}>
      <Routes>
        <Route path="/connect" element={<PeerConnect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mesh.active = [];
  auth.user = null;
  guest.setGuestName.mockClear();
  invite.state = { peerId: 'peer-host', phase: 'connected', startedAt: 0, connectedAt: 1 };
});

describe('PeerConnect next steps', () => {
  it('sends a connected guest to Explore', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));
    expect(screen.getByTestId('where').textContent).toBe('/explore');
  });

  it('joins the inviter’s live chat', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /join live chat/i }));
    expect(screen.getByTestId('where').textContent).toBe('/brain/join#peer-host');
  });

  it('opens the inviter’s profile once their name is known', () => {
    mesh.active = [{ peerId: 'peer-host', profile: { username: 'ada', displayName: 'Ada' } }];
    renderPage();
    expect(screen.getByRole('status').textContent).toContain('Connected to Ada');
    fireEvent.click(screen.getByRole('button', { name: /view ada's profile/i }));
    expect(screen.getByTestId('where').textContent).toBe('/u/ada');
  });

  it('waits for the inviter profile instead of linking nowhere', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /loading your connection's profile/i })).toHaveProperty('disabled', true);
  });

  it('hides next steps while still connecting', () => {
    invite.state = { peerId: 'peer-host', phase: 'connecting', startedAt: 0, connectedAt: null };
    renderPage();
    expect(screen.queryByRole('button', { name: /start exploring/i })).toBeNull();
  });

  it('lets a guest set their display name', () => {
    auth.user = { id: 'guest-1', _guest: true, guestName: '' };
    renderPage();
    const input = screen.getByLabelText(/your display name/i);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: '  Sam  ' } });
    fireEvent.click(save);
    expect(guest.setGuestName).toHaveBeenCalledWith('guest-1', '  Sam  ');
  });

  it('shows no name field for signed-in members', () => {
    auth.user = { id: 'member-1', username: 'ada' };
    renderPage();
    expect(screen.queryByLabelText(/your display name/i)).toBeNull();
  });
});
