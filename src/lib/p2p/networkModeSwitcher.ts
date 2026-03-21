/**
 * Independent Network Mode Switcher
 * Single-alert, no cascades. Completely standalone from mesh scripts.
 */

import { getFeatureFlags, setFeatureFlag } from '@/config/featureFlags';

export type NetworkMode = 'swarm' | 'builder';

interface SwitchResult {
  previousMode: NetworkMode;
  newMode: NetworkMode;
  wasOnline: boolean;
}

type EnableFn = () => Promise<void> | void;
type DisableFn = () => void;

/**
 * Performs a clean mode switch with exactly one status toast.
 * Handles disable → flag flip → re-enable lifecycle.
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
  const flags = getFeatureFlags();
  const previousMode: NetworkMode = flags.swarmMeshMode ? 'swarm' : 'builder';
  const newSwarmFlag = targetMode === 'swarm';

  const result: SwitchResult = {
    previousMode,
    newMode: targetMode,
    wasOnline: opts.isOnline,
  };

  // Already in this mode
  if ((flags.swarmMeshMode && targetMode === 'swarm') || (!flags.swarmMeshMode && targetMode === 'builder')) {
    return result;
  }

  opts.onStatusChange?.('switching');

  if (opts.isOnline) {
    opts.disable();
    // Brief cooldown for connections to tear down
    await new Promise(r => setTimeout(r, 1200));
  }

  setFeatureFlag('swarmMeshMode', newSwarmFlag);

  // Allow flag propagation
  await new Promise(r => setTimeout(r, 300));

  if (opts.isOnline) {
    await opts.enable();
  }

  opts.onStatusChange?.('done');
  return result;
}

export function getCurrentMode(): NetworkMode {
  return getFeatureFlags().swarmMeshMode ? 'swarm' : 'builder';
}

export function getModeLabel(mode: NetworkMode): string {
  return mode === 'swarm' ? 'SWARM Mesh' : 'Builder Mode';
}
