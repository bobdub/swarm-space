/**
 * React hook for P2P networking
 */

import { useState, useEffect, useCallback } from 'react';
import { P2PManager, P2PStats } from '@/lib/p2p/manager';
import { getCurrentUser } from '@/lib/auth';

let p2pManager: P2PManager | null = null;

export function useP2P() {
  const [stats, setStats] = useState<P2PStats>({
    status: 'offline',
    connectedPeers: 0,
    discoveredPeers: 0,
    localContent: 0,
    networkContent: 0,
    activeRequests: 0
  });
  const [isEnabled, setIsEnabled] = useState(false);

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
    p2pManager = new P2PManager(user.id);
    await p2pManager.start();
    setIsEnabled(true);
    setStats(p2pManager.getStats());
  }, []);

  const disable = useCallback(() => {
    if (!p2pManager) {
      console.log('[useP2P] P2P already disabled');
      return;
    }

    console.log('[useP2P] Disabling P2P...');
    p2pManager.stop();
    p2pManager = null;
    setIsEnabled(false);
    setStats({
      status: 'offline',
      connectedPeers: 0,
      discoveredPeers: 0,
      localContent: 0,
      networkContent: 0,
      activeRequests: 0
    });
  }, []);

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

  const isContentAvailable = useCallback((manifestHash: string): boolean => {
    if (!p2pManager) return false;
    return p2pManager.isContentAvailable(manifestHash);
  }, []);

  const getDiscoveredPeers = useCallback(() => {
    if (!p2pManager) return [];
    return p2pManager.getDiscoveredPeers();
  }, []);

  return {
    isEnabled,
    stats,
    enable,
    disable,
    requestChunk,
    announceContent,
    isContentAvailable,
    getDiscoveredPeers
  };
}
