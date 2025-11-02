/**
 * React hook for P2P networking
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  P2PManager,
  P2PStats,
  P2PStatus,
  type EnsureManifestOptions,
  type ConnectOptions,
  type P2PControlState,
  type PendingPeer,
  type PeerJSEndpoint,
  type PeerJSSignalingConfiguration,
} from '@/lib/p2p/manager';
import type { Post } from '@/types';
import type { Comment } from '@/types';
import { getCurrentUser } from '@/lib/auth';
import { loadRendezvousConfig } from '@/lib/p2p/rendezvousConfig';
import type { AchievementEvent } from '@/lib/achievements';
import type { Manifest } from '@/lib/store';
import {
  getP2PDiagnostics,
  recordP2PDiagnostic,
  type P2PDiagnosticEvent
} from '@/lib/p2p/diagnostics';
import { createDefaultPeerJSSignalingConfig } from '@/lib/p2p/peerjs-adapter';

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
  pingCount: 0,
  connectionAttempts: 0,
  successfulConnections: 0,
  failedConnectionAttempts: 0,
  rendezvousAttempts: 0,
  rendezvousSuccesses: 0,
  rendezvousFailures: 0,
  rendezvousFailureStreak: 0,
  timeToFirstPeerMs: null,
  lastBeaconLatencyMs: null,
  metrics: {
    uptimeMs: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
    relayCount: 0,
    pingCount: 0,
    connectionAttempts: 0,
    successfulConnections: 0,
    failedConnectionAttempts: 0,
    rendezvousAttempts: 0,
    rendezvousSuccesses: 0,
    rendezvousFailures: 0,
  },
  signalingEndpointUrl: null,
  signalingEndpointLabel: null,
  signalingEndpointId: null,
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
const BLOCKED_PEERS_STORAGE_KEY = 'p2p-blocked-peers';
const P2P_ENABLED_STORAGE_KEY = 'p2p-enabled';
const SIGNALING_ENDPOINT_STORAGE_KEY = 'p2p-signaling-endpoint-id';

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

const loadBlockedPeersFromStorage = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(BLOCKED_PEERS_STORAGE_KEY);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch (error) {
    console.warn('[useP2P] Failed to load blocked peers from storage', error);
    return [];
  }
};

const persistBlockedPeersToStorage = (peers: string[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(BLOCKED_PEERS_STORAGE_KEY, JSON.stringify(peers));
  } catch (error) {
    console.warn('[useP2P] Failed to persist blocked peers to storage', error);
  }
};

const loadStoredSignalingEndpointId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(SIGNALING_ENDPOINT_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch (error) {
    console.warn('[useP2P] Failed to read stored signaling endpoint preference', error);
    return null;
  }
};

const persistSignalingEndpointId = (id: string | null): void => {
  if (typeof window === 'undefined' || !id) {
    return;
  }
  try {
    window.localStorage.setItem(SIGNALING_ENDPOINT_STORAGE_KEY, id);
  } catch (error) {
    console.warn('[useP2P] Failed to persist signaling endpoint preference', error);
  }
};

const sanitizeEndpointDefinition = (
  value: unknown,
  index: number
): PeerJSSignalingConfiguration['endpoints'][number] | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawHost = typeof record.host === 'string' ? record.host.trim() : '';
  if (!rawHost) {
    return null;
  }

  const normalizeBoolean = (input: unknown, fallback: boolean): boolean => {
    if (typeof input === 'boolean') {
      return input;
    }
    if (typeof input === 'string') {
      const normalized = input.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return fallback;
  };

  const secure = normalizeBoolean(record.secure, true);
  const rawPort = typeof record.port === 'number' ? record.port : Number.parseInt(String(record.port ?? ''), 10);
  const port = Number.isFinite(rawPort) ? rawPort : secure ? 443 : 80;
  const path = typeof record.path === 'string' ? record.path : undefined;
  const label = typeof record.label === 'string' ? record.label : undefined;
  const id = typeof record.id === 'string' ? record.id : undefined;

  return {
    host: rawHost,
    port,
    secure,
    path,
    label,
    id: id ?? undefined,
  };
};

const loadSignalingConfigFromEnvironment = (): PeerJSSignalingConfiguration => {
  const base = createDefaultPeerJSSignalingConfig();
  const config: PeerJSSignalingConfiguration = {
    endpoints: [...base.endpoints],
    iceServers: base.iceServers ? [...base.iceServers] : undefined,
    attemptsPerEndpoint: base.attemptsPerEndpoint,
  };

  const envAttempts = import.meta.env?.VITE_PEERJS_ATTEMPTS_PER_ENDPOINT as string | undefined;
  if (envAttempts) {
    const parsed = Number.parseInt(envAttempts, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.attemptsPerEndpoint = parsed;
    }
  }

  const rawEndpoints = import.meta.env?.VITE_PEERJS_ENDPOINTS as string | undefined;
  if (rawEndpoints) {
    try {
      const parsed = JSON.parse(rawEndpoints);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const sanitized = list
        .map((value, index) => sanitizeEndpointDefinition(value, index))
        .filter((value): value is PeerJSSignalingConfiguration['endpoints'][number] => Boolean(value));
      if (sanitized.length > 0) {
        config.endpoints = sanitized;
      }
    } catch (error) {
      console.warn('[useP2P] Failed to parse VITE_PEERJS_ENDPOINTS:', error);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'useP2P',
        code: 'env-endpoints-parse-error',
        message: 'Failed to parse VITE_PEERJS_ENDPOINTS',
        context: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  } else {
    const envHost = import.meta.env?.VITE_PEERJS_HOST as string | undefined;
    if (envHost) {
      const envLabel = import.meta.env?.VITE_PEERJS_LABEL as string | undefined;
      const envPortValue = import.meta.env?.VITE_PEERJS_PORT as string | undefined;
      const envSecure = import.meta.env?.VITE_PEERJS_SECURE as string | undefined;
      const envPath = import.meta.env?.VITE_PEERJS_PATH as string | undefined;
      const secure = envSecure ? envSecure.toLowerCase() !== 'false' : true;
      const port = envPortValue ? Number.parseInt(envPortValue, 10) : secure ? 443 : 80;
      const resolvedPort = Number.isFinite(port) ? port : secure ? 443 : 80;
      config.endpoints = [
        {
          id: 'env-primary',
          label: envLabel,
          host: envHost,
          port: resolvedPort,
          secure,
          path: envPath,
        },
        ...config.endpoints,
      ];
    }
  }

  const rawIceServers = import.meta.env?.VITE_PEERJS_ICE_SERVERS as string | undefined;
  if (rawIceServers) {
    try {
      const parsed = JSON.parse(rawIceServers);
      if (Array.isArray(parsed) && parsed.length > 0) {
        config.iceServers = parsed as RTCIceServer[];
      }
    } catch (error) {
      console.warn('[useP2P] Failed to parse VITE_PEERJS_ICE_SERVERS:', error);
      recordP2PDiagnostic({
        level: 'warn',
        source: 'useP2P',
        code: 'env-ice-parse-error',
        message: 'Failed to parse VITE_PEERJS_ICE_SERVERS',
        context: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  return config;
};

const getStoredP2PPreference = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    const stored = window.localStorage.getItem(P2P_ENABLED_STORAGE_KEY);
    if (stored === null) {
      return true;
    }
    return stored === 'true';
  } catch (error) {
    console.warn('[useP2P] Failed to read stored P2P preference', error);
    return true;
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
  const pendingPeersUnsubscribeRef = useRef<(() => void) | null>(null);
  const [controls, setControls] = useState<P2PControlState>(() => loadControlsFromStorage());
  const wasEnabledBeforePauseRef = useRef(false);
  const [blockedPeers, setBlockedPeers] = useState<string[]>(() => loadBlockedPeersFromStorage());
  const [pendingPeers, setPendingPeers] = useState<PendingPeer[]>([]);
  const diagnosticsStore = useMemo(() => getP2PDiagnostics(), []);
  const [diagnosticEvents, setDiagnosticEvents] = useState<P2PDiagnosticEvent[]>(() => diagnosticsStore.getEvents());
  const [activeSignalingEndpoint, setActiveSignalingEndpoint] = useState<PeerJSEndpoint | null>(null);
  const signalingEndpointUnsubscribeRef = useRef<(() => void) | null>(null);
  const [rendezvousDisabledReason, setRendezvousDisabledReason] = useState<'capability' | 'failure' | null>(null);
  const lastRendezvousNoticeRef = useRef<string | null>(null);

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

  const syncBlockedPeers = useCallback((peers: string[]) => {
    persistBlockedPeersToStorage(peers);
    if (p2pManager) {
      p2pManager.setBlockedPeers(peers);
    }
  }, []);

  const updateBlockedPeers = useCallback((updater: (previous: string[]) => string[]) => {
    setBlockedPeers((previous) => {
      const next = Array.from(
        new Set(
          updater(previous)
            .map((peerId) => peerId.trim())
            .filter((peerId) => peerId.length > 0)
        )
      );
      syncBlockedPeers(next);
      return next;
    });
  }, [syncBlockedPeers]);

  const applyControlState = useCallback((next: P2PControlState) => {
    setControls(next);
    persistControls(next);
    if (p2pManager) {
      p2pManager.updateControlState(next);
    }
  }, [persistControls]);

  const enableRendezvousMesh = useCallback(() => {
    setRendezvousDisabledReason(null);
    setIsRendezvousMeshEnabled(true);
    persistRendezvousFlag(true);
    if (p2pManager) {
      void p2pManager.setRendezvousEnabled(true);
    }
  }, [persistRendezvousFlag]);

  const disableRendezvousMesh = useCallback(() => {
    setRendezvousDisabledReason(null);
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
    diagnosticsStore.clear();
    setDiagnosticEvents([]);
    recordP2PDiagnostic({
      level: 'info',
      source: 'useP2P',
      code: 'enable-requested',
      message: 'P2P enablement requested'
    });
    if (typeof window === 'undefined') {
      console.warn('[useP2P] ⚠️ Cannot enable P2P outside of a browser environment');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'useP2P',
        code: 'enable-window-missing',
        message: 'Window object unavailable during enable request'
      });
      return;
    }

    if (typeof navigator === 'undefined') {
      console.warn('[useP2P] ⚠️ Navigator API unavailable; skipping P2P enablement');
      recordP2PDiagnostic({
        level: 'warn',
        source: 'useP2P',
        code: 'enable-navigator-missing',
        message: 'Navigator API unavailable during enable request'
      });
      return;
    }

    if (p2pManager) {
      console.log('[useP2P] ⚠️ P2P already enabled, forcing restart...');
      recordP2PDiagnostic({
        level: 'info',
        source: 'useP2P',
        code: 'enable-force-restart',
        message: 'Existing P2P manager detected; restarting'
      });
      pendingPeersUnsubscribeRef.current?.();
      pendingPeersUnsubscribeRef.current = null;
      signalingEndpointUnsubscribeRef.current?.();
      signalingEndpointUnsubscribeRef.current = null;
      setActiveSignalingEndpoint(null);
      p2pManager.stop();
      p2pManager = null;
    }

    const user = getCurrentUser();
    if (!user?.id) {
      console.error('[useP2P] ❌ Cannot enable P2P: no user ID');
      recordP2PDiagnostic({
        level: 'error',
        source: 'useP2P',
        code: 'enable-missing-user',
        message: 'Unable to enable P2P because no user is logged in'
      });
      import('sonner').then(({ toast }) => {
        toast.error('Please log in to enable P2P');
      });
      return;
    }

    console.log('[useP2P] 🚀 Enabling P2P for user:', user.id);
    const environmentDetails = {
      userAgent: navigator.userAgent,
      webRTC: 'RTCPeerConnection' in window,
      indexedDB: 'indexedDB' in window,
    };

    console.log('[useP2P] 📊 Browser environment:', environmentDetails);
    recordP2PDiagnostic({
      level: 'info',
      source: 'useP2P',
      code: 'enable-environment',
      message: 'Captured browser capabilities for P2P enablement',
      context: environmentDetails
    });
    
    setIsConnecting(true);
    
    // Show connecting toast
    import('sonner').then(({ toast }) => {
      toast.loading('Connecting to P2P network...', { id: 'p2p-connecting' });
    });

    try {
      const signalingConfig = loadSignalingConfigFromEnvironment();
      const storedEndpointId = loadStoredSignalingEndpointId();
      if (storedEndpointId) {
        signalingConfig.preferredEndpointId = storedEndpointId;
      }

      recordP2PDiagnostic({
        level: 'info',
        source: 'useP2P',
        code: 'signaling-config-resolved',
        message: 'Resolved PeerJS signaling configuration',
        context: {
          attemptsPerEndpoint: signalingConfig.attemptsPerEndpoint,
          preferredEndpointId: signalingConfig.preferredEndpointId ?? null,
          endpoints: signalingConfig.endpoints.map((endpoint, index) => ({
            index,
            id: endpoint.id ?? null,
            label: endpoint.label ?? null,
            host: endpoint.host,
            port: endpoint.port,
            secure: endpoint.secure,
            path: endpoint.path ?? '/',
          })),
        },
      });

      p2pManager = new P2PManager(user.id, {
        rendezvous: {
          enabled: isRendezvousMeshEnabled,
          config: rendezvousConfig
        },
        controls,
        signaling: signalingConfig,
      });
      p2pManager.setBlockedPeers(blockedPeers);
      await p2pManager.start();
      p2pManager.updateControlState(controls);
      setIsEnabled(true);
      setIsConnecting(false);
      setCurrentUserId(user.id);

      signalingEndpointUnsubscribeRef.current = p2pManager.subscribeToSignalingEndpoint((endpoint) => {
        setActiveSignalingEndpoint(endpoint);
        if (endpoint) {
          persistSignalingEndpointId(endpoint.id);
        }
      });

      // Get initial stats immediately
      const initialStats = p2pManager.getStats();
      console.log('[useP2P] ✅ P2P enabled! Initial stats:', initialStats);
      recordP2PDiagnostic({
        level: 'info',
        source: 'useP2P',
        code: 'enable-success',
        message: 'P2P manager enabled successfully',
        context: initialStats as unknown as Record<string, unknown>
      });
      setStats(initialStats);
      setPendingPeers(p2pManager.getPendingPeers());
      pendingPeersUnsubscribeRef.current = p2pManager.subscribeToPendingPeers((peers) => {
        setPendingPeers(peers);
      });

      const initialEndpoint = p2pManager.getActiveSignalingEndpoint();
      setActiveSignalingEndpoint(initialEndpoint);
      if (initialEndpoint) {
        persistSignalingEndpointId(initialEndpoint.id);
      }

      void notifyAchievements({
        type: 'p2p:connected',
        userId: user.id,
        stats: initialStats,
      });

      // Listen for new comments to broadcast
      const handleCommentCreated = (event: Event) => {
        const detail = (event as CustomEvent<{ comment: Comment }>).detail;
        if (detail?.comment) {
          p2pManager?.broadcastComment(detail.comment);
        }
      };
      window.addEventListener('p2p-comment-created', handleCommentCreated);

      // Cleanup on disable
      const cleanup = () => {
        window.removeEventListener('p2p-comment-created', handleCommentCreated);
      };
      
      // Store cleanup reference
      p2pManager.setCommentCleanup(cleanup);

      // Store preference
      localStorage.setItem(P2P_ENABLED_STORAGE_KEY, 'true');
      
      // Import toast dynamically to show success
      import('sonner').then(({ toast }) => {
        toast.dismiss('p2p-connecting');
        toast.success('P2P network connected successfully!');
      });
    } catch (error) {
      console.error('[useP2P] ❌ Failed to enable P2P:', error);
      recordP2PDiagnostic({
        level: 'error',
        source: 'useP2P',
        code: 'enable-failed',
        message: error instanceof Error ? error.message : 'Unknown enable failure'
      });
      p2pManager = null;
      setIsEnabled(false);
      setIsConnecting(false);
      setStats(createOfflineStats());
      setActiveSignalingEndpoint(null);
      pendingPeersUnsubscribeRef.current?.();
      pendingPeersUnsubscribeRef.current = null;
      signalingEndpointUnsubscribeRef.current?.();
      signalingEndpointUnsubscribeRef.current = null;
      setPendingPeers([]);
      localStorage.setItem(P2P_ENABLED_STORAGE_KEY, 'false');

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
  }, [blockedPeers, controls, diagnosticsStore, isRendezvousMeshEnabled, rendezvousConfig]);

  const disable = useCallback((options: { persistPreference?: boolean } = {}) => {
    const { persistPreference = true } = options;

    if (!p2pManager) {
      console.log('[useP2P] P2P already disabled');
      recordP2PDiagnostic({
        level: 'info',
        source: 'useP2P',
        code: 'disable-noop',
        message: 'Disable requested but manager not running'
      });
    } else {
      console.log('[useP2P] Disabling P2P...');
      recordP2PDiagnostic({
        level: 'info',
        source: 'useP2P',
        code: 'disable-requested',
        message: 'Stopping active P2P manager'
      });
      // Cleanup comment listener
      p2pManager.runCommentCleanup();
      p2pManager.stop();
      p2pManager = null;
    }
    pendingPeersUnsubscribeRef.current?.();
    pendingPeersUnsubscribeRef.current = null;
    signalingEndpointUnsubscribeRef.current?.();
    signalingEndpointUnsubscribeRef.current = null;
    setIsEnabled(false);
    setIsConnecting(false); // Clear connecting state
    setStats(createOfflineStats());
    setCurrentUserId(null);
    lastEmittedStatsRef.current = null;
    setPendingPeers([]);
    setActiveSignalingEndpoint(null);
    recordP2PDiagnostic({
      level: 'info',
      source: 'useP2P',
      code: 'disable-complete',
      message: 'P2P networking disabled'
    });

    // Dismiss any connecting toasts
    import('sonner').then(({ toast }) => {
      toast.dismiss('p2p-connecting');
    });

    // Store preference
    if (persistPreference && typeof window !== 'undefined') {
      localStorage.setItem(P2P_ENABLED_STORAGE_KEY, 'false');
    }
  }, []);

  useEffect(() => {
    const maybeEnable = () => {
      const shouldEnable = getStoredP2PPreference();
      if (
        shouldEnable &&
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

  useEffect(() => {
    return () => {
      pendingPeersUnsubscribeRef.current?.();
      pendingPeersUnsubscribeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = diagnosticsStore.subscribe((events) => {
      setDiagnosticEvents(events);
    });
    return unsubscribe;
  }, [diagnosticsStore]);

  useEffect(() => {
    if (diagnosticEvents.length === 0) {
      return;
    }
    const latest = diagnosticEvents[diagnosticEvents.length - 1];
    if (latest.source !== 'rendezvous') {
      return;
    }

    if (latest.code === 'rendezvous-disabled-ed25519') {
      if (lastRendezvousNoticeRef.current === latest.id) {
        return;
      }
      lastRendezvousNoticeRef.current = latest.id;
      setRendezvousDisabledReason('capability');
      if (isRendezvousMeshEnabled) {
        setIsRendezvousMeshEnabled(false);
      }
      persistRendezvousFlag(false);
      import('sonner').then(({ toast }) => {
        toast.error('Rendezvous mesh disabled: Ed25519 unsupported', {
          description: 'Peer discovery will fall back to bootstrap peers until you update your browser.',
          duration: 8000,
        });
      });
    } else if (latest.code === 'rendezvous-disabled-failure-streak') {
      if (lastRendezvousNoticeRef.current === latest.id) {
        return;
      }
      lastRendezvousNoticeRef.current = latest.id;
      setRendezvousDisabledReason('failure');
      if (isRendezvousMeshEnabled) {
        setIsRendezvousMeshEnabled(false);
      }
      persistRendezvousFlag(false);
      import('sonner').then(({ toast }) => {
        toast.warning('Rendezvous mesh temporarily offline', {
          description: 'Discovery beacons and capsules failed repeatedly; using bootstrap peers only for now.',
          duration: 8000,
        });
      });
    } else if (latest.code === 'rendezvous-capability-ed25519') {
      setRendezvousDisabledReason(null);
    }
  }, [diagnosticEvents, isRendezvousMeshEnabled, persistRendezvousFlag]);

  const subscribeToStats = useCallback((listener: (value: P2PStats) => void) => {
    statsListenersRef.current.add(listener);
    return () => {
      statsListenersRef.current.delete(listener);
    };
  }, []);

  const clearDiagnostics = useCallback(() => {
    diagnosticsStore.clear();
    setDiagnosticEvents([]);
  }, [diagnosticsStore]);

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
      const storedPreference = getStoredP2PPreference();
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
      const storedPreference = getStoredP2PPreference();
      if (storedPreference && !next.manualAccept && !next.isolate && !next.paused && !isEnabled) {
        void enable();
      }
      return;
    }

    if ((key === 'manualAccept' || key === 'isolate') && !value) {
      const storedPreference = getStoredP2PPreference();
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

    void p2pManager.broadcastPost(post);
  }, []);

  const broadcastComment = useCallback((comment: Comment) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot broadcast comment: P2P not enabled');
      return;
    }

    p2pManager.broadcastComment(comment);
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

  const disconnectFromPeer = useCallback((peerId: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot disconnect peer: P2P not enabled');
      return;
    }
    p2pManager.disconnectFromPeer(peerId);
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

  const blockPeer = useCallback((peerId: string) => {
    const trimmed = peerId.trim();
    if (!trimmed) {
      return;
    }
    updateBlockedPeers((previous) => [...previous, trimmed]);
  }, [updateBlockedPeers]);

  const unblockPeer = useCallback((peerId: string) => {
    updateBlockedPeers((previous) => previous.filter((id) => id !== peerId));
  }, [updateBlockedPeers]);

  const isPeerBlocked = useCallback((peerId: string) => blockedPeers.includes(peerId), [blockedPeers]);

  const approvePendingPeer = useCallback((peerId: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot approve peer: P2P not enabled');
      return false;
    }
    return p2pManager.approvePendingPeer(peerId);
  }, []);

  const rejectPendingPeer = useCallback((peerId: string) => {
    if (!p2pManager) {
      console.warn('[useP2P] Cannot reject peer: P2P not enabled');
      return;
    }
    p2pManager.rejectPendingPeer(peerId);
  }, []);

  return {
    isEnabled,
    isConnecting,
    stats,
    activeSignalingEndpoint,
    isRendezvousMeshEnabled,
    rendezvousDisabledReason,
    rendezvousConfig,
    controls,
    blockedPeers,
    pendingPeers,
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
    broadcastComment,
    connectToPeer,
    disconnectFromPeer,
    getPeerId,
    joinRoom,
    leaveRoom,
    getCurrentRoom,
    subscribeToStats,
    blockPeer,
    unblockPeer,
    isPeerBlocked,
    approvePendingPeer,
    rejectPendingPeer,
    diagnostics: diagnosticEvents,
    clearDiagnostics,
  };
}
