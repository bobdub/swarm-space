import { useEffect } from "react";
import { startWalletTipSync } from "@/lib/blockchain/wallets/walletTips";

export function WalletTipService() {
  useEffect(() => startWalletTipSync(), []);
  return null;
}