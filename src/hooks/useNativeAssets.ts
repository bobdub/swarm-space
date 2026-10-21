import { useEffect, useState } from "react";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { getCreditBalance } from "@/lib/credits";
import { getChainMintmeBalance } from "@/lib/blockchain/deposits/mintmeDeposit";
import { getChainEthBalance } from "@/lib/blockchain/deposits/ethDeposit";
import { CUSTOM_TOKENS_EVENT, getAvailableTokenBalance, getRecordedTokenBalance, hydrateCustomTokens } from "@/lib/blockchain/deposits/customTokens";
import { DEPOSIT_SYNC_EVENT } from "@/lib/blockchain/deposits/depositSync";
import { getUserProfileTokenHoldings } from "@/lib/blockchain/profileTokenBalance";
import { getAppWalletBalances } from "@/lib/blockchain/wallets/appWallet";
import { nativeWalletAssets, type NativeAsset } from "@/lib/blockchain/wallets/nativeAssets";

export function useNativeAssets(userId: string): NativeAsset[] {
  const [snapshot, setSnapshot] = useState<{ userId: string; assets: NativeAsset[] }>({ userId, assets: [] });
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      if (!userId) { setSnapshot({ userId, assets: [] }); return; }
      try {
        const chain = getSwarmChain();
        await chain.whenReady();
        const [credits, tokens, holdings] = await Promise.all([
          getCreditBalance(userId), hydrateCustomTokens(userId), getUserProfileTokenHoldings(userId),
        ]);
        const bridge = getAppWalletBalances(userId);
        const assets = nativeWalletAssets({
          swarm: chain.getBalance(userId), credits, mintme: getChainMintmeBalance(userId),
          eth: bridge.ETH + getChainEthBalance(userId), btc: bridge.BTC, holdings,
          custom: tokens.map((token) => ({ token, amount: getRecordedTokenBalance(userId, token.address), available: getAvailableTokenBalance(userId, token.address) })),
        });
        if (!disposed && current === revision) setSnapshot({ userId, assets });
      } catch { /* Keep last known balances during transient storage failures. */ }
    };
    const events = ["blockchain-transaction", "credit-transaction", "app-wallet-update", "creator-vault-update", "reward-pool-update", CUSTOM_TOKENS_EVENT, DEPOSIT_SYNC_EVENT];
    for (const event of events) window.addEventListener(event, refresh);
    void refresh();
    return () => {
      disposed = true;
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [userId]);
  return snapshot.userId === userId ? snapshot.assets : [];
}