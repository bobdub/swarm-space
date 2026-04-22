import { useCallback, useEffect, useState } from "react";
import { getCreditBalance, getPendingCreditDelta } from "@/lib/credits";

export function useCreditBalance(userId: string | null) {
  const [balance, setBalance] = useState<number>(0);
  const [pending, setPending] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const loadBalance = useCallback(async () => {
    if (!userId) return;

    try {
      const [currentBalance, currentPending] = await Promise.all([
        getCreditBalance(userId),
        getPendingCreditDelta(userId),
      ]);
      setBalance(currentBalance);
      setPending(currentPending);
      
      // Check and unlock profile tokens based on credits earned
      const { checkAndUnlockTokenSupply } = await import("@/lib/blockchain/profileTokenUnlock");
      await checkAndUnlockTokenSupply(userId);
    } catch (error) {
      console.error("Failed to load credit balance:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setBalance(0);
      setPending(0);
      setLoading(false);
      return;
    }

    void loadBalance();

    // Refresh on a 30s heartbeat AND on mesh status flips so the
    // "+N pending" chip drains the moment we reconnect.
    const interval = setInterval(() => {
      void loadBalance();
    }, 30_000);

    const onMeshStatus = () => { void loadBalance(); };
    const onCreditTx = () => { void loadBalance(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('credits:mesh-status', onMeshStatus);
      window.addEventListener('credits:transaction', onCreditTx);
    }

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('credits:mesh-status', onMeshStatus);
        window.removeEventListener('credits:transaction', onCreditTx);
      }
    };
  }, [userId, loadBalance]);

  const refresh = useCallback(() => {
    void loadBalance();
  }, [loadBalance]);

  return { balance, pending, loading, refresh };
}
