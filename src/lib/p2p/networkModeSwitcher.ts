/**
 * Independent Network Mode Switcher
 * Single-alert lifecycle. Uses unified connectionState store.
 * Coordinates standalone scripts (SwarmMesh + BuilderMode).
 */

import { setFeatureFlag } from '@/config/featureFlags';
import {
  loadConnectionState,
  updateConnectionState,
  type NetworkMode,
} from '@/lib/p2p/connectionState';

export type { NetworkMode };

interface SwitchResult {
  previousMode: NetworkMode;
  newMode: NetworkMode;
  wasOnline: boolean;
}

type EnableFn = () => Promise<void> | void;
type DisableFn = (options?: { persistPreference?: boolean }) => void;

/**
 * Performs a clean mode switch with exactly one status toast.
 * Handles disable → flag flip → standalone stop/start lifecycle.
 */
export async function switchNetworkMode(
  targetMode: NetworkMode,
  opts: {
    enable: EnableFn;
    disable: DisableFn;
    isOnline: boolean;
    onStatusChange?: (status: 'switching' | 'done') => void;
  },
): Promise<SwitchResult> {
  const state = loadConnectionState();
  const previousMode = state.mode;

  const result: SwitchResult = {
    previousMode,
    newMode: targetMode,
    wasOnline: opts.isOnline,
  };

  if (previousMode === targetMode) return result;

  console.log(`[ModeSwitcher] Switching ${previousMode} → ${targetMode}…`);
  opts.onStatusChange?.('switching');

  // 1. Stop current standalone + disconnect
  try {
    const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone');
    const { getStandaloneBuilderMode } = await import('@/lib/p2p/builderMode.standalone');
    const sm = getSwarmMeshStandalone();
    const bm = getStandaloneBuilderMode();

    if (previousMode === 'swarm') {
      sm.stop();
    } else {
      bm.stop();
    }
  } catch (e) {
    console.warn('[ModeSwitcher] Failed to stop previous mode standalone:', e);
  }

  if (opts.isOnline) {
    opts.disable({ persistPreference: false });
    await new Promise(r => setTimeout(r, 2500));
  }

  // 2. Update unified store + feature flag atomically
  updateConnectionState({ mode: targetMode });
  setFeatureFlag('swarmMeshMode', targetMode === 'swarm');
  console.log(`[ModeSwitcher] Flags set → ${targetMode}`);

  await new Promise(r => setTimeout(r, 300));

  // 3. Start new standalone + reconnect
  if (opts.isOnline || state.enabled) {
    console.log(`[ModeSwitcher] Starting ${targetMode} standalone…`);
    try {
      if (targetMode === 'swarm') {
        const { getSwarmMeshStandalone } = await import('@/lib/p2p/swarmMesh.standalone');
        void getSwarmMeshStandalone().start();
      } else {
        const { getStandaloneBuilderMode } = await import('@/lib/p2p/builderMode.standalone');
        void getStandaloneBuilderMode().start();
      }
    } catch (e) {
      console.warn('[ModeSwitcher] Failed to start new mode standalone:', e);
    }
    await opts.enable();
  }

  console.log(`[ModeSwitcher] ✅ Connected to ${targetMode}`);
  opts.onStatusChange?.('done');
  return result;
}

export function getCurrentMode(): NetworkMode {
  return loadConnectionState().mode;
}

export function getModeLabel(mode: NetworkMode): string {
  return mode === 'swarm' ? 'SWARM Mesh' : 'Builder Mode';
}
