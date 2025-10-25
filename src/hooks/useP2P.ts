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
  const [isConnecting, setIsConnecting] = useState(false);

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
      p2pManager = new P2PManager(user.id);
      await p2pManager.start();
      setIsEnabled(true);
      setIsConnecting(false);
      
      // Get initial stats immediately
      const initialStats = p2pManager.getStats();
      console.log('[useP2P] ✅ P2P enabled! Initial stats:', initialStats);
      setStats(initialStats);

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

  const broadcastUserUpdate = useCallback((user: any) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot broadcast user update: P2P not enabled');
      return;
    }

    p2pManager.broadcastUserUpdate(user);
  }, []);

  return {
    isEnabled,
    isConnecting,
    stats,
    enable,
    disable,
    requestChunk,
    announceContent,
    isContentAvailable,
    getDiscoveredPeers,
    broadcastPost,
    broadcastUserUpdate,
    connectToPeer,
    getPeerId,
    joinRoom,
    leaveRoom,
    getCurrentRoom
  };
}
