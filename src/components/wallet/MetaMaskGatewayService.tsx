import { useEffect } from "react";
import { useMetaMask } from "@/hooks/useMetaMask";
import { syncWalletGateway } from "@/lib/blockchain/gateway/walletGatewayLifecycle";

/** App-wide lifecycle, independent of the currently open page. */
export function MetaMaskGatewayService() {
  const { address } = useMetaMask();
  useEffect(() => {
    let cancelled = false;
    void import("@/lib/blockchain/gateway/swarmGatewayCell").then((gateway) => {
      if (!cancelled) syncWalletGateway(address, gateway);
    });
    return () => { cancelled = true; };
  }, [address]);
  return null;
}