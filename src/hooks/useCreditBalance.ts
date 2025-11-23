import { useCallback, useEffect, useState } from "react";
import { getCreditBalance } from "@/lib/credits";

export function useCreditBalance(userId: string | null) {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const loadBalance = useCallback(async () => {
    if (!userId) return;

    try {
      const currentBalance = await getCreditBalance(userId);
      setBalance(currentBalance);
      
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
      setLoading(false);
      return;
    }

    void loadBalance();

    // Set up interval to refresh balance every 5 seconds
    const interval = setInterval(() => {
      void loadBalance();
    }, 5000);

    return () => clearInterval(interval);
  }, [userId, loadBalance]);

  const refresh = useCallback(() => {
    void loadBalance();
  }, [loadBalance]);

  return { balance, loading, refresh };
}
