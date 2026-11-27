import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatDraft } from '../chatDrafts';

describe('useChatDraft', () => {
  it('keeps unsent text when the composer remounts (e.g. chat docked and restored)', () => {
    const first = renderHook(() => useChatDraft('room:test'));
    act(() => first.result.current[1]('half a thought'));
    first.unmount();
    const again = renderHook(() => useChatDraft('room:test'));
    expect(again.result.current[0]).toBe('half a thought');
    act(() => again.result.current[1](''));
    again.unmount();
    expect(renderHook(() => useChatDraft('room:test')).result.current[0]).toBe('');
  });
});
