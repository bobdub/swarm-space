import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkProtocol } from '../chunkProtocol';
import { _resetResistanceWeightsForTests, getResistanceWeights } from '../synapticDispatch';

afterEach(() => {
  vi.useRealTimers();
  _resetResistanceWeightsForTests();
});

describe('ChunkProtocol teaches the dispatch weights', () => {
  it('learns from a manifest ask that times out', async () => {
    vi.useFakeTimers();
    _resetResistanceWeightsForTests();
    const proto = new ChunkProtocol(() => true);
    const pending = proto.requestManifest('peer-slow', 'manifest-1');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toBeNull();
    expect(getResistanceWeights().samples).toBe(1);
  });

  it('learns from a chunk ask that times out', async () => {
    vi.useFakeTimers();
    _resetResistanceWeightsForTests();
    const proto = new ChunkProtocol(() => true);
    const pending = proto.requestChunk('peer-slow', 'chunk-1');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toBeNull();
    expect(getResistanceWeights().samples).toBe(1);
  });

  it('learns once when a bad manifest reply is followed by the timeout', async () => {
    vi.useFakeTimers();
    _resetResistanceWeightsForTests();
    let requestId = '';
    const proto = new ChunkProtocol((_peer, msg) => { requestId = msg.requestId; return true; });
    const pending = proto.requestManifest('peer-bad', 'manifest-1');
    const callbacks = (proto as unknown as { manifestCallbacks: Map<string, (m: null) => void> }).manifestCallbacks;
    callbacks.get(requestId)?.(null);
    callbacks.get(requestId)?.(null);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await pending).toBeNull();
    expect(getResistanceWeights().samples).toBe(1);
  });

  it('does not learn when the ask could not be sent', async () => {
    _resetResistanceWeightsForTests();
    const proto = new ChunkProtocol(() => false);
    expect(await proto.requestChunk('peer-gone', 'chunk-1')).toBeNull();
    expect(getResistanceWeights().samples).toBe(0);
  });
});
