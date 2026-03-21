/**
 * ═══════════════════════════════════════════════════════════════════════
 * Bootstrap Fallback Monitor — Standalone Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Monitors mesh connectivity after startup. If zero peers are connected
 * after a configurable timeout (default 15 s), dispatches a custom event
 * prompting the user to manually enter a Node ID or Peer ID.
 *
 * Accepts both ID formats via idResolver, auto-switches network mode
 * (SWARM ↔ Builder) when a cross-mode ID is entered, and connects.
 *
 * ZERO imports from swarmMesh.standalone or builderMode.standalone —
 * all mesh interaction goes through injected callbacks.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { resolveNetworkId, isValidNetworkId, formatNetworkId } from './idResolver';
import { switchNetworkMode, getCurrentMode, type NetworkMode } from './networkModeSwitcher';

// ── Custom Events ─────────────────────────────────────────────────────

export const BOOTSTRAP_FAILED_EVENT = 'swarm-bootstrap-failed';
export const BOOTSTRAP_RECOVERED_EVENT = 'swarm-bootstrap-recovered';

export interface BootstrapFailedDetail {
  mode: NetworkMode;
  attemptedNodes: number;
}

export interface ManualConnectResult {
  success: boolean;
  resolvedId: string | null;
  modeSwitched: boolean;
  error?: string;
}

// ── Configuration ─────────────────────────────────────────────────────

export interface FallbackMonitorConfig {
  /** Returns current connected peer count */
  getPeerCount: () => number;
  /** Connect to a peer ID (PeerJS alias or raw) */
  connectPeer: (peerId: string) => boolean;
  /** Enable P2P (after mode switch) */
  enable: () => Promise<void> | void;
  /** Disable P2P (before mode switch) */
  disable: () => void;
  /** Whether P2P is currently online */
  isOnline: () => boolean;
  /** How long to wait before declaring bootstrap failed (ms) */
  timeoutMs?: number;
  /** Number of bootstrap nodes that were attempted */
  attemptedNodes?: number;
}

// ── Monitor Class ─────────────────────────────────────────────────────

export class BootstrapFallbackMonitor {
  private config: FallbackMonitorConfig;
  private timeoutId: number | null = null;
  private watchId: number | null = null;
  private hasFired = false;
  private recovered = false;

  constructor(config: FallbackMonitorConfig) {
    this.config = config;
  }

  /**
   * Start monitoring. Call after mesh bootstrap + restore completes.
   */
  start(): void {
    const timeout = this.config.timeoutMs ?? 15_000;
    this.hasFired = false;
    this.recovered = false;

    // Initial check — maybe we already have peers
    if (this.config.getPeerCount() > 0) {
      console.log('[BootstrapFallback] ✅ Peers already connected, no fallback needed');
      return;
    }

    this.timeoutId = window.setTimeout(() => {
      this.checkAndFire();
    }, timeout);

    // Also watch for recovery (peer connects before or after timeout)
    this.watchId = window.setInterval(() => {
      if (this.config.getPeerCount() > 0 && !this.recovered) {
        this.recovered = true;
        if (this.hasFired) {
          window.dispatchEvent(new CustomEvent(BOOTSTRAP_RECOVERED_EVENT));
          console.log('[BootstrapFallback] ✅ Recovered — peer connected');
        }
        this.cleanup();
      }
    }, 3_000);
  }

  /**
   * Stop monitoring and clean up timers.
   */
  stop(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.watchId !== null) {
      clearInterval(this.watchId);
      this.watchId = null;
    }
  }

  private checkAndFire(): void {
    if (this.config.getPeerCount() > 0) {
      console.log('[BootstrapFallback] ✅ Peers found before timeout');
      this.cleanup();
      return;
    }

    this.hasFired = true;
    const detail: BootstrapFailedDetail = {
      mode: getCurrentMode(),
      attemptedNodes: this.config.attemptedNodes ?? 0,
    };
    window.dispatchEvent(new CustomEvent(BOOTSTRAP_FAILED_EVENT, { detail }));
    console.log('[BootstrapFallback] ⚠️ No peers connected — fallback event dispatched');
  }

  /**
   * Handle a manually entered Node ID or Peer ID.
   * Detects format, auto-switches network mode if needed, and connects.
   */
  async handleManualConnect(rawId: string): Promise<ManualConnectResult> {
    if (!rawId.trim()) {
      return { success: false, resolvedId: null, modeSwitched: false, error: 'Empty input' };
    }

    if (!isValidNetworkId(rawId)) {
      return { success: false, resolvedId: null, modeSwitched: false, error: 'Invalid ID format' };
    }

    const resolved = resolveNetworkId(rawId);
    const currentMode = getCurrentMode();
    let modeSwitched = false;

    // Determine target mode from ID format
    const targetMode: NetworkMode | null =
      resolved.format === 'peer' ? 'builder' :
      resolved.format === 'node' ? 'swarm' :
      null;

    // Auto-switch mode if there's a mismatch
    if (targetMode && targetMode !== currentMode) {
      console.log(`[BootstrapFallback] 🔄 Auto-switching ${currentMode} → ${targetMode}`);
      await switchNetworkMode(targetMode, {
        enable: this.config.enable,
        disable: this.config.disable,
        isOnline: this.config.isOnline(),
      });
      modeSwitched = true;

      // Brief wait for mode switch to settle
      await new Promise(r => setTimeout(r, 500));
    }

    // Determine which ID to use for connection
    const connectId = resolved.format === 'node'
      ? `peer-${resolved.nodeId}` // SWARM mesh expects peer-{nodeId} aliases
      : resolved.peerId ?? rawId.trim();

    const success = this.config.connectPeer(connectId);

    console.log(
      `[BootstrapFallback] ${success ? '✅' : '❌'} Manual connect → ${formatNetworkId(rawId)}`,
      { format: resolved.format, connectId, modeSwitched }
    );

    return { success, resolvedId: connectId, modeSwitched };
  }
}
