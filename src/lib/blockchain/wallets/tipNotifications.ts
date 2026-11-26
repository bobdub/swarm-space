/**
 * Bell notifications for tips and transfers a member receives (SWARM, MINTME,
 * imported MintMe tokens like Dreams, imported Ethereum tokens like MTCG). Tips reach a member by mesh delivery,
 * pending-pool sync or a peer's block, so the ledger is scanned rather than
 * hooking one path. A watermark set on first run keeps old history quiet, and
 * one inbox entry per tip id keeps rescans and replays from repeating it.
 */
import type { Notification, User } from "@/types";
import { get, put } from "@/lib/store";
import type { SwarmTransaction } from "../types";
import { isNativeMintMeTip } from "./nativeMintmeLedger";
import { isCustomTokenTip } from "../deposits/customTokenTips";
import { isNativeEthTip } from "./nativeEth";

const SINCE_KEY = (uid: string) => `swarm-tip-notices-since:${uid}`;
export const tipNoticeId = (txId: string) => `wallet-tip:${txId}`;

function readSince(uid: string, now: number): number {
  try {
    const raw = localStorage.getItem(SINCE_KEY(uid));
    if (raw && Number.isFinite(Number(raw))) return Number(raw);
    localStorage.setItem(SINCE_KEY(uid), String(now));
  } catch { /* storage unavailable: only tips from this session */ }
  return now;
}

async function senderName(userId: string): Promise<string> {
  try {
    const user = await get<User>("users", userId);
    if (user?.displayName?.trim()) return user.displayName;
    if (user?.username?.trim()) return `@${user.username}`;
  } catch { /* fall back to the id */ }
  return `User ${userId.slice(0, 8)}`;
}

function tickerOf(tx: SwarmTransaction): string {
  if (isNativeMintMeTip(tx)) return "MINTME";
  if (isNativeEthTip(tx)) return "ETH";
  if (tx.meta?.assetId === "chain:SWARM") return "SWARM";
  if (isCustomTokenTip(tx)) return String(tx.meta?.ticker ?? "tokens").slice(0, 16);
  return "";
}

/** Record one inbox entry for a tip or transfer `userId` received. Returns true when a new one was added. */
export async function notifyTipReceived(tx: SwarmTransaction, userId: string): Promise<boolean> {
  if (tx.type !== "wallet_tip" || tx.to !== userId || tx.from === userId) return false;
  const ticker = tickerOf(tx);
  if (!ticker) return false;
  const id = tipNoticeId(tx.id);
  if (await get("notifications", id)) return false;
  const name = await senderName(tx.from);
  const kind = tx.meta?.intent === "transfer" ? "transfer" : "tip";
  const message = typeof tx.meta?.message === "string" && tx.meta.message.trim() ? ` · "${tx.meta.message.trim().slice(0, 140)}"` : "";
  const amount = Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 });
  await put("notifications", {
    id, userId, type: "wallet_deposit", triggeredBy: tx.from, triggeredByName: name,
    title: `+${amount} ${ticker}`,
    content: `${kind === "transfer" ? "Transfer" : "Tip"} from ${name}${message}`,
    link: "/wallet", linkLabel: "Open wallet", read: false, createdAt: new Date().toISOString(),
  } satisfies Notification);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("notifications-updated", { detail: { userId } }));
  return true;
}

/** Notify `userId` of every tip in the ledger addressed to them since notices began. */
export async function notifyReceivedTips(ledger: readonly SwarmTransaction[], userId: string, now = Date.now()): Promise<number> {
  if (!userId) return 0;
  const since = readSince(userId, now);
  let added = 0;
  for (const tx of ledger) {
    if (tx.type !== "wallet_tip" || tx.to !== userId) continue;
    const at = Date.parse(tx.timestamp);
    if (!Number.isFinite(at) || at < since) continue;
    if (await notifyTipReceived(tx, userId).catch(() => false)) added++;
  }
  return added;
}
