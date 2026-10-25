import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuestPeerConnectionPrompt } from '../GuestPeerConnectionPrompt';

const mesh = vi.hoisted(() => ({ stats: { connectedPeers: 0 }, isEnabled: false, enable: vi.fn(async () => {}), connectToPeer: vi.fn(() => true), getPeerId: () => 'peer-self' }));
vi.mock('@/contexts/P2PContext', () => ({ useP2PContext: () => mesh }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mesh.stats.connectedPeers = 0; });

describe('Guest manual peer connection', () => {
  it('enables the mesh and sends a trimmed manual dial without claiming connectivity', async () => {
    render(<GuestPeerConnectionPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect to a peer to chat' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Peer ID' }), { target: { value: ' peer-friend ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));
    await waitFor(() => expect(mesh.connectToPeer).toHaveBeenCalledWith('peer-friend', { manual: true, source: 'brain-guest-chat' }));
    expect(mesh.enable).toHaveBeenCalledTimes(1);
    expect(mesh.stats.connectedPeers).toBe(0);
  });
  it('does not dial the guest’s own peer ID', () => {
    render(<GuestPeerConnectionPrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect to a peer to chat' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Peer ID' }), { target: { value: 'peer-self' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect', exact: true }));
    expect(mesh.enable).not.toHaveBeenCalled();
    expect(mesh.connectToPeer).not.toHaveBeenCalled();
  });
});