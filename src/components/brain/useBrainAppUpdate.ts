import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { UserMeta } from '@/lib/auth';
import { getAppVersionWatch } from '@/lib/p2p/appVersion';
import { appUpdateNamespace, appUpdateNoticeId, enterBrainUpdateContext } from '@/lib/p2p/appUpdateNotices';
import type { BrainChatLine } from './BrainChatPanel';
import { updateAvailableText } from '@/lib/app/releaseVersion';

export function useBrainAppUpdate(user: UserMeta | null, roomId: string): BrainChatLine | null {
  useLayoutEffect(() => enterBrainUpdateContext(), []);
  const watch = getAppVersionWatch();
  const [state, setState] = useState(() => watch.getState());
  const [identity, setIdentity] = useState({ userId: '', username: '', namespace: '' });
  useEffect(() => {
    const off = watch.subscribe(setState);
    setState(watch.getState());
    return off;
  }, [watch]);
  useEffect(() => {
    if (!user || state.status !== 'available') return;
    let active = true;
    const resolve = async () => {
      let address: string | null = null;
      try {
        const { getColdKeyReceivingAddress } = await import('@/lib/blockchain/wallets/coldKey');
        address = await getColdKeyReceivingAddress(user.id);
      } catch { /* Guests or unavailable public metadata retain their handle. */ }
      const namespace = await appUpdateNamespace(user.id, user.username, address);
      if (active) setIdentity({ userId: user.id, username: user.username, namespace });
    };
    void resolve();
    return () => { active = false; };
  }, [user?.id, user?.username, state.status]);
  return useMemo(() => {
    if (!user || state.status !== 'available' || identity.userId !== user.id || identity.username !== user.username) return null;
    return {
      id: `${appUpdateNoticeId(user.id, state.deployed)}:${roomId}`,
      author: 'System · Infinity',
      text: `Notice for ${identity.namespace}: ${updateAvailableText(state.deployed)}`,
      ts: Date.now(), systemNotice: 'app_update',
    };
  }, [user?.id, user?.username, state, identity, roomId]);
}