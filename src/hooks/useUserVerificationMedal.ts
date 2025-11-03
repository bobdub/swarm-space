import { useEffect, useMemo, useState } from "react";
import type { VerificationMedalRecord } from "@/types/verification";
import { loadMedalHistoryForUser } from "@/lib/verification/repository";
import { selectHighestPriorityMedalRecord } from "@/lib/verification/medals";

interface UseUserVerificationMedalOptions {
  initialRecord?: VerificationMedalRecord | null;
  skip?: boolean;
}

const medalCache = new Map<string, VerificationMedalRecord | null>();

export function useUserVerificationMedal(
  userId?: string | null,
  options?: UseUserVerificationMedalOptions,
) {
  const initialRecord = options?.initialRecord ?? null;
  const skip = options?.skip ?? false;
  const [medal, setMedal] = useState<VerificationMedalRecord | null>(() => {
    if (!userId) {
      return null;
    }
    return initialRecord ?? medalCache.get(userId) ?? null;
  });
  const [loading, setLoading] = useState(false);

  const normalizedUserId = useMemo(() => userId ?? null, [userId]);

  useEffect(() => {
    if (!normalizedUserId) {
      setMedal(null);
      return;
    }

    if (initialRecord) {
      medalCache.set(normalizedUserId, initialRecord);
      setMedal(initialRecord);
    }
  }, [normalizedUserId, initialRecord]);

  useEffect(() => {
    const targetUserId = normalizedUserId;
    if (!targetUserId || skip) {
      return;
    }

    if (medalCache.has(targetUserId)) {
      setMedal(medalCache.get(targetUserId) ?? null);
      return;
    }

    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const history = await loadMedalHistoryForUser(targetUserId);
        const highest = selectHighestPriorityMedalRecord(history);
        medalCache.set(targetUserId, highest);
        if (!cancelled) {
          setMedal(highest ?? null);
        }
      } catch (error) {
        console.warn(`[Verification] Failed to load medal history for ${targetUserId}`, error);
        medalCache.set(targetUserId, null);
        if (!cancelled) {
          setMedal(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [normalizedUserId, skip]);

  return { medal, loading };
}
