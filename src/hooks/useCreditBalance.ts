import { useState, useEffect } from "react";
import { getCreditBalance } from "@/lib/credits";

export function useCreditBalance(userId: string | null) {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setBalance(0);
      setLoading(false);
      return;
    }

    loadBalance();

    // Set up interval to refresh balance every 5 seconds
    const interval = setInterval(loadBalance, 5000);

    return () => clearInterval(interval);
  }, [userId]);

  const loadBalance = async () => {
    if (!userId) return;
    
    try {
      const currentBalance = await getCreditBalance(userId);
      setBalance(currentBalance);
    } catch (error) {
      console.error("Failed to load credit balance:", error);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    loadBalance();
  };

  return { balance, loading, refresh };
}
