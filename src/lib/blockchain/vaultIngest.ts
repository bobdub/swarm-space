/**
 * vaultIngest — observes MediaCustody events and writes verified media
 * into the source peer's Sync Vault. Never mutates transport code.
 */
import { onMediaCustody } from "./mediaCoin.bus";
import type { SwarmCoin } from "./types";
import { getOrRolloverReceiverCoin, recordVaultEntry } from "./syncVault";
import { isVaultsEnabled } from "./vaultConfig";

export type CoinProvider = () => Promise<SwarmCoin[]>;
export type LengthProvider = (pieceHash: string) => Promise<number>;

let started = false;
let unsub: (() => void) | null = null;

export function startVaultIngest(
  getWalletCoins: CoinProvider,
  getPieceLength?: LengthProvider,
): () => void {
  if (started) return () => {};
  started = true;
  unsub = onMediaCustody(async (evt) => {
    if (!isVaultsEnabled()) return;
    try {
      const coins = await getWalletCoins();
      const ref = await getOrRolloverReceiverCoin(evt.ownerId, coins);
      if (!ref) return;
      const length = getPieceLength ? await getPieceLength(evt.pieceHash) : 0;
      await recordVaultEntry(evt.ownerId, evt.pieceHash, {
        coinId: ref.coinId,
        offset: ref.fillBytes,
        length,
        ref: evt.pieceHash,
      });
    } catch (err) {
      console.warn("[vaultIngest] ignored", err);
    }
  });
  return stopVaultIngest;
}

export function stopVaultIngest(): void {
  if (unsub) unsub();
  unsub = null;
  started = false;
}