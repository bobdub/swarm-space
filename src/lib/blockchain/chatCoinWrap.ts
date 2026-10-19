/**
 * Chat History Coin Wrap
 * ──────────────────────
 * Brain chat is ephemeral by default. When a user engages (sends a
 * message) and chooses "Save History", the transcript from engagement to
 * save is sealed inside one of their own mined SWARM coins. The coin
 * stays in the user's wallet — history is owned, never spent.
 *
 * Rules:
 *   1. The user must own a free mined coin (wallet status, unlocked,
 *      fungible, not already carrying a chat or chemical payload).
 *   2. Local storage must not be at the hard quota block (quotaGuard).
 *   3. The transcript is clipped to CHAT_COIN_MAX_MESSAGES so a coin
 *      never becomes an unbounded blob.
 */

import { getAll, put } from "../store";
import { assertStorageWritable } from "../storage/quotaGuard";
import { generateTransactionId } from "./crypto";
import { getSwarmChain } from "./chain";
import { hydrateMinedWalletCoins } from './minedWalletCoins';
import type { SwarmCoin, SwarmTransaction, WrappedChatPayload } from "./types";

export const CHAT_COIN_MAX_MESSAGES = 200;
/** Rough weight cost of a sealed transcript (weight units are abstract). */
export const CHAT_WRAP_WEIGHT = 10;

export interface ChatCoinMessage {
  author: string;
  text: string;
  ts: number;
}

/** A free mined coin the user can seal a chat transcript into. */
export async function findChatWrapCoin(userId: string): Promise<SwarmCoin | null> {
  let all = await getAll<SwarmCoin>("swarmCoins");
  const eligible = (c: SwarmCoin) =>
    c.ownerId === userId && c.status === 'wallet' && !c.locked &&
    !c.vaultAddress && c.fillState !== 'spent' && c.kind !== 'media' &&
    !c.firstArtifactNftId && !c.wrappedChat &&
    (c.wrappedTokens?.length ?? 0) === 0 &&
    (c.wrappedChemicals?.length ?? 0) === 0 &&
    Number.isFinite(c.weight) && Number.isFinite(c.maxWeight) &&
    c.weight + CHAT_WRAP_WEIGHT <= c.maxWeight;
  if (!all.some(eligible)) {
    await assertStorageWritable();
    await hydrateMinedWalletCoins(userId);
    all = await getAll<SwarmCoin>('swarmCoins');
  }
  return (
    all.find(eligible) ?? null
  );
}

/** True when the user has at least one coin eligible for chat wrapping. */
export async function canWrapChatHistory(userId: string): Promise<boolean> {
  return (await findChatWrapCoin(userId)) !== null;
}

/**
 * Seal a chat transcript into a mined coin the user owns.
 * The coin remains in the user's wallet with the transcript attached.
 */
export async function wrapChatHistoryIntoCoin(
  userId: string,
  roomId: string,
  messages: ChatCoinMessage[],
): Promise<{ coin: SwarmCoin; transaction: SwarmTransaction }> {
  if (!messages.length) throw new Error("Nothing to save — send a message first.");

  await assertStorageWritable();

  const coin = await findChatWrapCoin(userId);
  if (!coin) {
    throw new Error(
      "You need 1 free mined SWARM coin to save chat history. Mine one on the Node page or pick one up on the Peer Market.",
    );
  }

  const clipped = messages.slice(-CHAT_COIN_MAX_MESSAGES);
  const participants = [...new Set(clipped.map((m) => m.author))];

  const payload: WrappedChatPayload = {
    roomId,
    savedAt: new Date().toISOString(),
    savedBy: userId,
    messageCount: clipped.length,
    participants,
    messages: clipped,
  };

  coin.wrappedChat = payload;
  coin.weight += CHAT_WRAP_WEIGHT;
  await put("swarmCoins", coin);

  const transaction: SwarmTransaction = {
    id: generateTransactionId(),
    type: "coin_transfer",
    from: userId,
    to: userId,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: userId,
    nonce: Date.now(),
    fee: 0,
    meta: {
      kind: "chat_history_wrap",
      coinId: coin.coinId,
      roomId,
      messageCount: clipped.length,
      participants: participants.length,
      coinWeightAfter: coin.weight,
    },
  };

  getSwarmChain().addTransaction(transaction);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
  }

  return { coin, transaction };
}

/** Chat-history coins owned by the user, newest save first. */
export async function getChatHistoryCoins(userId: string): Promise<SwarmCoin[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  return all
    .filter((c) => c.ownerId === userId && c.status === "wallet" && c.wrappedChat)
    .sort((a, b) => (b.wrappedChat?.savedAt || "").localeCompare(a.wrappedChat?.savedAt || ""));
}
