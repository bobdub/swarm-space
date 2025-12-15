// UQRC-Compatible Mining Optimizations
// Curvature reduction in the mining manifold while preserving PoW security
// [D_μ, D_ν] → 0 through non-consensus layer improvements

import { SwarmBlock, SwarmTransaction } from "./types";
import { calculateHash } from "./crypto";

/**
 * Mining configuration for curvature reduction
 * These parameters tune the non-consensus layer optimizations
 */
export interface MiningOptimizationConfig {
  // Template stabilization window (ms) - reduces [D_mempool, D_hash] curvature
  templateFreezeWindow: number;
  
  // Nonce partition count - eliminates redundant work across miners
  noncePartitions: number;
  
  // Minimum peer quorum for propagation-aware broadcast
  propagationQuorum: number;
  
  // Timestamp smoothing enabled - reduces difficulty oscillation
  enableTimestampSmoothing: boolean;
  
  // Maximum timestamp drift allowed (seconds)
  maxTimestampDrift: number;
}

export const DEFAULT_MINING_CONFIG: MiningOptimizationConfig = {
  templateFreezeWindow: 750, // 750ms template freeze
  noncePartitions: 256, // 256 nonce partitions
  propagationQuorum: 2, // Wait for 2 peers minimum
  enableTimestampSmoothing: true,
  maxTimestampDrift: 60, // 60 second max drift
};

/**
 * 4.1 Deterministic Template Stabilization
 * Freezes block template for a window to reduce mempool update advantage
 * UQRC: [D_mempool, D_hash] → 0
 */
export class TemplateStabilizer {
  private frozenTemplate: SwarmTransaction[] | null = null;
  private freezeTimestamp: number = 0;
  private config: MiningOptimizationConfig;

  constructor(config: MiningOptimizationConfig = DEFAULT_MINING_CONFIG) {
    this.config = config;
  }

  /**
   * Get stabilized transaction template
   * Returns frozen template if within window, otherwise updates and freezes
   */
  getStabilizedTemplate(pendingTransactions: SwarmTransaction[]): SwarmTransaction[] {
    const now = Date.now();
    
    // Check if current freeze window is still valid
    if (this.frozenTemplate && (now - this.freezeTimestamp) < this.config.templateFreezeWindow) {
      return [...this.frozenTemplate];
    }
    
    // Freeze new template
    this.frozenTemplate = [...pendingTransactions];
    this.freezeTimestamp = now;
    
    return [...this.frozenTemplate];
  }

  /**
   * Force template refresh (e.g., after successful block)
   */
  invalidateTemplate(): void {
    this.frozenTemplate = null;
    this.freezeTimestamp = 0;
  }

  /**
   * Get remaining freeze time
   */
  getRemainingFreezeTime(): number {
    if (!this.frozenTemplate) return 0;
    const elapsed = Date.now() - this.freezeTimestamp;
    return Math.max(0, this.config.templateFreezeWindow - elapsed);
  }
}

/**
 * 4.2 Nonce-Space Partitioning
 * Deterministically partitions nonce space using miner identifier
 * Eliminates redundant hashing: F_μν^hash = 0 with reduced overlap
 */
export class NoncePartitioner {
  private config: MiningOptimizationConfig;

  constructor(config: MiningOptimizationConfig = DEFAULT_MINING_CONFIG) {
    this.config = config;
  }

  /**
   * Calculate nonce range for a specific miner
   * n ∈ Ω_i = H(MinerID) mod N
   */
  async getNonceRange(minerId: string): Promise<{ start: number; end: number; partition: number }> {
    // Hash the miner ID to get deterministic partition
    const encoder = new TextEncoder();
    const data = encoder.encode(minerId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    
    // Use first 4 bytes as partition selector
    const partitionIndex = (hashArray[0] << 24 | hashArray[1] << 16 | hashArray[2] << 8 | hashArray[3]) >>> 0;
    const partition = partitionIndex % this.config.noncePartitions;
    
    // Calculate nonce range for this partition
    // Using 32-bit nonce space (4,294,967,296 values)
    const maxNonce = 0xFFFFFFFF;
    const rangeSize = Math.floor(maxNonce / this.config.noncePartitions);
    
    const start = partition * rangeSize;
    const end = (partition === this.config.noncePartitions - 1) 
      ? maxNonce 
      : (partition + 1) * rangeSize - 1;
    
    return { start, end, partition };
  }

  /**
   * Check if a nonce is within the miner's allocated range
   */
  async isNonceInRange(minerId: string, nonce: number): Promise<boolean> {
    const range = await this.getNonceRange(minerId);
    return nonce >= range.start && nonce <= range.end;
  }
}

/**
 * 4.3 Propagation-Aware Mining
 * Delays block broadcast until peer quorum is reached
 * Reduces orphan rate through curvature reduction in network manifold
 */
export class PropagationAwareBroadcaster {
  private config: MiningOptimizationConfig;
  private pendingBlocks: Map<string, { block: SwarmBlock; timestamp: number }> = new Map();
  private connectedPeers: Set<string> = new Set();

  constructor(config: MiningOptimizationConfig = DEFAULT_MINING_CONFIG) {
    this.config = config;
  }

  /**
   * Update connected peer count
   */
  updatePeerCount(peerIds: string[]): void {
    this.connectedPeers = new Set(peerIds);
  }

  /**
   * Check if quorum is reached for broadcast
   */
  hasQuorum(): boolean {
    return this.connectedPeers.size >= this.config.propagationQuorum;
  }

  /**
   * Queue block for propagation-aware broadcast
   * Returns true if block should be broadcast immediately
   */
  queueBlock(block: SwarmBlock): { shouldBroadcast: boolean; reason: string } {
    if (this.hasQuorum()) {
      return { 
        shouldBroadcast: true, 
        reason: `Quorum reached (${this.connectedPeers.size}/${this.config.propagationQuorum} peers)` 
      };
    }

    // Queue block for delayed broadcast
    this.pendingBlocks.set(block.hash, { block, timestamp: Date.now() });
    
    return { 
      shouldBroadcast: false, 
      reason: `Waiting for quorum (${this.connectedPeers.size}/${this.config.propagationQuorum} peers)` 
    };
  }

  /**
   * Get blocks ready for broadcast (quorum now available or timeout)
   */
  getReadyBlocks(maxAge: number = 5000): SwarmBlock[] {
    const now = Date.now();
    const ready: SwarmBlock[] = [];

    this.pendingBlocks.forEach((entry, hash) => {
      if (this.hasQuorum() || (now - entry.timestamp) > maxAge) {
        ready.push(entry.block);
        this.pendingBlocks.delete(hash);
      }
    });

    return ready;
  }

  /**
   * Get current peer count
   */
  getPeerCount(): number {
    return this.connectedPeers.size;
  }
}

/**
 * 4.4 Timestamp Smoothing
 * Enforces monotonic timestamps within bounds to reduce difficulty oscillation
 */
export class TimestampSmoother {
  private config: MiningOptimizationConfig;
  private lastTimestamp: number = 0;

  constructor(config: MiningOptimizationConfig = DEFAULT_MINING_CONFIG) {
    this.config = config;
  }

  /**
   * Get smoothed timestamp for new block
   * Ensures monotonic progression within allowed bounds
   */
  getSmoothedTimestamp(previousBlockTimestamp: string): string {
    if (!this.config.enableTimestampSmoothing) {
      return new Date().toISOString();
    }

    const now = Date.now();
    const prevTime = new Date(previousBlockTimestamp).getTime();
    
    // Ensure strictly greater than previous block
    const minTimestamp = prevTime + 1;
    
    // Apply max drift constraint
    const maxTimestamp = now + (this.config.maxTimestampDrift * 1000);
    
    // Use current time, but clamp within bounds
    let targetTimestamp = Math.max(now, minTimestamp);
    targetTimestamp = Math.min(targetTimestamp, maxTimestamp);
    
    // Ensure monotonic from our last issued timestamp
    if (this.lastTimestamp >= targetTimestamp) {
      targetTimestamp = this.lastTimestamp + 1;
    }
    
    this.lastTimestamp = targetTimestamp;
    return new Date(targetTimestamp).toISOString();
  }

  /**
   * Validate a timestamp from another miner
   */
  isValidTimestamp(timestamp: string, previousBlockTimestamp: string): { valid: boolean; reason?: string } {
    const time = new Date(timestamp).getTime();
    const prevTime = new Date(previousBlockTimestamp).getTime();
    const now = Date.now();

    if (time <= prevTime) {
      return { valid: false, reason: "Timestamp not greater than previous block" };
    }

    const futureDrift = time - now;
    if (futureDrift > this.config.maxTimestampDrift * 1000) {
      return { valid: false, reason: `Timestamp too far in future (${futureDrift}ms)` };
    }

    return { valid: true };
  }
}

/**
 * Optimized Mining Engine
 * Combines all curvature-reduction optimizations into a single mining interface
 */
export class OptimizedMiningEngine {
  private templateStabilizer: TemplateStabilizer;
  private noncePartitioner: NoncePartitioner;
  private propagationBroadcaster: PropagationAwareBroadcaster;
  private timestampSmoother: TimestampSmoother;
  private config: MiningOptimizationConfig;

  constructor(config: MiningOptimizationConfig = DEFAULT_MINING_CONFIG) {
    this.config = config;
    this.templateStabilizer = new TemplateStabilizer(config);
    this.noncePartitioner = new NoncePartitioner(config);
    this.propagationBroadcaster = new PropagationAwareBroadcaster(config);
    this.timestampSmoother = new TimestampSmoother(config);
  }

  /**
   * Mine a block with all curvature-reduction optimizations applied
   */
  async mineOptimized(
    block: SwarmBlock,
    minerId: string,
    previousBlockTimestamp: string,
    yieldInterval: number = 1000
  ): Promise<SwarmBlock> {
    // Apply timestamp smoothing
    block.timestamp = this.timestampSmoother.getSmoothedTimestamp(previousBlockTimestamp);
    
    // Get partitioned nonce range
    const nonceRange = await this.noncePartitioner.getNonceRange(minerId);
    block.nonce = nonceRange.start;
    
    const target = "0".repeat(block.difficulty);
    
    // Mine within our partition
    while (block.nonce <= nonceRange.end) {
      block.hash = await calculateHash(block);
      
      if (block.hash.substring(0, block.difficulty) === target) {
        // Block mined successfully
        return block;
      }
      
      block.nonce++;
      
      // Yield to prevent browser freeze
      if ((block.nonce - nonceRange.start) % yieldInterval === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    // Exhausted our partition without finding a block
    // In a real network, another miner likely found it
    throw new Error("Nonce partition exhausted without finding valid block");
  }

  /**
   * Get stabilized transaction template
   */
  getTemplate(pendingTransactions: SwarmTransaction[]): SwarmTransaction[] {
    return this.templateStabilizer.getStabilizedTemplate(pendingTransactions);
  }

  /**
   * Invalidate current template (after successful block)
   */
  invalidateTemplate(): void {
    this.templateStabilizer.invalidateTemplate();
  }

  /**
   * Update peer connections for propagation awareness
   */
  updatePeers(peerIds: string[]): void {
    this.propagationBroadcaster.updatePeerCount(peerIds);
  }

  /**
   * Check if block should be broadcast
   */
  shouldBroadcast(block: SwarmBlock): { shouldBroadcast: boolean; reason: string } {
    return this.propagationBroadcaster.queueBlock(block);
  }

  /**
   * Get UQRC curvature metrics
   * Returns quantum score for current mining state
   */
  getCurvatureMetrics(): {
    templateCurvature: number;
    nonceCurvature: number;
    propagationCurvature: number;
    timestampCurvature: number;
    totalQScore: number;
  } {
    const templateFreezeRemaining = this.templateStabilizer.getRemainingFreezeTime();
    const peerCount = this.propagationBroadcaster.getPeerCount();
    const hasQuorum = this.propagationBroadcaster.hasQuorum();
    
    // Curvature calculations (lower is better, 0 is flat)
    // Template curvature: high when template is unfrozen (updates can cause advantage)
    const templateCurvature = templateFreezeRemaining > 0 ? 0 : 1;
    
    // Nonce curvature: always 0 due to partitioning (no overlap)
    const nonceCurvature = 0;
    
    // Propagation curvature: based on peer quorum status
    const propagationCurvature = hasQuorum ? 0 : (this.config.propagationQuorum - peerCount) / this.config.propagationQuorum;
    
    // Timestamp curvature: 0 when smoothing enabled
    const timestampCurvature = this.config.enableTimestampSmoothing ? 0 : 0.5;
    
    // Total Q_Score following UQRC: Q_Score(u) := ||[D_μ, D_ν]|| + ||∇_μ ∇_ν S(u)|| + λ(ε_0)
    const lambda = 1e-100; // λ(ε_0) as defined in UQRC
    const totalQScore = templateCurvature + nonceCurvature + propagationCurvature + timestampCurvature + lambda;
    
    return {
      templateCurvature,
      nonceCurvature,
      propagationCurvature,
      timestampCurvature,
      totalQScore,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): MiningOptimizationConfig {
    return { ...this.config };
  }
}

// Singleton instance
let optimizedMiningEngine: OptimizedMiningEngine | null = null;

export function getOptimizedMiningEngine(config?: MiningOptimizationConfig): OptimizedMiningEngine {
  if (!optimizedMiningEngine) {
    optimizedMiningEngine = new OptimizedMiningEngine(config);
  }
  return optimizedMiningEngine;
}
