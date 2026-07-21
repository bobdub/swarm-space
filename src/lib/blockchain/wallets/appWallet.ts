/**
 * App Wallet — multi-currency in-app ledger.
 *
 * Holds ETH / BTC / MintMe balances that Coin Market sales credit into,
 * without ever asking the user to paste an external address into a form.
 * The MetaMask bridge (still stubbed) is the one and only way funds leave
 * this ledger for the outside world.
 *
 * Persistence: localStorage (small numeric ledger, no PII). Deliberately
 * NOT an IndexedDB store so we don't have to bump the DB schema.
 */

import type { CoinMarketCurrency } from "../types";

const STORAGE_KEY = "swarm.appWallet.balances.v1";

export type AppWalletCurrency = CoinMarketCurrency;

type BalanceMap = Record<string, Partial<Record<AppWalletCurrency, number>>>;

function readAll(): BalanceMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as BalanceMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: BalanceMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* quota / private mode */ }
  try {
    window.dispatchEvent(new CustomEvent("app-wallet-update"));
  } catch { /* non-browser */ }
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export function getAppWalletBalance(userId: string, currency: AppWalletCurrency): number {
  if (!userId) return 0;
  const all = readAll();
  return round8(all[userId]?.[currency] ?? 0);
}

export function getAppWalletBalances(userId: string): Record<AppWalletCurrency, number> {
  return {
    ETH: getAppWalletBalance(userId, "ETH"),
    BTC: getAppWalletBalance(userId, "BTC"),
    MINTME: getAppWalletBalance(userId, "MINTME"),
  };
}

export function creditAppWallet(userId: string, currency: AppWalletCurrency, amount: number): number {
  if (!userId || !(amount > 0) || !Number.isFinite(amount)) return getAppWalletBalance(userId, currency);
  const all = readAll();
  const user = all[userId] ?? {};
  const next = round8((user[currency] ?? 0) + amount);
  user[currency] = next;
  all[userId] = user;
  writeAll(all);
  return next;
}

export function debitAppWallet(userId: string, currency: AppWalletCurrency, amount: number): number {
  if (!userId || !(amount > 0) || !Number.isFinite(amount)) return getAppWalletBalance(userId, currency);
  const all = readAll();
  const user = all[userId] ?? {};
  const current = user[currency] ?? 0;
  if (current < amount) {
    throw new Error(`Insufficient in-app ${currency} balance.`);
  }
  const next = round8(current - amount);
  user[currency] = next;
  all[userId] = user;
  writeAll(all);
  return next;
}

export function onAppWalletUpdate(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("app-wallet-update", handler);
  return () => window.removeEventListener("app-wallet-update", handler);
}