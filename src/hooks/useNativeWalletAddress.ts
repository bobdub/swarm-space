import { useEffect, useState } from "react";
import { nativeWalletAddress } from "@/lib/blockchain/wallets/nativeAddress";

export function useNativeWalletAddress(userId: string): string {
  const [resolved, setResolved] = useState({ userId: "", address: "" });
  useEffect(() => {
    let active = true;
    if (userId) {
      void nativeWalletAddress(userId).then(address => {
        if (active) setResolved({ userId, address });
      }).catch(() => {
        if (active) setResolved({ userId, address: "" });
      });
    }
    return () => { active = false; };
  }, [userId]);
  return resolved.userId === userId ? resolved.address : "";
}