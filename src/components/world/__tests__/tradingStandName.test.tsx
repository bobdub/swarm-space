/**
 * The builder's name on the Trading Stand sign: the stamped name first,
 * else the builder's profile name from this device's user records.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@react-three/drei', () => ({ Text: () => null }));
vi.mock('@/lib/store', () => ({
  get: async (_store: string, id: string) => (id === 'peer' ? { displayName: 'Peer Name', username: 'peer1' } : undefined),
}));

import { useBuilderName } from '@/components/world/TradingStandView';

describe("Trading Stand sign name", () => {
  it('uses the name stamped on the stand', () => {
    const { result } = renderHook(() => useBuilderName('  bobdub  ', 'peer'));
    expect(result.current).toBe('bobdub');
  });

  it("looks up the builder's profile name when the stand carries none", async () => {
    const { result } = renderHook(() => useBuilderName(undefined, 'peer'));
    await waitFor(() => expect(result.current).toBe('Peer Name'));
  });

  it('shows no name for an unknown builder', async () => {
    const { result } = renderHook(() => useBuilderName(undefined, 'nobody'));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeUndefined();
  });
});
