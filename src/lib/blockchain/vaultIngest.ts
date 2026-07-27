/**
 * vaultIngest — thin adapter. Observes MediaCustody events and funnels
 * each into the single writer (`enrollContent`) so the 500 MiB Media
 * Coin pipeline is the ONLY thing allocating vault storage.
 */
import { onMediaCustody } from "./mediaCoin.bus";
import type { SwarmCoin } from "./types";
import { enrollContent } from "./vaultEnroll";
import { isVaultsEnabled } from "./vaultConfig";

export type CoinProvider = () => Promise<SwarmCoin[]>;
export type LengthProvider = (pieceHash: string) => Promise<number>;

let started = false;
let unsub: (() => void) | null = null;

export function startVaultIngest(
  _getWalletCoins: CoinProvider,
  getPieceLength?: LengthProvider,
): () => void {
  if (started) return () => {};
  started = true;
  unsub = onMediaCustody(async (evt) => {
    if (!isVaultsEnabled()) return;
    try {
      const length = getPieceLength ? await getPieceLength(evt.pieceHash) : 0;
      await enrollContent({
        contentHash: evt.pieceHash,
        ownerPeerId: evt.ownerId,
        isSelf: false,
        name: evt.pieceHash,
        mime: "application/octet-stream",
        size: length,
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