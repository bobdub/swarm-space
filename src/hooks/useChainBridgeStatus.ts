import { useEffect, useState } from 'react';
import {
  getChainBridgeStatus,
  subscribeChainBridge,
  type ChainBridgeStatus,
} from '@/lib/blockchain/chainHealthBridge';

/**
 * Subscribe to the chain ↔ UQRC bridge status (smoothed tip pin, last reorg,
 * accept/reject counts). Read-only — no decisions are made here.
 */
export function useChainBridgeStatus(): ChainBridgeStatus {
  const [status, setStatus] = useState<ChainBridgeStatus>(() => getChainBridgeStatus());
  useEffect(() => subscribeChainBridge(setStatus), []);
  return status;
}
