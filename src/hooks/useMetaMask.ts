import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { addSwarmNetworkToMetaMask } from "@/lib/blockchain/wallets/swarmEvmNetwork";
import {
  connectMetaMask,
  getMetaMaskAccount,
  getMetaMaskChainId,
  isMetaMaskAvailable,
  onMetaMaskChange,
} from "@/lib/blockchain/wallets/metaMaskBridge";

const CACHE_KEY = "swarm.metaMask.cache.v1";
const SESSION_EVENT = "swarm:metamask-session";

interface Cache {
  address: string | null;
  chainId: string | null;
}

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { address: null, chainId: null };
    const parsed = JSON.parse(raw);
    return { address: parsed?.address ?? null, chainId: parsed?.chainId ?? null };
  } catch {
    return { address: null, chainId: null };
  }
}

function writeCache(c: Cache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<Cache>(SESSION_EVENT, { detail: c }));
}

export interface MetaMaskState {
  available: boolean;
  address: string | null;
  chainId: string | null;
  busy: boolean;
  connect: (options?: { addSwarmNetwork?: boolean }) => Promise<void>;
  disconnect: () => void;
}

export function useMetaMask(): MetaMaskState {
  const available = typeof window !== "undefined" && isMetaMaskAvailable();
  // Remembered accounts are not proof of a live external wallet connection.
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [acct, chain] = await Promise.all([getMetaMaskAccount(), getMetaMaskChainId()]);
    setAddress(acct);
    setChainId(chain);
    writeCache({ address: acct, chainId: chain });
  }, []);

  useEffect(() => {
    if (!available) return;
    void refresh();
  }, [available, refresh]);

  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<Cache>).detail;
      setAddress(next.address);
      setChainId(next.chainId);
    };
    window.addEventListener(SESSION_EVENT, update);
    return () => window.removeEventListener(SESSION_EVENT, update);
  }, []);

  useEffect(() => {
    if (!available) return;
    return onMetaMaskChange(refresh);
  }, [available, address, refresh]);

  const connect = useCallback(async (options?: { addSwarmNetwork?: boolean }) => {
    if (!available) return;
    setBusy(true);
    try {
      const conn = await connectMetaMask();
      if (conn) {
        setAddress(conn.address);
        setChainId(conn.chainId);
        writeCache({ address: conn.address, chainId: conn.chainId });
        if (options?.addSwarmNetwork) {
          try {
            await addSwarmNetworkToMetaMask();
            await refresh();
            toast.success("Swarm-Space network added to MetaMask");
          } catch (err) {
            const code = (err as { code?: number })?.code;
            toast.error(code === 4001 ? "SWARM network addition declined" : "Connected, but SWARM network was not added", {
              description: code === 4001
                ? "You can try again from the wallet menu."
                : "MetaMask must reach a working SWARM network address to add it. Try Add Swarm-Space from the wallet menu.",
            });
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }, [available, refresh]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    writeCache({ address: null, chainId: null });
  }, []);

  return { available, address, chainId, busy, connect, disconnect };
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function chainLabel(chainId: string | null | undefined): string {
  if (!chainId) return "Unknown chain";
  switch (chainId) {
    case "0x1": return "Ethereum";
    case "0xaa36a7": return "Sepolia";
    case "0x89": return "Polygon";
    case "0x38": return "BNB";
    case "0x123fb": return "Swarm-Space";
    default: return `Chain ${chainId}`;
  }
}