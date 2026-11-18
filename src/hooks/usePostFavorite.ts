import { useCallback, useEffect, useState } from "react";
import {
  FAVORITES_EVENT,
  isPostFavorited,
  setPostFavorited,
} from "@/lib/p2p/contentLifecycle";

/**
 * This device's favorite flag for a post. A favorited post never fades out
 * here when its author goes quiet; the author's own deletion still removes it.
 */
export function usePostFavorite(postId: string) {
  const [favorited, setFavorited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isPostFavorited(postId).then((value) => {
      if (!cancelled) setFavorited(value);
    });
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string; favorited?: boolean }>).detail;
      if (detail?.postId === postId) setFavorited(Boolean(detail.favorited));
    };
    window.addEventListener(FAVORITES_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(FAVORITES_EVENT, onChange);
    };
  }, [postId]);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      const next = !favorited;
      await setPostFavorited(postId, next);
      setFavorited(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, [favorited, postId]);

  return { favorited, busy, toggle };
}
