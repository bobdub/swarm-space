/**
 * React hook for P2P networking
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { P2PManager, P2PStats, P2PStatus, type EnsureManifestOptions, type ConnectOptions, type P2PControlState } from '@/lib/p2p/manager';
import type { Post } from '@/types';
import { getCurrentUser } from '@/lib/auth';
import { loadRendezvousConfig } from '@/lib/p2p/rendezvousConfig';
import type { AchievementEvent } from '@/lib/achievements';
import type { Manifest } from '@/lib/store';

async function notifyAchievements(event: AchievementEvent): Promise<void> {
  try {
    const module = await import('@/lib/achievements');
    await module.evaluateAchievementEvent(event);
  } catch (error) {
    console.warn('[useP2P] Failed to notify achievements', error);
  }
}

let p2pManager: P2PManager | null = null;

const createOfflineStats = (): P2PStats => ({
  status: 'offline' as P2PStatus,
  connectedPeers: 0,
  discoveredPeers: 0,
  localContent: 0,
  networkContent: 0,
  activeRequests: 0,
  rendezvousPeers: 0,
  lastRendezvousSync: null,
  uptimeMs: 0,
  bytesUploaded: 0,
  bytesDownloaded: 0,
  relayCount: 0,
  pingCount: 0
});

const hasStatsChanged = (previous: P2PStats | null, next: P2PStats): boolean => {
  if (!previous) return true;
  for (const key of Object.keys(next) as (keyof P2PStats)[]) {
    if (next[key] !== previous[key]) {
      return true;
    }
  }
  return false;
};

const DEFAULT_CONTROLS: P2PControlState = {
  autoConnect: true,
  manualAccept: false,
  isolate: false,
  paused: false,
};

const CONTROLS_STORAGE_KEY = 'p2p-user-controls';

const loadControlsFromStorage = (): P2PControlState => {
  if (typeof window === 'undefined') {
    return DEFAULT_CONTROLS;
  }
  try {
    const stored = window.localStorage.getItem(CONTROLS_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_CONTROLS;
    }
    const parsed = JSON.parse(stored) as Partial<P2PControlState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_CONTROLS;
    }
    return {
      ...DEFAULT_CONTROLS,
      ...parsed,
    };
  } catch (error) {
    console.warn('[useP2P] Failed to load controls from storage', error);
    return DEFAULT_CONTROLS;
  }
};

const persistControlsToStorage = (controls: P2PControlState): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(controls));
  } catch (error) {
    console.warn('[useP2P] Failed to persist controls to storage', error);
  }
};

export function useP2P() {
  const [stats, setStats] = useState<P2PStats>(() => createOfflineStats());
  const [isEnabled, setIsEnabled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const rendezvousConfig = useMemo(() => loadRendezvousConfig(), []);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const statsListenersRef = useRef(new Set<(value: P2PStats) => void>());
  const lastEmittedStatsRef = useRef<P2PStats | null>(null);
  const [controls, setControls] = useState<P2PControlState>(() => loadControlsFromStorage());
  const wasEnabledBeforePauseRef = useRef(false);

  const [isRendezvousMeshEnabled, setIsRendezvousMeshEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      const stored = window.localStorage.getItem('p2p-rendezvous-mesh');
      if (stored === null) {
        return true;
      }
      return stored === 'true';
    } catch (error) {
      console.warn('[useP2P] Failed to read rendezvous mesh flag:', error);
      return true;
    }
  });

  const persistRendezvousFlag = useCallback((value: boolean) => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem('p2p-rendezvous-mesh', value ? 'true' : 'false');
    } catch (error) {
      console.warn('[useP2P] Failed to persist rendezvous mesh flag:', error);
    }
  }, []);

  const persistControls = useCallback((value: P2PControlState) => {
    persistControlsToStorage(value);
  }, []);

  const applyControlState = useCallback((next: P2PControlState) => {
    setControls(next);
    persistControls(next);
    if (p2pManager) {
      p2pManager.updateControlState(next);
    }
  }, [persistControls]);

  const enableRendezvousMesh = useCallback(() => {
    setIsRendezvousMeshEnabled(true);
    persistRendezvousFlag(true);
    if (p2pManager) {
      void p2pManager.setRendezvousEnabled(true);
    }
  }, [persistRendezvousFlag]);

  const disableRendezvousMesh = useCallback(() => {
    setIsRendezvousMeshEnabled(false);
    persistRendezvousFlag(false);
    if (p2pManager) {
      void p2pManager.setRendezvousEnabled(false);
    }
  }, [persistRendezvousFlag]);

  const setRendezvousMeshEnabled = useCallback(
    (value: boolean) => {
      if (value) {
        enableRendezvousMesh();
      } else {
        disableRendezvousMesh();
      }
    },
    [disableRendezvousMesh, enableRendezvousMesh]
  );

  const enableP2P = useCallback(async () => {
    if (p2pManager) {
      console.log('[useP2P] ⚠️ P2P already enabled, forcing restart...');
      p2pManager.stop();
      p2pManager = null;
    }

    const user = getCurrentUser();
    if (!user?.id) {
      console.error('[useP2P] ❌ Cannot enable P2P: no user ID');
      import('sonner').then(({ toast }) => {
        toast.error('Please log in to enable P2P');
      });
      return;
    }

    console.log('[useP2P] 🚀 Enabling P2P for user:', user.id);
    console.log('[useP2P] 📊 Browser environment:', {
      userAgent: navigator.userAgent,
      webRTC: 'RTCPeerConnection' in window,
      indexedDB: 'indexedDB' in window
    });
    
    setIsConnecting(true);
    
    // Show connecting toast
    import('sonner').then(({ toast }) => {
      toast.loading('Connecting to P2P network...', { id: 'p2p-connecting' });
    });
    
    try {
      p2pManager = new P2PManager(user.id, {
        rendezvous: {
          enabled: isRendezvousMeshEnabled,
          config: rendezvousConfig
        },
        controls,
      });
      await p2pManager.start();
      p2pManager.updateControlState(controls);
      setIsEnabled(true);
      setIsConnecting(false);
      setCurrentUserId(user.id);

      // Get initial stats immediately
      const initialStats = p2pManager.getStats();
      console.log('[useP2P] ✅ P2P enabled! Initial stats:', initialStats);
      setStats(initialStats);

      void notifyAchievements({
        type: 'p2p:connected',
        userId: user.id,
        stats: initialStats,
      });

      // Store preference
      localStorage.setItem("p2p-enabled", "true");
      
      // Import toast dynamically to show success
      import('sonner').then(({ toast }) => {
        toast.dismiss('p2p-connecting');
        toast.success('P2P network connected successfully!');
      });
    } catch (error) {
      console.error('[useP2P] ❌ Failed to enable P2P:', error);
      p2pManager = null;
      setIsEnabled(false);
      setIsConnecting(false);
      setStats(createOfflineStats());
      localStorage.setItem("p2p-enabled", "false");
      
      // Show error to user
      import('sonner').then(({ toast }) => {
        toast.dismiss('p2p-connecting');
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (errorMessage.includes('timeout') || errorMessage.includes('unavailable')) {
          toast.error('Could not connect to P2P signaling server. Your node is offline but will try again later.', {
            duration: 5000
          });
        } else if (errorMessage.includes('Network error')) {
          toast.error('Network error. Please check your internet connection.', {
            duration: 5000
          });
        } else {
          toast.error(`P2P connection failed: ${errorMessage}`, {
            duration: 5000
          });
        }
      });
    }
  }, [controls, isRendezvousMeshEnabled, rendezvousConfig]);

  const disable = useCallback((options: { persistPreference?: boolean } = {}) => {
    const { persistPreference = true } = options;

    if (!p2pManager) {
      console.log('[useP2P] P2P already disabled');
    } else {
      console.log('[useP2P] Disabling P2P...');
      p2pManager.stop();
      p2pManager = null;
    }
    setIsEnabled(false);
    setStats(createOfflineStats());
    setCurrentUserId(null);
    lastEmittedStatsRef.current = null;

    // Store preference
    if (persistPreference) {
      localStorage.setItem("p2p-enabled", "false");
    }
  }, []);

  useEffect(() => {
    const maybeEnable = () => {
      const storedPreference = localStorage.getItem("p2p-enabled") === "true";
      if (
        storedPreference &&
        controls.autoConnect &&
        !controls.manualAccept &&
        !controls.isolate &&
        !controls.paused
      ) {
        void enableP2P();
      }
    };

    maybeEnable();
    window.addEventListener("user-login", maybeEnable);

    return () => {
      window.removeEventListener("user-login", maybeEnable);
    };
  }, [controls.autoConnect, controls.isolate, controls.manualAccept, controls.paused, enableP2P]);

  useEffect(() => {
    const handleLogout = () => {
      disable({ persistPreference: false });
    };

    window.addEventListener("user-logout", handleLogout);

    return () => {
      window.removeEventListener("user-logout", handleLogout);
    };
  }, [disable]);

  useEffect(() => {
    // Update stats periodically when enabled
    if (isEnabled && p2pManager) {
      const interval = setInterval(() => {
        setStats(p2pManager!.getStats());
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    if (!hasStatsChanged(lastEmittedStatsRef.current, stats)) {
      return;
    }
    lastEmittedStatsRef.current = stats;

    statsListenersRef.current.forEach((listener) => {
      try {
        listener(stats);
      } catch (error) {
        console.warn('[useP2P] Stats listener failed', error);
      }
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('p2p:stats-update', { detail: { stats } }));
    }

    if (currentUserId) {
      void notifyAchievements({
        type: 'p2p:stats-update',
        userId: currentUserId,
        stats,
      });
    }
  }, [stats, isEnabled, currentUserId]);

  const subscribeToStats = useCallback((listener: (value: P2PStats) => void) => {
    statsListenersRef.current.add(listener);
    return () => {
      statsListenersRef.current.delete(listener);
    };
  }, []);

  const enable = useCallback(async () => {
    await enableP2P();
  }, [enableP2P]);

  const setControlFlag = useCallback((key: keyof P2PControlState, value: boolean) => {
    if (controls[key] === value) {
      return;
    }

    const next: P2PControlState = {
      ...controls,
      [key]: value,
    };

    if (key === 'paused' && value) {
      if (isEnabled) {
        wasEnabledBeforePauseRef.current = true;
        disable({ persistPreference: false });
      } else {
        wasEnabledBeforePauseRef.current = false;
      }
      applyControlState(next);
      return;
    }

    applyControlState(next);

    if (key === 'paused' && !value) {
      const storedPreference = typeof window !== 'undefined' && window.localStorage.getItem('p2p-enabled') === 'true';
      const shouldResume = wasEnabledBeforePauseRef.current || (
        storedPreference &&
        next.autoConnect &&
        !next.manualAccept &&
        !next.isolate &&
        !next.paused
      );
      wasEnabledBeforePauseRef.current = false;
      if (shouldResume && !isEnabled) {
        void enable();
      }
      return;
    }

    if (key === 'autoConnect' && value) {
      const storedPreference = typeof window !== 'undefined' && window.localStorage.getItem('p2p-enabled') === 'true';
      if (storedPreference && !next.manualAccept && !next.isolate && !next.paused && !isEnabled) {
        void enable();
      }
      return;
    }

    if ((key === 'manualAccept' || key === 'isolate') && !value) {
      const storedPreference = typeof window !== 'undefined' && window.localStorage.getItem('p2p-enabled') === 'true';
      if (storedPreference && next.autoConnect && !next.manualAccept && !next.isolate && !next.paused && !isEnabled) {
        void enable();
      }
    }
  }, [applyControlState, controls, disable, enable, isEnabled]);

  const requestChunk = useCallback(async (chunkHash: string): Promise<Uint8Array | null> => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot request chunk: P2P not enabled');
      return null;
    }

    return await p2pManager.requestChunk(chunkHash);
  }, []);

  const announceContent = useCallback((manifestHash: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot announce content: P2P not enabled');
      return;
    }

    p2pManager.announceContent(manifestHash);
  }, []);

  const ensureManifest = useCallback(
    async (
      manifestId: string,
      options: EnsureManifestOptions = {}
    ): Promise<Manifest | null> => {
      if (!p2pManager) {
        console.warn('[useP2P] Cannot ensure manifest: P2P not enabled');
        return null;
      }

      return await p2pManager.ensureManifest(manifestId, options);
    },
    []
  );

  const broadcastPost = useCallback((post: Post) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot broadcast post: P2P not enabled');
      return;
    }

    p2pManager.broadcastPost(post);
  }, []);

  const isContentAvailable = useCallback((manifestHash: string): boolean => {
    if (!p2pManager) return false;
    return p2pManager.isContentAvailable(manifestHash);
  }, []);

  const getDiscoveredPeers = useCallback(() => {
    if (!p2pManager) return [];
    return p2pManager.getDiscoveredPeers();
  }, []);

  const connectToPeer = useCallback((peerId: string, options: ConnectOptions = {}) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot connect to peer: P2P not enabled');
      return false;
    }
    return p2pManager.connectToPeer(peerId, options);
  }, []);

  const getPeerId = useCallback((): string | null => {
    if (!p2pManager) return null;
    return p2pManager.getPeerId();
  }, []);

  const joinRoom = useCallback((roomName: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot join room: P2P not enabled');
      return;
    }
    p2pManager.joinRoom(roomName);
  }, []);

  const leaveRoom = useCallback(() => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot leave room: P2P not enabled');
      return;
    }
    p2pManager.leaveRoom();
  }, []);

  const getCurrentRoom = useCallback((): string | null => {
    if (!p2pManager) return null;
    return p2pManager.getCurrentRoom();
  }, []);

  return {
    isEnabled,
    isConnecting,
    stats,
    isRendezvousMeshEnabled,
    rendezvousConfig,
    controls,
    enable,
    disable,
    enableRendezvousMesh,
    disableRendezvousMesh,
    setRendezvousMeshEnabled,
    setControlFlag,
    requestChunk,
    announceContent,
    ensureManifest,
    isContentAvailable,
    getDiscoveredPeers,
    broadcastPost,
    connectToPeer,
    getPeerId,
    joinRoom,
    leaveRoom,
    getCurrentRoom,
    subscribeToStats,
  };
}
