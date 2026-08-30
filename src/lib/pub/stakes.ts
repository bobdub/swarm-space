/**
 * stakes — the thinnest possible SWARM layer for pub games.
 *
 * Two ledger writes per player per session, never one per action:
 *   • buy-in  → transferSwarm(player → table escrow)
 *   • settle  → transferSwarm(escrow → winner)
 *
 * In-game chips/scores stay plain numbers inside the table state. Free
 * play (stake === 0) never touches the ledger at all.
 */

import { getSwarmBalance, transferSwarm } from '@/lib/blockchain/token';

/** Deterministic escrow address so every peer names the same pot. */
export function escrowAddress(tableId: string): string {
  return `pub-escrow:${tableId}`;
}

/** Where drink money goes — a house sink, not another player's balance. */
export const BAR_SINK_ADDRESS = 'pub-bar-sink';

export async function canAfford(peerId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  try {
    return (await getSwarmBalance(peerId)) >= amount;
  } catch {
    return false;
  }
}

/** Debit one seat's buy-in into the table escrow. Throws when short. */
export async function payBuyIn(params: {
  tableId: string;
  peerId: string;
  amount: number;
}): Promise<void> {
  const { tableId, peerId, amount } = params;
  if (!(amount > 0)) return;
  await transferSwarm({
    from: peerId,
    to: escrowAddress(tableId),
    amount,
    meta: { kind: 'pub_buyin', tableId },
  });
}

/** Pay the whole pot to the winner. Host-only; called once per leg. */
export async function settleEscrow(params: {
  tableId: string;
  winnerPeerId: string;
  pot: number;
}): Promise<void> {
  const { tableId, winnerPeerId, pot } = params;
  if (!(pot > 0) || !winnerPeerId) return;
  await transferSwarm({
    from: escrowAddress(tableId),
    to: winnerPeerId,
    amount: pot,
    meta: { kind: 'pub_settle', tableId },
  });
}

/** Refund a seat that leaves before the leg finishes. Best-effort. */
export async function refundBuyIn(params: {
  tableId: string;
  peerId: string;
  amount: number;
}): Promise<void> {
  const { tableId, peerId, amount } = params;
  if (!(amount > 0)) return;
  try {
    await transferSwarm({
      from: escrowAddress(tableId),
      to: peerId,
      amount,
      meta: { kind: 'pub_refund', tableId },
    });
  } catch {
    /* an empty escrow just means someone already settled */
  }
}
