import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { notifyAppUpdate } from '@/lib/notifications';
import { getAppVersionWatch } from '@/lib/p2p/appVersion';
import { isBrainUpdateContext, subscribeBrainUpdateContext } from '@/lib/p2p/appUpdateNotices';

/** Quiet inbox delivery only; Brain owns its own local system line. */
export function AppUpdateNotice() {
  const { user, isLoading } = useAuth();
  const watch = getAppVersionWatch();
  const [state, setState] = useState(() => watch.getState());
  const inBrain = useSyncExternalStore(subscribeBrainUpdateContext, isBrainUpdateContext);
  useEffect(() => {
    const off = watch.subscribe(setState);
    setState(watch.getState());
    return off;
  }, [watch]);
  useEffect(() => {
    // Defer one task so a newly mounted scene can claim its context first.
    if (isLoading || !user || inBrain || state.status !== 'available') return;
    const timer = setTimeout(() => {
      if (!isBrainUpdateContext()) void notifyAppUpdate(user.id, state.deployed).catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [user?.id, isLoading, inBrain, state]);
  return null;
}