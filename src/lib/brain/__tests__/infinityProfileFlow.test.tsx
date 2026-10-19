import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InfinityProfile } from '@/components/InfinityProfile';

vi.mock('@/components/TopNavigationBar', () => ({ TopNavigationBar: () => null }));
vi.mock('@/components/PostCard', () => ({ PostCard: () => null }));
vi.mock('@/contexts/P2PContext', () => ({ useP2PContext: () => ({ stats: { connectedPeers: 0 } }) }));

afterEach(cleanup);

describe('Infinity profile opt-in flow', () => {
  it('answers through real Dual learning only after enabling and clears ephemeral messages', async () => {
    render(<MemoryRouter><InfinityProfile posts={[]} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Infinity' }), { target: { value: 'Explain the UQRC operator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('𝒪_UQRC(u) = ν Δ u + ℛ u + L_S u'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
    expect(screen.getByRole('log').textContent).not.toContain('Explain the UQRC operator');
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
  it('cancels a queued reply immediately when disabled', async () => {
    render(<MemoryRouter><InfinityProfile posts={[]} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Infinity' }), { target: { value: 'Explain the UQRC operator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.click(screen.getByRole('switch'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByRole('log').textContent).not.toContain('𝒪_UQRC(u) =');
  });
});