/**
 * Cascade Distribution Protocol
 *
 * Trust-ordered relay chain for media coins. The creator sends the coin
 * to their most-trusted peer, who forwards it to the next, forming a
 * custody chain that loops back or exhausts trusted peers.
 */

import type { SwarmCoin } from '../blockchain/types';
import { getTopQualityPeers } from './connectionQuality';

// ── Types ────────────────────────────────────────────────────────────────

export interface CascadeState {
  coinId: string;
  custodyChain: string[];
  startedAt: string;
  completedAt?: string;
  originPeerId: string;
}

export interface CascadeOffer {
  type: 'coin_cascade_offer';
  coinId: string;
  coin: SwarmCoin;
  custodyChain: string[];
  originPeerId: string;
}

export interface CascadeAccept {
  type: 'coin_cascade_accept';
  coinId: string;
  acceptedBy: string;
}

export interface CascadeForward {
  type: 'coin_cascade_forward';
  coinId: string;
  coin: SwarmCoin;
  custodyChain: string[];
  originPeerId: string;
}

export type CascadeMessage = CascadeOffer | CascadeAccept | CascadeForward;

export function isCascadeMessage(payload: unknown): payload is CascadeMessage {
  if (!payload || typeof payload !== 'object') return false;
  const type = (payload as any).type;
  return (
    type === 'coin_cascade_offer' ||
    type === 'coin_cascade_accept' ||
    type === 'coin_cascade_forward'
  );
}

// ── Protocol ─────────────────────────────────────────────────────────────

type SendFn = (peerId: string, type: string, payload: unknown) => boolean;
type OnCoinReceived = (coin: SwarmCoin, cascadeState: CascadeState) => void;

export class CascadeDistributor {
  private activeCascades = new Map<string, CascadeState>();
  private receivedCoins = new Set<string>();
  private sendMessage: SendFn;
  private localPeerId: string;
  private onCoinReceived: OnCoinReceived;
  private getConnectedPeers: () => string[];

  constructor(
    localPeerId: string,
    sendMessage: SendFn,
    getConnectedPeers: () => string[],
    onCoinReceived: OnCoinReceived
  ) {
    this.localPeerId = localPeerId;
    this.sendMessage = sendMessage;
    this.getConnectedPeers = getConnectedPeers;
    this.onCoinReceived = onCoinReceived;
  }

  /**
   * Initiate a cascade for a media coin. Sends to the most-trusted connected peer.
   */
  startCascade(coin: SwarmCoin): CascadeState | null {
    if (!coin.mediaPieces || coin.mediaPieces.length === 0) {
      console.warn('[Cascade] Cannot cascade coin without media pieces');
      return null;
    }

    const state: CascadeState = {
      coinId: coin.coinId,
      custodyChain: [this.localPeerId],
      startedAt: new Date().toISOString(),
      originPeerId: this.localPeerId,
    };

    this.activeCascades.set(coin.coinId, state);

    const nextPeer = this.selectNextPeer(state.custodyChain);
    if (!nextPeer) {
      state.completedAt = new Date().toISOString();
      console.log(`[Cascade] No trusted peers available for coin ${coin.coinId}`);
      return state;
    }

    const offer: CascadeOffer = {
      type: 'coin_cascade_offer',
      coinId: coin.coinId,
      coin,
      custodyChain: [...state.custodyChain],
      originPeerId: this.localPeerId,
    };

    this.sendMessage(nextPeer, 'cascade', offer);
    console.log(`[Cascade] Started cascade for coin ${coin.coinId} → ${nextPeer}`);
    return state;
  }

  /**
   * Handle incoming cascade messages.
   */
  handleMessage(peerId: string, message: CascadeMessage): void {
    switch (message.type) {
      case 'coin_cascade_offer':
      case 'coin_cascade_forward':
        this.handleIncomingCoin(peerId, message);
        break;
      case 'coin_cascade_accept':
        this.handleAccept(peerId, message);
        break;
    }
  }

  getActiveCascades(): CascadeState[] {
    return Array.from(this.activeCascades.values());
  }

  getCascade(coinId: string): CascadeState | undefined {
    return this.activeCascades.get(coinId);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private handleIncomingCoin(
    peerId: string,
    message: CascadeOffer | CascadeForward
  ): void {
    const { coinId, coin, custodyChain, originPeerId } = message;

    // Deduplicate
    if (this.receivedCoins.has(coinId)) {
      console.log(`[Cascade] Already received coin ${coinId}, skipping`);
      return;
    }

    this.receivedCoins.add(coinId);

    // Send accept back
    const accept: CascadeAccept = {
      type: 'coin_cascade_accept',
      coinId,
      acceptedBy: this.localPeerId,
    };
    this.sendMessage(peerId, 'cascade', accept);

    // Update custody chain
    const updatedChain = [...custodyChain, this.localPeerId];

    const state: CascadeState = {
      coinId,
      custodyChain: updatedChain,
      startedAt: new Date().toISOString(),
      originPeerId,
    };
    this.activeCascades.set(coinId, state);

    // Notify receiver
    this.onCoinReceived(coin, state);

    // Forward to next trusted peer
    const nextPeer = this.selectNextPeer(updatedChain);
    if (nextPeer) {
      const forward: CascadeForward = {
        type: 'coin_cascade_forward',
        coinId,
        coin,
        custodyChain: updatedChain,
        originPeerId,
      };
      this.sendMessage(nextPeer, 'cascade', forward);
      console.log(`[Cascade] Forwarded coin ${coinId} → ${nextPeer} (hop ${updatedChain.length})`);
    } else {
      state.completedAt = new Date().toISOString();
      console.log(`[Cascade] Chain complete for coin ${coinId} after ${updatedChain.length} hops`);
    }
  }

  private handleAccept(_peerId: string, message: CascadeAccept): void {
    const state = this.activeCascades.get(message.coinId);
    if (state && !state.custodyChain.includes(message.acceptedBy)) {
      state.custodyChain.push(message.acceptedBy);
    }
  }

  /**
   * Select the next peer to forward to — highest trust, not already in the chain.
   */
  private selectNextPeer(custodyChain: string[]): string | null {
    const excludeSet = new Set(custodyChain);
    const connected = this.getConnectedPeers();
    const rankedPeers = getTopQualityPeers(20);

    // Filter to connected peers not in the chain, ordered by trust
    for (const ranked of rankedPeers) {
      const id = typeof ranked === 'string' ? ranked : ranked.peerId;
      if (!excludeSet.has(id) && connected.includes(id)) {
        return id;
      }
    }

    // Fallback: any connected peer not in chain
    for (const peer of connected) {
      if (!excludeSet.has(peer)) {
        return peer;
      }
    }

    return null;
  }
}
