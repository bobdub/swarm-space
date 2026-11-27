import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { AppVersionWatch, type ReleaseStamp } from '@/lib/p2p/appVersion';
import { AppUpdateNotice } from '@/components/AppUpdateNotice';
import { useBrainAppUpdate } from '../useBrainAppUpdate';
import { appUpdateNamespace, enterBrainUpdateContext, isBrainUpdateContext } from '@/lib/p2p/appUpdateNotices';
import { notifyAppUpdate } from '@/lib/notifications';
import type { Notification } from '@/types';
import Notifications from '@/pages/Notifications';
import { getUnreadCount } from '@/lib/notifications';

const mocks = vi.hoisted(() => ({
  watch: null as AppVersionWatch | null,
  user: { id: 'mike-id', username: 'Mike', publicKey: '', wrappedKeyRef: '', createdAt: '' },
  stored: new Map<string, Notification>(),
  address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, isLoading: false }) }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: () => mocks.user }));
vi.mock('@/components/TopNavigationBar', () => ({ TopNavigationBar: () => null }));
vi.mock('@/components/Avatar', () => ({ Avatar: () => null }));
vi.mock('@/lib/store', () => ({
  get: vi.fn(async (_store: string, id: string) => mocks.stored.get(id)),
  put: vi.fn(async (_store: string, value: Notification) => { mocks.stored.set(value.id, value); }),
  getAll: vi.fn(async () => [...mocks.stored.values()]),
}));
vi.mock('@/lib/blockchain/wallets/coldKey', () => ({ getColdKeyReceivingAddress: vi.fn(async () => mocks.address) }));
vi.mock('@/lib/p2p/appVersion', async (original) => {
  const module = await original<typeof import('@/lib/p2p/appVersion')>();
  return { ...module, getAppVersionWatch: () => {
    if (!mocks.watch) throw new Error('Test watch not installed');
    return mocks.watch;
  } };
});

const OLD: ReleaseStamp = { release: 12, id: 'old' };
const NEW: ReleaseStamp = { release: 14, id: 'new' };
let deployed: ReleaseStamp;
let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  mocks.stored.clear();
  deployed = NEW;
  reload = vi.fn();
  mocks.watch = new AppVersionWatch({
    local: OLD, fetchDeployed: async () => deployed,
    reload, isCallActive: () => true, storage: null,
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('gentle update delivery', () => {
  it('records a verified update in the Bell inbox without refreshing', async () => {
    render(<AppUpdateNotice />);
    act(() => { mocks.watch?.notePeerRelease(NEW); });
    await waitFor(() => expect(mocks.stored.size).toBe(1));
    expect([...mocks.stored.values()][0]).toMatchObject({ userId: 'mike-id', type: 'app_update', appRelease: 14, read: false });
    expect(reload).not.toHaveBeenCalled();
    act(() => { mocks.watch?.refreshNow(); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not notify for an unverified higher peer stamp', async () => {
    deployed = OLD;
    render(<AppUpdateNotice />);
    act(() => { mocks.watch?.notePeerRelease(NEW); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(mocks.watch?.getState()).toEqual({ status: 'idle' });
    expect(mocks.stored.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it('lets the user read the inbox notice and choose Update Now through the page', async () => {
    const view = render(<MemoryRouter><AppUpdateNotice /><Notifications /></MemoryRouter>);
    act(() => { mocks.watch?.notePeerRelease(NEW); });
    await view.findByRole('button', { name: 'Update Now' });
    expect(await getUnreadCount()).toBe(1);
    fireEvent.click(view.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(async () => expect(await getUnreadCount()).toBe(0));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(await view.findByRole('button', { name: 'Update Now' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('deduplicates inbox entries across remounts and preserves read state', async () => {
    await notifyAppUpdate('mike-id', NEW);
    const notice = [...mocks.stored.values()][0];
    if (!notice) throw new Error('Missing notice');
    notice.read = true;
    await notifyAppUpdate('mike-id', NEW);
    expect(mocks.stored.size).toBe(1);
    expect([...mocks.stored.values()][0]?.read).toBe(true);
    await notifyAppUpdate('other-id', NEW);
    expect(mocks.stored.size).toBe(2);
  });

  it('delivers one local namespace notice in Brain, then an inbox notice on leaving', async () => {
    render(<AppUpdateNotice />);
    const hook = renderHook(() => useBrainAppUpdate(mocks.user, 'brain-room'));
    expect(isBrainUpdateContext()).toBe(true);
    act(() => { mocks.watch?.notePeerRelease(NEW); });
    await waitFor(() => expect(hook.result.current?.systemNotice).toBe('app_update'));
    expect(hook.result.current?.text).toContain('@Mike#356ef7cf');
    expect(hook.result.current?.text).toContain('A newer Swarm Space version (v0.014) is live.');
    expect(hook.result.current?.authorId).toBeUndefined();
    expect(hook.result.current?.infinityReplyTo).toBeUndefined();
    const id = hook.result.current?.id;
    hook.rerender();
    expect(hook.result.current?.id).toBe(id);
    expect(mocks.stored.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
    hook.unmount();
    await waitFor(() => expect(mocks.stored.size).toBe(1));
    expect(isBrainUpdateContext()).toBe(false);
  });

  it('keeps overlapping Brain mounts active until both leave', () => {
    const leaveA = enterBrainUpdateContext();
    const leaveB = enterBrainUpdateContext();
    leaveA();
    expect(isBrainUpdateContext()).toBe(true);
    leaveB();
    expect(isBrainUpdateContext()).toBe(false);
  });

  it('does not fabricate a namespace when public receiving metadata is missing', async () => {
    expect(await appUpdateNamespace('guest-id', '@Guest', null)).toBe('@Guest');
    expect(await appUpdateNamespace('guest-id', 'Guest', 'invalid')).toBe('@Guest');
  });
});