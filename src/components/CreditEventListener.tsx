import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/use-toast";
import { get, put } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import { getCreditBalanceRecord } from "@/lib/credits";
import type { CreditNotificationPayload } from "@/lib/credits";
import type { User, CreditTransaction } from "@/types";

const CREDIT_TYPE_COPY: Partial<Record<CreditNotificationPayload["type"], string>> = {
  tip: "Tip",
  transfer: "Transfer",
  hype: "Hype",
  earned_post: "Post reward",
  earned_hosting: "Hosting reward",
  achievement_reward: "Achievement",
};

async function resolveUserName(userId: string): Promise<string> {
  try {
    const user = await get<User>("users", userId);
    if (user?.displayName?.trim()) {
      return user.displayName;
    }
    if (user?.username?.trim()) {
      return `@${user.username}`;
    }
  } catch (error) {
    console.warn("[credit-events] Failed to resolve counterparty", error);
  }

  return `User ${userId.slice(0, 8)}`;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(amount);
}

async function showCreditToast(payload: CreditNotificationPayload): Promise<void> {
  const counterpartyName = await resolveUserName(payload.counterpartyId);
  const amount = formatAmount(payload.amount);
  const directionPrefix = payload.direction === "received" ? "+" : "-";
  const baseTitle = `${directionPrefix}${amount} credits`;
  const contextParts = [
    `${payload.direction === "received" ? "From" : "To"} ${counterpartyName}`,
    CREDIT_TYPE_COPY[payload.type] ?? "Credits",
  ];

  if (payload.message) {
    contextParts.push(`"${payload.message}"`);
  }

  toast({
    title: baseTitle,
    description: contextParts.join(" · "),
  });
}

/**
 * Process an incoming credit transfer received via P2P mesh.
 * If this user is the recipient, credit their local balance.
 */
async function handleMeshCreditTransfer(transaction: CreditTransaction): Promise<void> {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  // Only process if we are the recipient
  if (transaction.toUserId !== currentUser.id) return;

  // Deduplicate — check if we already have this transaction
  const existing = await get<CreditTransaction>("creditTransactions", transaction.id);
  if (existing) return;

  // Store the transaction
  await put("creditTransactions", transaction);

  // Credit our balance
  const balance = await getCreditBalanceRecord(currentUser.id);
  balance.balance += transaction.amount;
  balance.totalEarned += transaction.amount;
  balance.lastUpdated = new Date().toISOString();
  await put("creditBalances", balance);

  // Update user credits field
  const user = await get<User>("users", currentUser.id);
  if (user) {
    user.credits = balance.balance;
    await put("users", user);
  }

  console.log(`[credits] Received ${transaction.amount} credits from ${transaction.fromUserId} via mesh`);

  // Show toast
  const senderName = await resolveUserName(transaction.fromUserId);
  toast({
    title: `+${formatAmount(transaction.amount)} credits received!`,
    description: `From ${senderName} · ${CREDIT_TYPE_COPY[transaction.type] ?? "Credits"}`,
  });
}

const CreditEventListener = () => {
  const processedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleCreditEvent = (event: Event) => {
      const customEvent = event as CustomEvent<CreditNotificationPayload>;
      const payload = customEvent.detail;
      if (!payload) {
        return;
      }

      const currentUser = getCurrentUser();
      if (!currentUser || currentUser.id !== payload.userId) {
        return;
      }

      const key = `${payload.transactionId}:${payload.direction}`;
      if (processedIdsRef.current.has(key)) {
        return;
      }
      processedIdsRef.current.add(key);

      void showCreditToast(payload);
    };

    window.addEventListener("credits:transaction", handleCreditEvent);
    return () => {
      window.removeEventListener("credits:transaction", handleCreditEvent);
    };
  }, []);

  // Listen for incoming credit transfers via P2P mesh
  useEffect(() => {
    // Listen via BroadcastChannel (same-origin tabs)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("swarm-credit-transfers");
      bc.onmessage = (event) => {
        const data = event.data;
        if (data?.type === "credit-transfer" && data.transaction) {
          void handleMeshCreditTransfer(data.transaction as CreditTransaction);
        }
      };
    } catch { /* BroadcastChannel not available */ }

    // Listen via P2P standalone mesh channels
    const cleanups: (() => void)[] = [];

    import("@/lib/p2p/swarmMesh.standalone").then(({ getSwarmMeshStandalone }) => {
      const sm = getSwarmMeshStandalone();
      const unsub = sm.onMessage("credits", (_peerId: string, payload: unknown) => {
        const data = payload as { type?: string; transaction?: CreditTransaction };
        if (data?.type === "credit-transfer" && data.transaction) {
          void handleMeshCreditTransfer(data.transaction);
        }
      });
      cleanups.push(unsub);
    }).catch(() => { /* swarm mesh not available */ });

    import("@/lib/p2p/builderMode.standalone-archived").then(({ getStandaloneBuilderMode }) => {
      const bm = getStandaloneBuilderMode();
      const unsub = bm.onMessage("credits", (_peerId: string, payload: unknown) => {
        const data = payload as { type?: string; transaction?: CreditTransaction };
        if (data?.type === "credit-transfer" && data.transaction) {
          void handleMeshCreditTransfer(data.transaction);
        }
      });
      cleanups.push(unsub);
    }).catch(() => { /* builder mode not available */ });

    return () => {
      bc?.close();
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return null;
};

export default CreditEventListener;
