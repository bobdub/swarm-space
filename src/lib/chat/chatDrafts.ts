import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Unsent composer text, kept in memory per chat so a half-typed message
 * survives the chat window being docked, switched away from, or remounted.
 * Never persisted: a reload starts with empty composers.
 */
const drafts = new Map<string, string>();

export function getChatDraft(key: string | null | undefined): string {
  return key ? drafts.get(key) ?? '' : '';
}

export function setChatDraft(key: string | null | undefined, text: string): void {
  if (!key) return;
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}

/** `useState('')` for a composer, backed by the draft for `key` (none when `key` is empty). */
export function useChatDraft(key: string | null | undefined): [string, Dispatch<SetStateAction<string>>] {
  const [text, setTextState] = useState(() => getChatDraft(key));
  // A different chat in the same component starts from its own draft.
  useEffect(() => { setTextState(getChatDraft(key)); }, [key]);
  const setText = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setTextState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      setChatDraft(key, value);
      return value;
    });
  }, [key]);
  return [text, setText];
}
