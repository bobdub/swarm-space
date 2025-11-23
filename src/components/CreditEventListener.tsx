import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/use-toast";
import { get } from "@/lib/store";
import { getCurrentUser } from "@/lib/auth";
import type { CreditNotificationPayload } from "@/lib/credits";
import type { User } from "@/types";

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
    contextParts.push(`“${payload.message}”`);
  }

  toast({
    title: baseTitle,
    description: contextParts.join(" · "),
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

  return null;
};

export default CreditEventListener;
