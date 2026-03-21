/**
 * Independent Network Mode Switcher
 * Single-alert lifecycle. Uses unified connectionState store.
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
 * Handles disable → flag flip → re-enable lifecycle.
 *
 * The `disable` call uses `persistPreference: false` so the unified
 * `enabled` flag stays true — only the mode changes.
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

  // Already in this mode
  if (previousMode === targetMode) {
    return result;
  }

  console.log(`[ModeSwitcher] Switching ${previousMode} → ${targetMode}…`);
  opts.onStatusChange?.('switching');

  // 1. Disconnect from current network (keep enabled flag)
  if (opts.isOnline) {
    console.log(`[ModeSwitcher] Disconnecting from ${previousMode}…`);
    opts.disable({ persistPreference: false });
    // Allow PeerJS Cloud to release the old session
    await new Promise(r => setTimeout(r, 2500));
  }

  // 2. Update unified store + feature flag atomically
  updateConnectionState({ mode: targetMode });
  setFeatureFlag('swarmMeshMode', targetMode === 'swarm');
  console.log(`[ModeSwitcher] Flags set → ${targetMode}`);

  // Allow flag propagation
  await new Promise(r => setTimeout(r, 300));

  // 3. Reconnect to new network
  if (opts.isOnline || state.enabled) {
    console.log(`[ModeSwitcher] Connecting to ${targetMode}…`);
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
