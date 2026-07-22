import { useCallback, useEffect, useState } from "react";
import {
  connectMetaMask,
  getMetaMaskAccount,
  getMetaMaskChainId,
  isMetaMaskAvailable,
  onMetaMaskChange,
} from "@/lib/blockchain/wallets/metaMaskBridge";

const CACHE_KEY = "swarm.metaMask.cache.v1";

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
}

export interface MetaMaskState {
  available: boolean;
  address: string | null;
  chainId: string | null;
  busy: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useMetaMask(): MetaMaskState {
  const available = typeof window !== "undefined" && isMetaMaskAvailable();
  const cached = typeof window !== "undefined" ? readCache() : { address: null, chainId: null };
  const [address, setAddress] = useState<string | null>(cached.address);
  const [chainId, setChainId] = useState<string | null>(cached.chainId);
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
    return onMetaMaskChange(refresh);
  }, [available, refresh]);

  const connect = useCallback(async () => {
    if (!available) return;
    setBusy(true);
    try {
      const conn = await connectMetaMask();
      if (conn) {
        setAddress(conn.address);
        setChainId(conn.chainId);
        writeCache({ address: conn.address, chainId: conn.chainId });
      }
    } finally {
      setBusy(false);
    }
  }, [available]);

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
    default: return `Chain ${chainId}`;
  }
}