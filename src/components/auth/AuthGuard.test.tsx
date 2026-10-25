import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';

const mocks = vi.hoisted(() => ({ session: { status: 'signed-out', user: null as unknown, storageUnavailable: false }, provision: vi.fn() }));
vi.mock('@/hooks/useSession', () => ({ useSession: () => mocks.session }));
vi.mock('@/lib/preview/guestMode', () => ({ ensureGuestIdentity: mocks.provision }));

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/auth" element={<div>Signup destination</div>} />
    <Route element={<AuthGuard />}>
      <Route path="*" element={<div>Allowed destination</div>} />
    </Route>
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  mocks.session = { status: 'signed-out', user: null, storageUnavailable: false };
  mocks.provision.mockReset().mockResolvedValue({ _guest: true });
});
afterEach(cleanup);

describe('direct Brain guest access', () => {
  it('provisions a guest on /brain instead of redirecting to signup', async () => {
    const screen = open('/brain');
    await waitFor(() => expect(mocks.provision).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Signup destination')).toBeNull();
  });
  it('waits for session restoration before creating a guest', () => {
    mocks.session.status = 'unknown';
    open('/brain');
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it('preserves a restored member identity at /brain', () => {
    mocks.session = { status: 'signed-in', user: { id: 'member' }, storageUnavailable: false };
    const screen = open('/brain');
    expect(screen.getByText('Allowed destination')).toBeTruthy();
    expect(mocks.provision).not.toHaveBeenCalled();
  });
  it.each(['/brain', '/explore', '/node-dashboard', '/settings'])('lets an existing guest access %s', (path) => {
    mocks.session = { status: 'signed-in', user: { id: 'guest', _guest: true }, storageUnavailable: false };
    expect(open(path).getByText('Allowed destination')).toBeTruthy();
  });
  it.each(['/profile', '/wallet', '/create'])('prompts a guest to sign up at %s', (path) => {
    mocks.session = { status: 'signed-in', user: { id: 'guest', _guest: true }, storageUnavailable: false };
    expect(open(path).getByText('Signup destination')).toBeTruthy();
  });
});