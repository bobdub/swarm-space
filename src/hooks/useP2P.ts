/**
 * React hook for P2P networking
 */

import { useState, useEffect, useCallback } from 'react';
import { P2PManager, P2PStats, P2PStatus } from '@/lib/p2p/manager';
import type { Post } from '@/types';
import { getCurrentUser } from '@/lib/auth';

let p2pManager: P2PManager | null = null;

const createOfflineStats = (): P2PStats => ({
  status: 'offline' as P2PStatus,
  connectedPeers: 0,
  discoveredPeers: 0,
  localContent: 0,
  networkContent: 0,
  activeRequests: 0
});

export function useP2P() {
  const [stats, setStats] = useState<P2PStats>(() => createOfflineStats());
  const [isEnabled, setIsEnabled] = useState(false);

  const enableP2P = useCallback(async () => {
    if (p2pManager) {
      console.log('[useP2P] P2P already enabled');
      return;
    }

    const user = getCurrentUser();
    if (!user?.id) {
      console.error('[useP2P] Cannot enable P2P: no user ID');
      return;
    }

    console.log('[useP2P] Enabling P2P...');
    try {
      p2pManager = new P2PManager(user.id);
      await p2pManager.start();
      setIsEnabled(true);
      setStats(p2pManager.getStats());

      // Store preference
      localStorage.setItem("p2p-enabled", "true");
    } catch (error) {
      console.error('[useP2P] Failed to enable P2P:', error);
      p2pManager = null;
      setIsEnabled(false);
      setStats(createOfflineStats());
      localStorage.setItem("p2p-enabled", "false");
    }
  }, []);

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

    // Store preference
    if (persistPreference) {
      localStorage.setItem("p2p-enabled", "false");
    }
  }, []);

  useEffect(() => {
    const maybeEnable = () => {
      if (localStorage.getItem("p2p-enabled") === "true") {
        void enableP2P();
      }
    };

    maybeEnable();
    window.addEventListener("user-login", maybeEnable);

    return () => {
      window.removeEventListener("user-login", maybeEnable);
    };
  }, [enableP2P]);

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

  const enable = useCallback(async () => {
    await enableP2P();
  }, [enableP2P]);

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

  const connectToPeer = useCallback((peerId: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot connect to peer: P2P not enabled');
      return;
    }
    p2pManager.connectToPeer(peerId);
  }, []);

  return {
    isEnabled,
    stats,
    enable,
    disable,
    requestChunk,
    announceContent,
    isContentAvailable,
    getDiscoveredPeers,
    broadcastPost,
    connectToPeer
  };
}
