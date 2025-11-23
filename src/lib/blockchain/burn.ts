// Daily token burn for quantum metrics
import { burnSwarm } from "./token";
import { getCreditBalance, getCreditBalanceRecord } from "../credits";
import { put } from "../store";
import { CREDIT_REWARDS } from "../credits";

const BURN_STORAGE_KEY = "swarm:last-burn-date";

function getLastBurnDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(BURN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLastBurnDate(date: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BURN_STORAGE_KEY, date);
  } catch (error) {
    console.warn("[burn] Failed to save last burn date", error);
  }
}

export async function processDailyBurn(userId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const lastBurn = getLastBurnDate();

  if (lastBurn === today) {
    return; // Already burned today
  }

  const balance = await getCreditBalance(userId);
  
  // Don't burn if user has no balance or would go negative
  if (balance <= 0) {
    return;
  }

  const burnAmount = Math.min(CREDIT_REWARDS.DAILY_BURN, balance);

  try {
    // Burn from blockchain
    await burnSwarm({
      from: userId,
      amount: burnAmount,
      reason: "Daily quantum metrics computation",
    });

    // Update credit balance
    const balanceRecord = await getCreditBalanceRecord(userId);
    balanceRecord.balance = Math.max(0, balanceRecord.balance - burnAmount);
    balanceRecord.totalBurned += burnAmount;
    balanceRecord.lastUpdated = new Date().toISOString();
    await put("creditBalances", balanceRecord);

    setLastBurnDate(today);
    
    console.log(`[burn] Daily burn completed: ${burnAmount} SWARM for user ${userId}`);
  } catch (error) {
    console.error("[burn] Failed to process daily burn:", error);
  }
}

export function initializeDailyBurn(userId: string): void {
  if (typeof window === "undefined") return;

  // Check on startup
  void processDailyBurn(userId);

  // Check every hour
  const interval = setInterval(() => {
    void processDailyBurn(userId);
  }, 60 * 60 * 1000);

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    clearInterval(interval);
  });
}
