/**
 * Coin port — fan-in for cross-scaffolding signals that influence coin
 * fill (world labour, media custody). The real coin math still lives in
 * coinFill.ts / coinFillScheduler.ts; this file is the bridge only.
 */
import { emitScaffold, subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type { CoinFillEvent, ScaffoldHandler } from '@/lib/uqrc/scaffoldPorts';
import { onWorldMutation } from '@/lib/world/world.bus';
import { onMediaCustody } from './mediaCoin.bus';

export function emitCoinFill(evt: Omit<CoinFillEvent, 'domain' | 'type'>): void {
  emitScaffold({ domain: 'coin', type: 'fill', ...evt });
}

export function onCoinFill(fn: ScaffoldHandler<CoinFillEvent>): () => void {
  return subscribeScaffold<CoinFillEvent>('coin', fn);
}

let booted = false;
export function bootCoinBusBridges(): void {
  if (booted) return;
  booted = true;
  onWorldMutation((evt) => {
    if (evt.effectiveCut <= 0) return;
    emitCoinFill({
      coinId: `labour:${evt.actorId}`,
      ownerId: evt.actorId,
      delta: Math.min(1, evt.laborWeight * 0.05),
    });
  });
  onMediaCustody((evt) => {
    emitCoinFill({
      coinId: evt.coinId,
      ownerId: evt.ownerId,
      delta: 0.02,
    });
  });
}