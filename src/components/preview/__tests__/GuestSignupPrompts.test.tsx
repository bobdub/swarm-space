import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GuestSignupPostCard } from '../GuestSignupPostCard';
import { MobileNav } from '../../MobileNav';
import { guestSignupHref } from '@/lib/preview/guestAccess';

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../P2PStatusIndicator', () => ({ P2PStatusIndicator: () => null }));
vi.mock('../../Avatar', () => ({ Avatar: () => null }));
afterEach(() => { cleanup(); auth.user = null; });

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

describe('Guest sign-up prompts', () => {
  it('builds a sign-up link that returns to the given page', () => {
    expect(guestSignupHref('/explore')).toBe('/auth?signup=1&redirect=%2Fexplore');
  });

  it('pinned Explore card links to sign-up', () => {
    render(<MemoryRouter><GuestSignupPostCard /></MemoryRouter>);
    expect(screen.getByText('Create an account')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(guestSignupHref('/explore'));
  });

  it('menu card invites guests to create an account', async () => {
    auth.user = { id: 'g1', username: 'guest-abc', displayName: 'Guest', guestName: 'Nova', _guest: true };
    render(<MemoryRouter initialEntries={['/explore']}><MobileNav /></MemoryRouter>);
    openMenu();
    const link = (await screen.findByText('Click to create an account')).closest('a');
    expect(link?.getAttribute('href')).toBe(guestSignupHref('/explore'));
    expect(screen.getByText('Nova')).toBeTruthy();
    expect(screen.getByText('@guest-abc')).toBeTruthy();
  });

  it('menu card stays a profile link for members', async () => {
    auth.user = { id: 'u1', username: 'member', displayName: 'Member' };
    render(<MemoryRouter><MobileNav /></MemoryRouter>);
    openMenu();
    const handle = await screen.findByText('@member');
    expect(screen.queryByText('Click to create an account')).toBeNull();
    expect(handle.closest('a')?.getAttribute('href')).toBe('/profile');
  });
});
