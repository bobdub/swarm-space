/**
 * Media-Coin port — emits custody events as encrypted pieces are
 * reassembled, so other scaffoldings (coin fill, brain memory pinning)
 * can react via the shared bus.
 */
import { emitScaffold, subscribeScaffold } from '@/lib/uqrc/scaffoldBus';
import type { MediaCustodyEvent, ScaffoldHandler } from '@/lib/uqrc/scaffoldPorts';

export function emitMediaCustody(evt: Omit<MediaCustodyEvent, 'domain' | 'type'>): void {
  emitScaffold({ domain: 'media', type: 'custody', ...evt });
}

export function onMediaCustody(fn: ScaffoldHandler<MediaCustodyEvent>): () => void {
  return subscribeScaffold<MediaCustodyEvent>('media', fn);
}