import { useQuery } from "@tanstack/react-query";
import { verifySwarmPublicRpc } from "@/lib/blockchain/wallets/swarmEvmNetwork";

export function useSwarmPublicRpc() {
  return useQuery({
    queryKey: ["swarm-public-rpc"],
    queryFn: async () => { await verifySwarmPublicRpc(); return true; },
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}